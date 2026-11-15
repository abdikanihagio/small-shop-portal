const { db } = require('../config/database');

const parse = (r) => r && { ...r, permissions: JSON.parse(r.permissions || '[]') };

// Role names are unique ignoring upper/lower case.
const RoleModel = {
  listWithUserCounts: async () =>
    (
      await db.all(
        `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.role = 'staff') AS users
         FROM roles r ORDER BY r.builtin DESC, lower(r.name)`
      )
    ).map(parse),

  findById: async (id) => parse(await db.get('SELECT * FROM roles WHERE id = ?', id)),
  builtinId: async () => (await db.get('SELECT id FROM roles WHERE builtin = 1')).id,
  nameTaken: async (name, exceptId = 0) => !!(await db.get('SELECT 1 FROM roles WHERE lower(name) = lower(?) AND id != ?', name, exceptId)),

  create: (name, permissions) => db.insert('INSERT INTO roles (name, permissions) VALUES (?, ?)', name, JSON.stringify(permissions)),
  update: (id, name, permissions) => db.run('UPDATE roles SET name = ?, permissions = ? WHERE id = ?', name, JSON.stringify(permissions), id),

  staffCount: async (id) => (await db.get("SELECT COUNT(*) AS n FROM users WHERE role_id = ? AND role = 'staff'", id)).n,
  async remove(id) {
    await db.run('UPDATE users SET role_id = NULL WHERE role_id = ?', id); // admins may still point at it
    await db.run('DELETE FROM roles WHERE id = ?', id);
  },
};

module.exports = RoleModel;
