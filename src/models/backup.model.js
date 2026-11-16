// Reading and replacing every table at once, for backups and restores.
const { db } = require('../config/database');

// Parents before children, so every reference already exists when a row is put back.
const TABLES = Object.freeze([
  'roles', 'users', 'sessions', 'settings', 'cash_shifts', 'products', 'customers', 'suppliers', 'sales', 'sale_items',
  'purchases', 'returns', 'return_items', 'stock_movements', 'customer_payments', 'supplier_payments',
  'expenses', 'audit_log', 'branding', 'stock_batches',
]);
const ORDER_BY = { sessions: 'token', settings: 'key', branding: 'kind' }; // the rest by id

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

const columnsOf = async (table) =>
  (await db.all('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position', table)).map(
    (r) => r.column_name
  );

const BackupModel = {
  TABLES,

  // { table: [rows] } for every table. Call inside snapshot() so all tables are from the same instant.
  async readAll() {
    const out = {};
    for (const t of TABLES) out[t] = await db.all(`SELECT * FROM ${quote(t)} ORDER BY ${quote(ORDER_BY[t] || 'id')}`);
    return out;
  },

  // Replaces the contents of every table with `tables` ({ table: [rows] }). Call inside transaction().
  // Columns the backup has but this version doesn't are skipped; new columns get their defaults.
  async replaceAll(tables) {
    await db.exec('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_change'); // the log is append-only except for a restore
    await db.exec(`TRUNCATE ${TABLES.map(quote).join(', ')} RESTART IDENTITY CASCADE`);
    for (const t of TABLES) {
      const rows = tables[t] || [];
      const target = new Set(await columnsOf(t));
      if (rows.length) {
        const cols = Object.keys(rows[0]).filter((c) => target.has(c));
        const perChunk = Math.max(1, Math.floor(60000 / cols.length)); // PostgreSQL allows 65535 parameters per statement
        for (let i = 0; i < rows.length; i += perChunk) {
          const chunk = rows.slice(i, i + perChunk);
          const values = chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
          await db.run(`INSERT INTO ${quote(t)} (${cols.map(quote).join(', ')}) VALUES ${values}`, ...chunk.flatMap((r) => cols.map((c) => r[c])));
        }
      }
      // New rows continue numbering after the restored ones.
      if (target.has('id')) await db.get(`SELECT setval(pg_get_serial_sequence(?, 'id'), COALESCE((SELECT MAX(id) FROM ${quote(t)}), 0) + 1, false)`, t);
    }
    await db.exec('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_change');
  },
};

module.exports = BackupModel;
