// The shop's own logo and browser-tab icon, kept in the database so backups include them.
const { db } = require('../config/database');

const BrandingModel = {
  // { logo: '2026-11-14 10:02:11.123' | null, icon: … } — when each image last changed.
  async versions() {
    const out = { logo: null, icon: null };
    for (const r of await db.all('SELECT kind, updated_at FROM branding')) out[r.kind] = r.updated_at;
    return out;
  },

  find: (kind) => db.get('SELECT kind, mime, data, updated_at FROM branding WHERE kind = ?', kind),

  save: (kind, mime, data) =>
    db.run(
      `INSERT INTO branding (kind, mime, data, updated_at) VALUES (?, ?, ?, to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS'))
       ON CONFLICT (kind) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
      kind, mime, data
    ),

  remove: async (kind) => (await db.run('DELETE FROM branding WHERE kind = ?', kind)).changes,
};

module.exports = BrandingModel;
