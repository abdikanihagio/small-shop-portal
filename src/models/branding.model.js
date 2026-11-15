// The shop's own logo and browser-tab icon, kept in the database so backups include them.
const { db } = require('../config/database');

const BrandingModel = {
  // { logo: '2026-11-14 10:02:11' | null, icon: … } — when each image last changed.
  versions() {
    const rows = db.prepare('SELECT kind, updated_at FROM branding').all();
    const out = { logo: null, icon: null };
    for (const r of rows) out[r.kind] = r.updated_at;
    return out;
  },

  find(kind) {
    return db.prepare('SELECT kind, mime, data, updated_at FROM branding WHERE kind = ?').get(kind);
  },

  save(kind, mime, data) {
    db.prepare(
      `INSERT INTO branding (kind, mime, data, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f','now','localtime'))
       ON CONFLICT(kind) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
    ).run(kind, mime, data);
  },

  remove(kind) {
    return db.prepare('DELETE FROM branding WHERE kind = ?').run(kind).changes;
  },
};

module.exports = BrandingModel;
