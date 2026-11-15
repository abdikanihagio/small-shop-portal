// The PostgreSQL connection pool. Connection settings come from the environment / .env:
// DATABASE_URL, or the standard PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (see docker-compose.yml).
// All money values are stored as whole cents (BIGINT) to avoid rounding errors.
//
// Models write SQL with ? placeholders and call db.get / db.all / db.run / db.insert. Inside
// transaction(fn), every query made by fn (however deep) runs on that transaction's connection.
const { AsyncLocalStorage } = require('node:async_hooks');
const pg = require('pg');
require('./environment'); // loads .env into process.env before the pool reads it

// BIGINT and NUMERIC (sums of cents, counts) come back as plain numbers. Every amount stays far
// below 2^53 (see MAX_MONEY / MAX_QTY in constants.js), so this is exact.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);

// Dates are stored as local "YYYY-MM-DD HH:MM:SS" text, in this computer's time zone.
const TIME_ZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  max: 10,
  options: `-c TimeZone=${TIME_ZONE}`,
});
pool.on('error', (err) => console.error('PostgreSQL connection error:', err.message));

const tx = new AsyncLocalStorage();

// "? … ?" → "$1 … $2" (question marks inside '…' strings are left alone).
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

// Booleans are stored as 1 / 0 (like before); undefined means NULL.
const param = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v);

const query = (sql, params = []) => (tx.getStore() || pool).query(toPg(sql), params.map(param));

const db = {
  get: async (sql, ...params) => (await query(sql, params)).rows[0],
  all: async (sql, ...params) => (await query(sql, params)).rows,
  // Returns { changes } (rows affected).
  run: async (sql, ...params) => ({ changes: (await query(sql, params)).rowCount }),
  // INSERT … → the new row's id.
  insert: async (sql, ...params) => (await query(`${sql} RETURNING id`, params)).rows[0].id,
  // Several statements, no parameters (schema).
  exec: (sql) => (tx.getStore() || pool).query(sql),
};

// Runs fn inside a transaction (rolled back if it throws). Transactions run one at a time, so two
// tills can never sell the last item twice. Nested calls join the outer one.
async function transaction(fn) {
  if (tx.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7461)');
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

// Connects and brings the tables up to date. Called once at startup.
async function initDatabase() {
  const { migrate } = require('../models/schema');
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    err.message = `Cannot connect to PostgreSQL (${err.message}). Is it running? Start it with:  docker compose up -d`;
    throw err;
  }
  await transaction(() => migrate(db));
}

const closeDatabase = () => pool.end().catch(() => {});

module.exports = { db, transaction, initDatabase, closeDatabase };
