const { db } = require('../config/database');

const CLEAR_TWO_STEP = "totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_last_step = -1, recovery_codes = '[]'";

const UserModel = {
  count: () => db.prepare('SELECT COUNT(*) n FROM users').get().n,
  findById: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
  findActiveById: (id) => db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(id),
  findByUsername: (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(username),
  findActiveByUsername: (username) => db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username),
  usernameExists: (username) => !!db.prepare('SELECT 1 FROM users WHERE username = ?').get(username),

  listWithRoles: () =>
    db
      .prepare(
        `SELECT u.id, u.username, u.name, u.role, u.role_id, CASE WHEN u.role = 'admin' THEN 'Admin' ELSE r.name END AS role_name,
           u.active, u.created_at, u.totp_enabled AS two_step, u.is_owner
         FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.username`
      )
      .all(),

  listWithTwoStep: () => db.prepare('SELECT username, role FROM users WHERE totp_enabled = 1 ORDER BY username').all(),

  create: ({ username, name, role, roleId = null, hash, salt, isOwner = false }) =>
    db
      .prepare('INSERT INTO users (username, name, role, role_id, password_hash, salt, is_owner) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(username, name, role, roleId, hash, salt, isOwner ? 1 : 0).lastInsertRowid,

  setPassword: (id, { hash, salt }) => db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, id),
  setRole: (id, role, roleId) => db.prepare('UPDATE users SET role = ?, role_id = ? WHERE id = ?').run(role, roleId, id),
  setActive: (id, active) => db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id),

  // Two-step login
  setTotpPending: (id, secret) => db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, id),
  enableTotp: (id, step, recoveryHashes) =>
    db
      .prepare('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1, totp_last_step = ?, recovery_codes = ? WHERE id = ?')
      .run(step, JSON.stringify(recoveryHashes), id),
  clearTwoStep: (id) => db.prepare(`UPDATE users SET ${CLEAR_TWO_STEP} WHERE id = ?`).run(id),
  setRecoveryCodes: (id, hashes) => db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(hashes), id),
  setTotpLastStep: (id, step) => db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, id),
  recoveryCodes: (id) => JSON.parse(db.prepare('SELECT recovery_codes FROM users WHERE id = ?').get(id).recovery_codes || '[]'),
};

module.exports = UserModel;
