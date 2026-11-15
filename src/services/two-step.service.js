// Two-step login with an authenticator app (TOTP) and single-use recovery codes.
// After the password, the browser gets a short-lived ticket (5 minutes, 5 tries) that it trades,
// together with the 6-digit code (or a recovery code), for a session.
const totp = require('../../lib/totp');
const qr = require('../../lib/qr');
const UserModel = require('../models/user.model');
const audit = require('./audit.service');
const sessions = require('./session.service');
const throttle = require('./throttle.service');
const settings = require('./settings.service');
const { transaction } = require('../config/database');
const { LOGIN_TICKET_MS } = require('../config/constants');
const { verifyPassword, randomToken } = require('../utils/crypto');
const { bad } = require('../utils/http-error');

const loginTickets = new Map(); // ticket -> { userId, expires, attempts }

function newLoginTicket(user) {
  const now = Date.now();
  for (const [k, t] of loginTickets) if (t.expires < now) loginTickets.delete(k);
  const ticket = randomToken(24);
  loginTickets.set(ticket, { userId: user.id, expires: now + LOGIN_TICKET_MS, attempts: 0 });
  return ticket;
}

const findTicket = (ticket) => loginTickets.get(ticket);
const dropTicket = (ticket) => loginTickets.delete(ticket);

const looksLikeRecoveryCode = (code) => /[a-z]/i.test(String(code)) || totp.normaliseRecovery(code).length === 8;

// Checks a code from the app, or a recovery code (which is then used up).
// Returns 'app' | 'recovery' | null. Codes from the app can't be used twice: the check and the
// "last used" update run in one transaction, re-reading the user, so two requests can't share a code.
function checkSecondFactor(user, code) {
  return transaction(async () => {
    const u = await UserModel.findById(user.id);
    if (!u?.totp_enabled) return null;
    if (looksLikeRecoveryCode(code)) {
      const list = JSON.parse(u.recovery_codes || '[]');
      const h = totp.hashRecovery(code);
      if (!list.includes(h)) return null;
      await UserModel.setRecoveryCodes(u.id, list.filter((x) => x !== h));
      return 'recovery';
    }
    const step = totp.verifyTotp(u.totp_secret, code, { notAfterStep: u.totp_last_step });
    if (step === null) return null;
    await UserModel.setTotpLastStep(u.id, step);
    return 'app';
  });
}

// Re-entering the password before changing two-step settings (throttled like sign-in).
async function requirePassword(user, password) {
  const keys = [`pw:${user.id}`];
  throttle.check(keys);
  if (!(await verifyPassword(String(password ?? ''), await UserModel.findById(user.id)))) {
    throttle.fail(keys);
    throw bad('Password is wrong');
  }
  throttle.clear(keys);
}

async function status(userId) {
  const u = await UserModel.findById(userId);
  return { enabled: !!u.totp_enabled, recovery_codes_left: JSON.parse(u.recovery_codes || '[]').length };
}

async function beginSetup(user, password) {
  await requirePassword(user, password);
  if ((await UserModel.findById(user.id)).totp_enabled) throw bad('Two-step login is already on');
  const secret = totp.newSecret();
  await UserModel.setTotpPending(user.id, secret);
  const uri = totp.otpauthUri(secret, user.username, await settings.shopName());
  return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), uri, qr_svg: qr.toSvg(uri) };
}

// Turning it on signs out every other session of this user.
function enable(actor, code, keepToken) {
  return transaction(async () => {
    const u = await UserModel.findById(actor.id);
    if (u.totp_enabled) throw bad('Two-step login is already on');
    if (!u.totp_pending) throw bad('Start the setup again');
    const step = totp.verifyTotp(u.totp_pending, code);
    if (step === null) throw bad('That code is not right. Check the time on the phone, then try the newest code.');
    const codes = totp.newRecoveryCodes();
    await UserModel.enableTotp(actor.id, step, codes.map(totp.hashRecovery));
    const signedOut = await sessions.revokeAll(actor.id, keepToken);
    await audit.record(actor, '2fa.enabled', 'user', actor.id, { other_sessions_signed_out: signedOut });
    return { ok: true, recovery_codes: codes };
  });
}

async function disable(actor, password, code) {
  await requirePassword(actor, password);
  const u = await UserModel.findById(actor.id);
  if (!u.totp_enabled) throw bad('Two-step login is not on');
  if (!(await checkSecondFactor(u, code))) throw bad('That code is not right');
  await UserModel.clearTwoStep(actor.id);
  await audit.record(actor, '2fa.disabled', 'user', actor.id);
  return { ok: true };
}

async function replaceRecoveryCodes(actor, password) {
  await requirePassword(actor, password);
  if (!(await UserModel.findById(actor.id)).totp_enabled) throw bad('Two-step login is not on');
  const codes = totp.newRecoveryCodes();
  await UserModel.setRecoveryCodes(actor.id, codes.map(totp.hashRecovery));
  await audit.record(actor, '2fa.recovery_codes_replaced', 'user', actor.id);
  return { ok: true, recovery_codes: codes };
}

module.exports = { newLoginTicket, findTicket, dropTicket, checkSecondFactor, status, beginSetup, enable, disable, replaceRecoveryCodes };
