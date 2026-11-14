const c = require('../controllers/admin.controller');

module.exports = (route) => {
  route('PUT', '/api/settings', 'perm:settings.manage', c.updateSettings);
  route('GET', '/api/audit', 'perm:activity.view', c.activity);

  route('GET', '/api/users', 'admin', c.listUsers);
  route('POST', '/api/users', 'admin', c.createUser);
  route('PUT', '/api/users/:id', 'admin', c.updateUser);
  route('POST', '/api/users/:id/reset-2fa', 'admin', c.resetUserTwoStep);

  route('GET', '/api/roles', 'admin', c.listRoles);
  route('POST', '/api/roles', 'admin', c.createRole);
  route('PUT', '/api/roles/:id', 'admin', c.updateRole);
  route('DELETE', '/api/roles/:id', 'admin', c.deleteRole);
};
