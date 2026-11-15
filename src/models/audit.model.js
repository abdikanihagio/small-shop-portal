// The append-only activity log (the database refuses edits and deletes of these rows).
const { db } = require('../config/database');

const AuditModel = {
  insert: ({ userId, username, action, entity, entityId, details, ip }) =>
    db.run(
      'INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
      userId, username, action, entity, entityId, details, ip
    ),

  // Newest first; action filters by prefix (e.g. "login", "sale").
  list: (from, to, action) =>
    db.all(
      `SELECT * FROM audit_log WHERE left(created_at, 10) BETWEEN ? AND ? ${action ? 'AND action LIKE ?' : ''}
       ORDER BY id DESC LIMIT 2000`,
      ...[from, to, ...(action ? [action.replace(/[\\%_]/g, '\\$&') + '%'] : [])]
    ),
};

module.exports = AuditModel;
