// Sessions store only a SHA-256 hash of the sign-in token held in the browser cookie.
const { db } = require('../config/database');

const SessionModel = {
  create: (hash, userId, expiresAt, now) =>
    db.run('INSERT INTO sessions (token, user_id, expires_at, last_seen) VALUES (?, ?, ?, ?)', hash, userId, expiresAt, now),

  // The signed-in user (with their role) for a live session, or undefined.
  findUser: (hash, now, idleCutoff) =>
    db.get(
      `SELECT u.id, u.username, u.name, u.role, u.is_owner, s.last_seen, r.name AS role_name, r.permissions AS role_permissions
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN roles r ON r.id = u.role_id
       WHERE s.token = ? AND s.expires_at > ? AND COALESCE(s.last_seen, 0) > ? AND u.active = 1`,
      hash, now, idleCutoff
    ),

  touch: (hash, now) => db.run('UPDATE sessions SET last_seen = ? WHERE token = ?', now, hash),
  remove: (hash) => db.run('DELETE FROM sessions WHERE token = ?', hash),
  removeStale: (now, idleCutoff) => db.run('DELETE FROM sessions WHERE expires_at < ? OR COALESCE(last_seen, 0) < ?', now, idleCutoff),

  // Signs a user out everywhere, optionally keeping one session. Returns how many were ended.
  removeForUser: async (userId, keepHash = null) =>
    (await db.run('DELETE FROM sessions WHERE user_id = ? AND token IS DISTINCT FROM ?', userId, keepHash)).changes,
};

module.exports = SessionModel;
