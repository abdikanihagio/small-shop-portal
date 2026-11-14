// Database tables and upgrades for databases created by earlier versions.
// Every step checks what already exists, so running it on every start is safe.
const crypto = require('node:crypto');
const { DEFAULT_SETTINGS, PAYMENT_REFS, formatRef } = require('../config/constants');

function migrate(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('admin','staff')),
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'pcs',
    cost_cents INTEGER NOT NULL DEFAULT 0,
    price_cents INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    type TEXT NOT NULL CHECK (type IN ('opening','purchase','adjustment','sale','void','return')),
    qty_change INTEGER NOT NULL,
    unit_cost_cents INTEGER NOT NULL DEFAULT 0,
    supplier TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    sale_id INTEGER REFERENCES sales(id),
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY,
    customer TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL DEFAULT 'cash',
    subtotal_cents INTEGER NOT NULL,
    discount_cents INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL,
    cogs_cents INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','void')),
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price_cents INTEGER NOT NULL,
    cost_cents INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    id_number TEXT NOT NULL DEFAULT '',
    credit_limit_cents INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS customer_payments (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    amount_cents INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'cash',
    note TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    contact_person TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    tax_id TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- One stock delivery (it can contain many products, see stock_movements.purchase_id).
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY,
    supplier_id INTEGER REFERENCES suppliers(id),
    supplier TEXT NOT NULL DEFAULT '',
    invoice TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL DEFAULT 'cash',
    total_cents INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS supplier_payments (
    id INTEGER PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    amount_cents INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'cash',
    note TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Items brought back from a sale. A sale can have several returns until everything is back.
  -- Money amounts are this return's share of the sale (so all returns together never exceed it).
  CREATE TABLE IF NOT EXISTS returns (
    id INTEGER PRIMARY KEY,
    ref TEXT,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    customer_id INTEGER REFERENCES customers(id),
    refund_method TEXT NOT NULL,            -- cash | card | mobile | credit (taken off / added to the customer's account)
    subtotal_cents INTEGER NOT NULL,        -- items at the price sold
    discount_cents INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL,           -- refund = subtotal - discount + tax
    cogs_cents INTEGER NOT NULL DEFAULT 0,  -- cost of all returned items
    written_off_cents INTEGER NOT NULL DEFAULT 0, -- cost of damaged items not put back in stock
    reason TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS return_items (
    id INTEGER PRIMARY KEY,
    return_id INTEGER NOT NULL REFERENCES returns(id),
    sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price_cents INTEGER NOT NULL,
    cost_cents INTEGER NOT NULL,
    restocked INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(sale_id);
  CREATE INDEX IF NOT EXISTS idx_returns_created ON returns(created_at);
  CREATE INDEX IF NOT EXISTS idx_return_items_sale_item ON return_items(sale_item_id);

  -- Append-only record of who did what (logins, money, prices, users, settings).
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    user_id INTEGER REFERENCES users(id),
    username TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    entity TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT ''
  );
  CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

  CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
  CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_spayments_supplier ON supplier_payments(supplier_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_payments_customer ON customer_payments(customer_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_items_sale ON sale_items(sale_id);
  CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_movements(product_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  `);

  // Migrations for databases created by earlier versions.
  const saleColumns = db.prepare('PRAGMA table_info(sales)').all().map((c) => c.name);
  if (!saleColumns.includes('customer_id')) db.exec('ALTER TABLE sales ADD COLUMN customer_id INTEGER REFERENCES customers(id)');
  // Set when the discount was given as a percentage (discount_cents still holds the money value).
  if (!saleColumns.includes('discount_percent')) db.exec('ALTER TABLE sales ADD COLUMN discount_percent REAL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id, created_at)');
  const moveColumns = db.prepare('PRAGMA table_info(stock_movements)').all().map((c) => c.name);
  if (!moveColumns.includes('purchase_id')) db.exec('ALTER TABLE stock_movements ADD COLUMN purchase_id INTEGER REFERENCES purchases(id)');
  const movesSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stock_movements'").get().sql;
  if (!movesSql.includes("'return'")) {
    // SQLite cannot change a CHECK rule in place: copy into a new table with the wider rule.
    db.exec(`BEGIN;
      CREATE TABLE stock_movements_new (
        id INTEGER PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        type TEXT NOT NULL CHECK (type IN ('opening','purchase','adjustment','sale','void','return')),
        qty_change INTEGER NOT NULL,
        unit_cost_cents INTEGER NOT NULL DEFAULT 0,
        supplier TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        sale_id INTEGER REFERENCES sales(id),
        user_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        purchase_id INTEGER REFERENCES purchases(id),
        return_id INTEGER REFERENCES returns(id)
      );
      INSERT INTO stock_movements_new (id, product_id, type, qty_change, unit_cost_cents, supplier, note, sale_id, user_id, created_at, purchase_id)
        SELECT id, product_id, type, qty_change, unit_cost_cents, supplier, note, sale_id, user_id, created_at, purchase_id FROM stock_movements;
      DROP TABLE stock_movements;
      ALTER TABLE stock_movements_new RENAME TO stock_movements;
      CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_movements(product_id, created_at);
      COMMIT;`);
  } else if (!db.prepare('PRAGMA table_info(stock_movements)').all().some((c) => c.name === 'return_id')) {
    db.exec('ALTER TABLE stock_movements ADD COLUMN return_id INTEGER REFERENCES returns(id)');
  }

  // Roles for non-admin accounts: a name and a list of permissions (see src/config/permissions.js).
  // Admins always have every permission. "Cashier" is built in (can be edited, not deleted).
  db.exec(`CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    permissions TEXT NOT NULL DEFAULT '[]',
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'role_id')) {
    db.exec('ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id)');
  }
  if (!db.prepare('SELECT 1 FROM roles WHERE builtin = 1').get()) {
    const cashier = db
      .prepare("INSERT INTO roles (name, permissions, builtin) VALUES ('Cashier', ?, 1)")
      .run(JSON.stringify(['sell', 'sales.view', 'products.view', 'inventory.view'])).lastInsertRowid;
    db.prepare("INSERT OR IGNORE INTO roles (name, permissions) VALUES ('Supply chain', ?)").run(
      JSON.stringify(['products.view', 'products.manage', 'costs.view', 'inventory.view', 'inventory.manage', 'suppliers.manage'])
    );
    db.prepare("UPDATE users SET role_id = ? WHERE role = 'staff' AND role_id IS NULL").run(cashier);
  }

  // The owner is the account created at setup. Only the owner can change other admins or the owner
  // account. Older databases: the earliest admin becomes the owner.
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'is_owner')) {
    db.exec('ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0');
  }
  if (!db.prepare('SELECT 1 FROM users WHERE is_owner = 1').get()) {
    db.exec("UPDATE users SET is_owner = 1 WHERE id = (SELECT MIN(id) FROM users WHERE role = 'admin')");
  }

  // Two-step login (authenticator app). totp_pending holds a secret while it is being set up;
  // recovery_codes is a JSON list of SHA-256 hashes of unused recovery codes.
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('totp_secret')) {
    db.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT;
      ALTER TABLE users ADD COLUMN totp_pending TEXT;
      ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT -1;
      ALTER TABLE users ADD COLUMN recovery_codes TEXT NOT NULL DEFAULT '[]'`);
  }

  // Sessions store only a SHA-256 hash of the sign-in token, so a copy of this database file
  // cannot be used to sign in. Existing sessions are converted once, keeping everyone signed in.
  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (!sessionCols.includes('last_seen')) db.exec('ALTER TABLE sessions ADD COLUMN last_seen INTEGER');
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'sys_sessions_hashed'").get()) {
    const rows = db.prepare('SELECT token FROM sessions').all();
    const upd = db.prepare('UPDATE sessions SET token = ?, last_seen = ? WHERE token = ?');
    db.exec('BEGIN');
    for (const r of rows) upd.run(crypto.createHash('sha256').update(r.token).digest('hex'), Date.now(), r.token);
    db.prepare("INSERT INTO settings (key, value) VALUES ('sys_sessions_hashed', '1')").run();
    db.exec('COMMIT');
  }

  // Payments and expenses are never deleted; mistakes are reversed and stay visible.
  for (const table of ['customer_payments', 'supplier_payments', 'expenses']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes('reversed_at')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN reversed_at TEXT`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN reversed_by INTEGER REFERENCES users(id)`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN reverse_reason TEXT NOT NULL DEFAULT ''`);
    }
  }

  // Payment reference numbers (CUST001, SUPP001, …). Counters live in settings and only go up,
  // so a number is never reused even if a payment is deleted.
  for (const { table, counter, prefix } of PAYMENT_REFS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes('ref')) db.exec(`ALTER TABLE ${table} ADD COLUMN ref TEXT`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_ref ON ${table}(ref)`);
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, '0')").run(counter);
    // Number any payments recorded before references existed, oldest first.
    const missing = db.prepare(`SELECT id FROM ${table} WHERE ref IS NULL ORDER BY id`).all();
    if (missing.length) {
      let n = Number(db.prepare('SELECT value FROM settings WHERE key = ?').get(counter).value);
      const setRef = db.prepare(`UPDATE ${table} SET ref = ? WHERE id = ?`);
      for (const row of missing) setRef.run(formatRef(prefix, ++n), row.id);
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(n), counter);
    }
  }

  // Default shop settings (existing values are kept).
  const defaults = DEFAULT_SETTINGS;
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);
}

module.exports = { migrate };
