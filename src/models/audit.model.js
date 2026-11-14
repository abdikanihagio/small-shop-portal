// The append-only activity log (the database refuses edits and deletes of these rows).
const { db } = require('../config/database');

const AuditModel = {
  insert: ({ userId, username, action, entity, entityId, details, ip }) =>
    db
      .prepare('INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, username, action, entity, entityId, details, ip),

  // Newest first; action filters by prefix (e.g. "login", "sale").
  list: (from, to, action) =>
    db
      .prepare(
        `SELECT * FROM audit_log WHERE date(created_at) BETWEEN ? AND ? ${action ? 'AND action LIKE ?' : ''}
         ORDER BY id DESC LIMIT 2000`
      )
      .all(...[from, to, ...(action ? [action + '%'] : [])]),
};

module.exports = AuditModel;
