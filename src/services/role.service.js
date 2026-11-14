// Roles and their permissions (admins only). Changes apply to signed-in users straight away,
// because permissions are read on every request.
const RoleModel = require('../models/role.model');
const audit = require('./audit.service');
const { PERMISSIONS } = require('../config/permissions');
const { bad, notFound } = require('../utils/http-error');

const list = () => ({ permissions: PERMISSIONS, roles: RoleModel.listWithUserCounts() });

function findRole(id) {
  const role = RoleModel.findById(id);
  if (!role) throw notFound('Role not found');
  return role;
}

function assertNameFree(name, exceptId) {
  if (RoleModel.nameTaken(name, exceptId)) throw bad('A role with this name already exists');
}

function create(actor, { name, permissions }) {
  assertNameFree(name);
  const id = RoleModel.create(name, permissions);
  audit.record(actor, 'role.created', 'role', id, { name, permissions: permissions.join(', ') });
  return RoleModel.findById(id);
}

// The built-in Cashier role keeps its name; its permissions can change.
// Only what was sent changes.
function update(actor, id, { name: newName, permissions: newPermissions }) {
  const old = findRole(id);
  const name = old.builtin ? old.name : newName ?? old.name;
  assertNameFree(name, id);
  const permissions = newPermissions ?? old.permissions;
  RoleModel.update(id, name, permissions);
  const before = new Set(old.permissions);
  const after = new Set(permissions);
  audit.record(actor, 'role.updated', 'role', id, {
    name,
    ...(name !== old.name ? { renamed_from: old.name } : {}),
    added: [...after].filter((p) => !before.has(p)).join(', ') || '—',
    removed: [...before].filter((p) => !after.has(p)).join(', ') || '—',
  });
  return RoleModel.findById(id);
}

function remove(actor, id) {
  const role = findRole(id);
  if (role.builtin) throw bad('The Cashier role cannot be deleted');
  const n = RoleModel.staffCount(id);
  if (n) throw bad(`${n} user${n === 1 ? ' has' : 's have'} this role. Give them another role first.`);
  RoleModel.remove(id);
  audit.record(actor, 'role.deleted', 'role', id, { name: role.name });
  return { ok: true };
}

module.exports = { list, create, update, remove };
