// First-run setup, sign-in (with optional two-step code), password changes.
const UserModel = require('../models/user.model');
const SettingsModel = require('../models/settings.model');
const audit = require('./audit.service');
const sessions = require('./session.service');
const throttle = require('./throttle.service');
const twoStep = require('./two-step.service');
const settings = require('./settings.service');
const { PORT } = require('../config/environment');
const { useTls } = require('../config/tls');
const { LOGIN_TICKET_TRIES } = require('../config/constants');
const { hashPassword, verifyPassword, DUMMY_USER } = require('../utils/crypto');
const { HttpError, bad, forbidden } = require('../utils/http-error');

const needsSetup = () => UserModel.count() === 0;

// The owner account can only be created once, and only from the shop computer itself.
function assertCanSetUp(isLocal) {
  if (!needsSetup()) throw forbidden('Setup already completed');
  if (!isLocal) throw forbidden(`For safety, create the owner account on the shop computer itself (open http${useTls ? 's' : ''}://localhost:${PORT} there).`);
}

// Returns the new owner's session token.
async function createOwner(ip, { username, name, password, shopName }) {
  const { hash, salt } = await hashPassword(password);
  // Re-check after the (async) hashing so two simultaneous setups cannot both succeed.
  if (!needsSetup()) throw forbidden('Setup already completed');
  const id = UserModel.create({ username, name, role: 'admin', hash, salt, isOwner: true });
  if (shopName) SettingsModel.set('shop_name', shopName);
  audit.record({ id, username, ip }, 'setup.owner_created', 'user', id);
  return sessions.start(id);
}

function finishLogin(user, ip, details) {
  sessions.removeStale();
  const token = sessions.start(user.id);
  audit.record({ id: user.id, username: user.username, ip }, 'login.success', 'user', user.id, details);
  return token;
}

// Returns { token } or, when two-step login is on, { ticket } for the second step.
async function login(ip, username, password) {
  const keys = throttle.loginKeys(username, ip);
  throttle.check(keys);
  const user = UserModel.findActiveByUsername(username);
  const ok = await verifyPassword(password, user || DUMMY_USER);
  if (!user || !ok) {
    throttle.fail(keys);
    audit.record({ ip }, 'login.failed', 'user', '', { username });
    throw new HttpError(401, 'Wrong username or password');
  }
  // Password was right; no session until the second step succeeds. Failure counters stay.
  if (user.totp_enabled) return { ticket: twoStep.newLoginTicket(user) };
  throttle.clear(keys);
  return { token: finishLogin(user, ip, {}) };
}

// The second step: returns { token, recoveryCodesLeft }.
function verifyLogin(ip, ticketId, code) {
  const timedOut = () => new HttpError(401, 'Sign-in timed out. Please enter your password again.');
  const ticket = twoStep.findTicket(ticketId);
  if (!ticket || ticket.expires < Date.now()) {
    twoStep.dropTicket(ticketId);
    throw timedOut();
  }
  const user = UserModel.findActiveById(ticket.userId);
  if (!user) throw timedOut();
  const keys = throttle.loginKeys(user.username, ip);
  throttle.check(keys);
  const method = twoStep.checkSecondFactor(user, code);
  if (!method) {
    throttle.fail(keys);
    ticket.attempts++;
    if (ticket.attempts >= LOGIN_TICKET_TRIES) twoStep.dropTicket(ticketId);
    audit.record({ id: user.id, username: user.username, ip }, 'login.2fa_failed', 'user', user.id);
    throw new HttpError(401, ticket.attempts >= LOGIN_TICKET_TRIES ? 'Too many wrong codes. Please sign in again.' : 'Wrong code. Check the app and try again.');
  }
  twoStep.dropTicket(ticketId);
  throttle.clear(keys);
  const token = finishLogin(user, ip, { two_step: method });
  return { token, recoveryCodesLeft: method === 'recovery' ? UserModel.recoveryCodes(user.id).length : undefined };
}

// Changing your own password signs out every other session of yours.
async function changePassword(actor, currentPassword, newPassword, keepToken) {
  const keys = [`pw:${actor.id}`];
  throttle.check(keys);
  if (!(await verifyPassword(currentPassword, UserModel.findById(actor.id)))) {
    throttle.fail(keys);
    throw bad('Current password is wrong');
  }
  throttle.clear(keys);
  UserModel.setPassword(actor.id, await hashPassword(settings.checkPassword(newPassword, actor.username)));
  const signedOut = sessions.revokeAll(actor.id, keepToken);
  audit.record(actor, 'user.password_changed', 'user', actor.id, { other_sessions_signed_out: signedOut });
  return { ok: true, signed_out: signedOut };
}

function signOutOtherDevices(actor, keepToken) {
  const signedOut = sessions.revokeAll(actor.id, keepToken);
  audit.record(actor, 'user.signed_out_other_devices', 'user', actor.id, { sessions: signedOut });
  return { ok: true, signed_out: signedOut };
}

module.exports = { needsSetup, assertCanSetUp, createOwner, login, verifyLogin, changePassword, signOutOtherDevices };
