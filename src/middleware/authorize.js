// Route access rules:
//   'public'          anyone, signed in or not
//   'user'            any signed-in user
//   'admin'           admins only (user accounts and roles)
//   'perm:a|b'        a signed-in user whose role has any of these permissions (admins have all)
const { can } = require('../config/permissions');
const { HttpError } = require('../utils/http-error');

function authorize(access, user) {
  if (access === 'public') return;
  if (!user) throw new HttpError(401, 'Please sign in');
  if (access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Only admins can do this');
  if (access.startsWith('perm:') && !access.slice(5).split('|').some((p) => can(user, p))) {
    throw new HttpError(403, "Your role doesn't allow this. Ask an admin to change your role's permissions.");
  }
}

const isValidAccess = (access) => ['public', 'user', 'admin'].includes(access) || /^perm:[a-z.]+(\|[a-z.]+)*$/.test(access);

module.exports = { authorize, isValidAccess };
