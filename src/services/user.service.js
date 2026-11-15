// User accounts (admins only). Owner protection: only the owner may change another admin (password,
// two-step login, role, status) or make someone an admin, and nobody else may change the owner
// account. Other admins manage everyone else.
const UserModel = require('../models/user.model');
const RoleModel = require('../models/role.model');
const audit = require('./audit.service');
const sessions = require('./session.service');
const settings = require('./settings.service');
const { transaction } = require('../config/database');
const { int } = require('../validators/common.validator');
const { hashPassword } = require('../utils/crypto');
const { bad, notFound, forbidden } = require('../utils/http-error');

function assertCanManage(actor, target) {
  if (actor.is_owner || target.id === actor.id) return;
  if (target.is_owner) throw forbidden('Only the owner can change the owner account');
  if (target.role === 'admin') throw forbidden('Only the owner can change other admins');
}

async function findTarget(id) {
  const target = await UserModel.findById(id);
  if (!target) throw notFound('User not found');
  return target;
}

// { role: 'admin' } or { role_id } → { role, role_id } for the users table. No role_id → Cashier.
async function resolveRole({ role, role_id }) {
  if (role === 'admin') return { role: 'admin', role_id: null, role_name: 'Admin' };
  const roleId = role_id != null && role_id !== '' ? int(role_id, 'Role') : await RoleModel.builtinId();
  const r = await RoleModel.findById(roleId);
  if (!r) throw bad('That role does not exist');
  return { role: 'staff', role_id: r.id, role_name: r.name };
}

const roleLabel = async (role, roleId) => (role === 'admin' ? 'Admin' : (await RoleModel.findById(roleId))?.name || 'Cashier');

const list = () => UserModel.listWithRoles();

async function create(actor, { username, name, password, role, role_id }) {
  await settings.checkPassword(password, username);
  const r = await resolveRole({ role, role_id });
  if (r.role === 'admin' && !actor.is_owner) throw forbidden('Only the owner can add admins');
  if (await UserModel.usernameExists(username)) throw bad('Username already exists');
  const { hash, salt } = await hashPassword(password);
  return transaction(async () => {
    if (await UserModel.usernameExists(username)) throw bad('Username already exists');
    const id = await UserModel.create({ username, name, role: r.role, roleId: r.role_id, hash, salt });
    await audit.record(actor, 'user.created', 'user', id, { username, role: r.role_name });
    return { ok: true };
  });
}

// input: { role?, role_id?, active?, password? } — only what was sent is changed.
async function update(actor, id, input) {
  const check = (target) => {
    assertCanManage(actor, target);
    if (input.role === 'admin' && target.role !== 'admin' && !actor.is_owner) throw forbidden('Only the owner can make someone an admin');
    const demotesSelf = (input.role && input.role !== 'admin') || (input.role_id != null && input.role !== 'admin');
    if (id === actor.id && (input.active === false || demotesSelf)) throw bad('You cannot demote or disable yourself');
    if (id === actor.id && input.password) throw bad('Change your own password under Settings → Change your password');
  };
  const first = await findTarget(id);
  check(first);
  // The slow password hashing happens before the transaction; the checks are repeated inside it.
  const hashed = input.password ? await hashPassword(await settings.checkPassword(input.password, first.username)) : null;

  return transaction(async () => {
    const target = await findTarget(id);
    check(target);

    const changes = {};
    if (input.role || input.role_id != null) {
      const next = await resolveRole({ role: input.role, role_id: input.role_id ?? (input.role === 'staff' ? target.role_id : undefined) });
      if (next.role !== target.role || next.role_id !== target.role_id) {
        changes.role = { from: await roleLabel(target.role, target.role_id), to: await roleLabel(next.role, next.role_id) };
      }
      await UserModel.setRole(id, next.role, next.role_id);
    }
    if (input.active !== undefined) {
      if (!!input.active !== !!target.active) changes.active = { from: !!target.active, to: !!input.active };
      await UserModel.setActive(id, input.active);
      if (!input.active) await sessions.revokeAll(id);
    }
    if (hashed) {
      await UserModel.setPassword(id, hashed);
      // A reset password must lock out whoever had the old one.
      changes.password_reset = true;
      changes.sessions_signed_out = await sessions.revokeAll(id);
    }
    if (Object.keys(changes).length) await audit.record(actor, 'user.updated', 'user', id, { username: target.username, ...changes });
    return { ok: true };
  });
}

// For a lost phone: switches two-step login off so they can set it up again.
function resetTwoStep(actor, id) {
  if (id === actor.id) throw bad('Use Settings → Two-step login to change your own');
  return transaction(async () => {
    const target = await findTarget(id);
    assertCanManage(actor, target);
    if (!target.totp_enabled) throw bad('Two-step login is not on for this user');
    await UserModel.clearTwoStep(id);
    const signedOut = await sessions.revokeAll(id);
    await audit.record(actor, '2fa.reset_by_admin', 'user', id, { username: target.username, sessions_signed_out: signedOut });
    return { ok: true };
  });
}

module.exports = { list, create, update, resetTwoStep };
