// Creates the admin portal's own database on this computer's PostgreSQL (the one in
// ../docker-compose.yml), owned by the portal account (PGUSER). Uses the administrator login
// PG_ADMIN_USER / PG_ADMIN_PASSWORD from .env. Safe to run again. Prints no passwords.
const pg = require('pg');
const config = require('../src/config');

(async () => {
  const name = config.DATABASE_NAME;
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unusable database name "${name}"`);
  const owner = process.env.PGUSER;
  if (!owner || !/^[a-z_][a-z0-9_]*$/.test(owner)) throw new Error('PGUSER is missing in .env');
  const c = new pg.Client({ user: process.env.PG_ADMIN_USER, password: process.env.PG_ADMIN_PASSWORD, database: 'postgres' });
  await c.connect();
  try {
    const exists = (await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount;
    if (exists) console.log(`Database "${name}" already exists`);
    else {
      await c.query(`CREATE DATABASE ${name} OWNER ${owner}`);
      console.log(`Created database "${name}" (owner ${owner})`);
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
