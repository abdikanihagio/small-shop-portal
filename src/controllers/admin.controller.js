// Shop settings, user accounts, roles & permissions, and the activity log.
const settings = require('../services/settings.service');
const users = require('../services/user.service');
const roles = require('../services/role.service');
const audit = require('../services/audit.service');
const { id, str, dateRange } = require('../validators/common.validator');
const { readSettings, readRoleName, readPermissions, readUsername } = require('../validators/admin.validator');

module.exports = {
  updateSettings: ({ actor, body }) => settings.update(actor, readSettings(body)),

  listUsers: () => users.list(),
  createUser: ({ actor, body }) =>
    users.create(actor, { username: readUsername(body.username), name: str(body.name, 'Name'), password: body.password, role: body.role, role_id: body.role_id }),
  updateUser: ({ actor, params, body }) =>
    users.update(actor, id(params.id), { role: body.role, role_id: body.role_id, active: body.active, password: body.password }),
  resetUserTwoStep: ({ actor, params }) => users.resetTwoStep(actor, id(params.id)),

  listRoles: () => roles.list(),
  createRole: ({ actor, body }) => roles.create(actor, { name: readRoleName(body.name), permissions: readPermissions(body.permissions) }),
  updateRole: ({ actor, params, body }) =>
    roles.update(actor, id(params.id), {
      name: body.name !== undefined ? readRoleName(body.name) : undefined,
      permissions: body.permissions !== undefined ? readPermissions(body.permissions) : undefined,
    }),
  deleteRole: ({ actor, params }) => roles.remove(actor, id(params.id)),

  activity: ({ query }) => audit.list({ ...dateRange(query), action: str(query.get('action'), 'Action', { max: 60 }) }),
};
