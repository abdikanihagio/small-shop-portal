// PostgreSQL access. SQL is written with ? placeholders; money is whole cents (BIGINT); dates are
// 'YYYY-MM-DD' text in the admin's time zone (TZ). Inside transaction(fn) every query runs on one
// connection, one transaction at a time.
const { AsyncLocalStorage } = require('node:async_hooks');
const pg = require('pg');
const config = require('./config');

pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);

const TIME_ZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const pool = new pg.Pool({
  ...(config.DATABASE_URL ? { connectionString: config.DATABASE_URL } : { database: config.DATABASE_NAME }),
  max: 10,
  options: `-c TimeZone=${TIME_ZONE}`,
});
pool.on('error', (err) => console.error('PostgreSQL connection error:', err.message));

const tx = new AsyncLocalStorage();

function toPg(sql) {
  let n = 0;
  let quoted = false;
  let out = '';
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === '?' && !quoted ? `$${++n}` : ch;
  }
  return out;
}

const query = (sql, params = []) => (tx.getStore() || pool).query(toPg(sql), params.map((v) => (v === undefined ? null : v)));

const db = {
  get: async (sql, ...p) => (await query(sql, p)).rows[0],
  all: async (sql, ...p) => (await query(sql, p)).rows,
  run: async (sql, ...p) => ({ changes: (await query(sql, p)).rowCount }),
  insert: async (sql, ...p) => (await query(`${sql} RETURNING id`, p)).rows[0].id,
  exec: (sql) => (tx.getStore() || pool).query(sql),
};

async function transaction(fn) {
  if (tx.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(9273)');
    const result = await tx.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admins_username ON admins (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  last_seen BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- A client shop that pays a monthly fee for its portal.
CREATE TABLE IF NOT EXISTS shops (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  portal_url TEXT NOT NULL DEFAULT '',
  monthly_fee_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_day INTEGER NOT NULL CHECK (billing_day BETWEEN 1 AND 28),
  grace_days INTEGER NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
  started_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  key_hash TEXT NOT NULL UNIQUE,
  key_hint TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  number TEXT NOT NULL UNIQUE,
  period TEXT NOT NULL,               -- 'YYYY-MM' for monthly fees; free text for other charges
  description TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  issued_on TEXT NOT NULL,
  due_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  monthly BOOLEAN NOT NULL DEFAULT false,
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One monthly invoice per shop per month (made by the schedule, so never twice).
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_monthly ON invoices (shop_id, period) WHERE monthly AND status <> 'void';

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  paid_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  reversed_at TIMESTAMPTZ,
  reversed_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  who TEXT NOT NULL,
  action TEXT NOT NULL,
  shop_id INTEGER,
  details TEXT NOT NULL DEFAULT ''
);
`;

async function initDatabase() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    const why = err.message || [err.code, ...(err.errors || []).map((e) => e.message)].filter(Boolean).join('; ') || 'unknown error';
    const where = config.DATABASE_URL ? 'DATABASE_URL' : `database "${config.DATABASE_NAME}"`;
    err.message = `Cannot connect to PostgreSQL (${where}): ${why}. On this computer, create it once with:  npm run db:create`;
    throw err;
  }
  await transaction(() => db.exec(SCHEMA));
}

const closeDatabase = () => pool.end().catch(() => {});

module.exports = { db, transaction, initDatabase, closeDatabase };
