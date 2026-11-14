const { db } = require('../config/database');

const parse = (r) => r && { ...r, permissions: JSON.parse(r.permissions || '[]') };

const RoleModel = {
  listWithUserCounts: () =>
    db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.role = 'staff') AS users
         FROM roles r ORDER BY r.builtin DESC, r.name COLLATE NOCASE`
      )
      .all()
      .map(parse),

  findById: (id) => parse(db.prepare('SELECT * FROM roles WHERE id = ?').get(id)),
  builtinId: () => db.prepare('SELECT id FROM roles WHERE builtin = 1').get().id,
  nameTaken: (name, exceptId = 0) => !!db.prepare('SELECT 1 FROM roles WHERE name = ? AND id != ?').get(name, exceptId),

  create: (name, permissions) => db.prepare('INSERT INTO roles (name, permissions) VALUES (?, ?)').run(name, JSON.stringify(permissions)).lastInsertRowid,
  update: (id, name, permissions) => db.prepare('UPDATE roles SET name = ?, permissions = ? WHERE id = ?').run(name, JSON.stringify(permissions), id),

  staffCount: (id) => db.prepare("SELECT COUNT(*) n FROM users WHERE role_id = ? AND role = 'staff'").get(id).n,
  remove(id) {
    db.prepare('UPDATE users SET role_id = NULL WHERE role_id = ?').run(id); // admins may still point at it
    db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  },
};

module.exports = RoleModel;
