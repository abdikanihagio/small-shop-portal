// Settings from the environment, or from admin/.env (then the shop's ../.env for the shared local
// PostgreSQL login). Real environment variables always win. Secrets are only read here, never logged.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

const ROOT_DIR = path.resolve(__dirname, '..');

for (const file of [path.join(ROOT_DIR, '.env'), path.join(ROOT_DIR, '..', '.env')]) {
  if (!fs.existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    // The shop's own database name and URL must never leak into the admin portal.
    if (file !== path.join(ROOT_DIR, '.env') && ['PGDATABASE', 'DATABASE_URL', 'PORT'].includes(key)) continue;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

module.exports = Object.freeze({
  ROOT_DIR,
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  PORT: Number(process.env.PORT) || 3200,
  HOST: process.env.HOST || undefined,
  // Its own database: DATABASE_URL, or the PG* login with ADMIN_PGDATABASE (default waxool_admin).
  DATABASE_URL: process.env.DATABASE_URL || '',
  DATABASE_NAME: process.env.ADMIN_PGDATABASE || 'waxool_admin',
  // Behind a hosting service's HTTPS proxy (Railway): how many proxies are in front (usually 1).
  TRUST_PROXY: Math.max(0, Math.floor(Number(process.env.TRUST_PROXY) || 0)),
  // Lets the first admin account be created over the internet (hosting), by whoever knows it.
  SETUP_TOKEN: process.env.SETUP_TOKEN || '',
  // How often to check whether new monthly invoices are due (ms; default hourly).
  INVOICE_CHECK_MS: Number(process.env.INVOICE_CHECK_MS) || 3600e3,
});
