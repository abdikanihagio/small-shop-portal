// Roles and their permissions (admins only). Changes apply to signed-in users straight away,
// because permissions are read on every request.
const RoleModel = require('../models/role.model');
const audit = require('./audit.service');
const { PERMISSIONS } = require('../config/permissions');
const { bad, notFound } = require('../utils/http-error');

const { transaction } = require('../config/database');

const list = async () => ({ permissions: PERMISSIONS, roles: await RoleModel.listWithUserCounts() });

async function findRole(id) {
  const role = await RoleModel.findById(id);
  if (!role) throw notFound('Role not found');
  return role;
}

async function assertNameFree(name, exceptId) {
  if (await RoleModel.nameTaken(name, exceptId)) throw bad('A role with this name already exists');
}

const create = (actor, { name, permissions }) =>
  transaction(async () => {
    await assertNameFree(name);
    const id = await RoleModel.create(name, permissions);
    await audit.record(actor, 'role.created', 'role', id, { name, permissions: permissions.join(', ') });
    return RoleModel.findById(id);
  });

// The built-in Cashier role keeps its name; its permissions can change.
// Only what was sent changes.
const update = (actor, id, { name: newName, permissions: newPermissions }) =>
  transaction(async () => {
    const old = await findRole(id);
    const name = old.builtin ? old.name : newName ?? old.name;
    await assertNameFree(name, id);
    const permissions = newPermissions ?? old.permissions;
    await RoleModel.update(id, name, permissions);
    const before = new Set(old.permissions);
    const after = new Set(permissions);
    await audit.record(actor, 'role.updated', 'role', id, {
      name,
      ...(name !== old.name ? { renamed_from: old.name } : {}),
      added: [...after].filter((p) => !before.has(p)).join(', ') || '—',
      removed: [...before].filter((p) => !after.has(p)).join(', ') || '—',
    });
    return RoleModel.findById(id);
  });

const remove = (actor, id) =>
  transaction(async () => {
    const role = await findRole(id);
    if (role.builtin) throw bad('The Cashier role cannot be deleted');
    const n = await RoleModel.staffCount(id);
    if (n) throw bad(`${n} user${n === 1 ? ' has' : 's have'} this role. Give them another role first.`);
    await RoleModel.remove(id);
    await audit.record(actor, 'role.deleted', 'role', id, { name: role.name });
    return { ok: true };
  });

module.exports = { list, create, update, remove };
