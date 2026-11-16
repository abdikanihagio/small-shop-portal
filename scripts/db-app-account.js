// Sets up the portal's own database account: it owns the shop's tables but has no superuser,
// create-database or create-role rights, so even a mistake in the portal can only touch shop data.
// Run on the shop computer (PostgreSQL running), once after the first "docker compose up -d", and
// again whenever you change PGPASSWORD in .env:
//     node scripts\db-app-account.js
// Uses the administrator account from .env (PG_ADMIN_USER / PG_ADMIN_PASSWORD, the one Docker
// created) to create or update the portal's account (PGUSER / PGPASSWORD) for the database PGDATABASE.
require('../src/config/environment'); // loads .env
const pg = require('pg');

async function main() {
  const { PG_ADMIN_USER, PG_ADMIN_PASSWORD, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (!PG_ADMIN_USER || !PG_ADMIN_PASSWORD) throw new Error('Set PG_ADMIN_USER and PG_ADMIN_PASSWORD in .env (the administrator account Docker created).');
  if (!PGUSER || !PGPASSWORD || !PGDATABASE) throw new Error('Set PGUSER, PGPASSWORD and PGDATABASE in .env (the account the portal uses).');
  if (PGUSER === PG_ADMIN_USER) throw new Error('PGUSER must be a different account from PG_ADMIN_USER.');

  const admin = new pg.Client({ user: PG_ADMIN_USER, password: PG_ADMIN_PASSWORD, database: PGDATABASE, connectionString: undefined });
  await admin.connect();
  try {
    const exists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [PGUSER])).rowCount > 0;
    const sql = (await admin.query(`SELECT format('${exists ? 'ALTER' : 'CREATE'} ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text, $2::text) AS q`, [PGUSER, PGPASSWORD])).rows[0].q;
    await admin.query(sql);
    await admin.query((await admin.query('SELECT format($$ALTER DATABASE %I OWNER TO %I$$, $1::text, $2::text) AS q', [PGDATABASE, PGUSER])).rows[0].q);
    // Every table (their id sequences follow) and the activity-log guard function.
    const tables = (await admin.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows;
    for (const { tablename } of tables) {
      await admin.query((await admin.query('SELECT format($$ALTER TABLE public.%I OWNER TO %I$$, $1::text, $2::text) AS q', [tablename, PGUSER])).rows[0].q);
    }
    const fn = await admin.query("SELECT 1 FROM pg_proc WHERE proname = 'audit_log_append_only'");
    if (fn.rowCount) await admin.query((await admin.query('SELECT format($$ALTER FUNCTION public.audit_log_append_only() OWNER TO %I$$, $1::text) AS q', [PGUSER])).rows[0].q);
    console.log(`The portal's account "${PGUSER}" is ${exists ? 'updated' : 'created'}: owner of ${tables.length} tables in "${PGDATABASE}", no superuser rights.`);
  } finally {
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
