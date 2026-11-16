// Settings that come from the environment, or from an optional .env file next to package.json.
// Real environment variables always win over the .env file. Secrets (such as TLS_PASSPHRASE) have
// no defaults and are only ever read here, never logged or sent to the browser.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) {
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(envFile, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

module.exports = Object.freeze({
  ROOT_DIR,
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
  PORT: Number(process.env.PORT) || 3000,
  // Leave HOST empty to accept connections from the shop network; set 127.0.0.1 for this PC only.
  HOST: process.env.HOST || undefined,
  DATA_DIR: process.env.DATA_DIR || path.join(ROOT_DIR, 'data'),
  // Where backups are kept (default: DATA_DIR\backups). Pointing it at another disk is safer.
  BACKUP_DIR: process.env.BACKUP_DIR || path.join(process.env.DATA_DIR || path.join(ROOT_DIR, 'data'), 'backups'),
  // First automatic-backup check after start (ms); then every hour.
  BACKUP_FIRST_CHECK_MS: Number(process.env.BACKUP_FIRST_CHECK_MS) || 60_000,
  TLS_PFX: process.env.TLS_PFX || '',
  TLS_PASSPHRASE: process.env.TLS_PASSPHRASE,
  TLS_CERT: process.env.TLS_CERT || '',
  TLS_KEY: process.env.TLS_KEY || '',
});
