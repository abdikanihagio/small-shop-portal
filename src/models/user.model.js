const { db } = require('../config/database');

const CLEAR_TWO_STEP = "totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_last_step = -1, recovery_codes = '[]'";

// Usernames are matched ignoring upper/lower case.
const UserModel = {
  count: async () => (await db.get('SELECT COUNT(*) AS n FROM users')).n,
  findById: (id) => db.get('SELECT * FROM users WHERE id = ?', id),
  findActiveById: (id) => db.get('SELECT * FROM users WHERE id = ? AND active = 1', id),
  findByUsername: (username) => db.get('SELECT * FROM users WHERE lower(username) = lower(?)', username),
  findActiveByUsername: (username) => db.get('SELECT * FROM users WHERE lower(username) = lower(?) AND active = 1', username),
  usernameExists: async (username) => !!(await db.get('SELECT 1 FROM users WHERE lower(username) = lower(?)', username)),

  listWithRoles: () =>
    db.all(
      `SELECT u.id, u.username, u.name, u.role, u.role_id, CASE WHEN u.role = 'admin' THEN 'Admin' ELSE r.name END AS role_name,
         u.active, u.created_at, u.totp_enabled AS two_step, u.is_owner
       FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY lower(u.username)`
    ),

  listWithTwoStep: () => db.all('SELECT username, role FROM users WHERE totp_enabled = 1 ORDER BY lower(username)'),

  create: ({ username, name, role, roleId = null, hash, salt, isOwner = false }) =>
    db.insert(
      'INSERT INTO users (username, name, role, role_id, password_hash, salt, is_owner) VALUES (?, ?, ?, ?, ?, ?, ?)',
      username, name, role, roleId, hash, salt, isOwner
    ),

  setPassword: (id, { hash, salt }) => db.run('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?', hash, salt, id),
  setRole: (id, role, roleId) => db.run('UPDATE users SET role = ?, role_id = ? WHERE id = ?', role, roleId, id),
  setActive: (id, active) => db.run('UPDATE users SET active = ? WHERE id = ?', !!active, id),

  // Two-step login
  setTotpPending: (id, secret) => db.run('UPDATE users SET totp_pending = ? WHERE id = ?', secret, id),
  enableTotp: (id, step, recoveryHashes) =>
    db.run(
      'UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1, totp_last_step = ?, recovery_codes = ? WHERE id = ?',
      step, JSON.stringify(recoveryHashes), id
    ),
  clearTwoStep: (id) => db.run(`UPDATE users SET ${CLEAR_TWO_STEP} WHERE id = ?`, id),
  setRecoveryCodes: (id, hashes) => db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', JSON.stringify(hashes), id),
  setTotpLastStep: (id, step) => db.run('UPDATE users SET totp_last_step = ? WHERE id = ?', step, id),
  recoveryCodes: async (id) => JSON.parse((await db.get('SELECT recovery_codes FROM users WHERE id = ?', id)).recovery_codes || '[]'),
};

module.exports = UserModel;
