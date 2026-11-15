// Shared by the test files: start throwaway portals and call their API the way the portal page does.
// Each portal gets its own port, data folder and empty PostgreSQL database (shop_test_…, dropped when
// the file's tests end), so real shop data is never touched. PostgreSQL must be running
// (docker compose up -d) with the connection settings in .env. Contains no tests.
import { after } from 'node:test';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(ROOT, 'src/config/environment.js')); // loads .env (PGHOST, PGPASSWORD, …)
const pg = require('pg');

const servers = [];
const databases = [];

// A PostgreSQL client for one database (default: the server's maintenance database "postgres").
async function connect(database = 'postgres') {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL || undefined, database });
  await client.connect();
  return client;
}

// Creates an empty database for one test portal and returns its name.
export async function createDatabase() {
  const name = `shop_test_${crypto.randomBytes(6).toString('hex')}`;
  const admin = await connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  databases.push(name);
  return name;
}

// Runs one SQL statement in a test database; returns the rows.
export async function sql(database, text, params = []) {
  const client = await connect(database);
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

// Starts a portal. database: an existing test database (e.g. one filled by the copy script);
// default a new empty one. env: extra environment variables.
export async function startServer({ env = {}, database } = {}) {
  database ??= await createDatabase();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-test-'));
  // A random port; Windows reserves some ranges (e.g. for Docker / Hyper-V), so try another if refused.
  for (let attempt = 1; ; attempt++) {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const childEnv = { ...process.env, PORT: String(port), DATA_DIR: dataDir, PGDATABASE: database, DATABASE_URL: '', ...env };
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: childEnv });
    servers.push({ child, dataDir });
    let errors = '';
    child.stderr.on('data', (d) => (errors += d));
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('server did not start: ' + errors)), 15000);
        child.stdout.on('data', (d) => d.toString().includes('running at') && (clearTimeout(t), resolve()));
        child.on('exit', (code) => (clearTimeout(t), reject(new Error(`server exited ${code}: ${errors}`))));
      });
      return { port, dataDir, database, env: childEnv, base: `http://127.0.0.1:${port}` };
    } catch (err) {
      if (attempt >= 5 || !/EACCES|EADDRINUSE/.test(err.message)) throw err;
    }
  }
}

// Registered once per test file, at the top level (a hook added from inside before() never runs).
after(async () => {
  for (const s of servers.splice(0)) {
    s.child.kill();
    await new Promise((r) => (s.child.exitCode !== null ? r() : s.child.once('exit', r)));
    try {
      fs.rmSync(s.dataDir, { recursive: true, force: true });
    } catch {}
  }
  if (!databases.length) return;
  const admin = await connect();
  try {
    for (const name of databases.splice(0)) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

// One API request. Like the portal page, changes carry the X-Requested-With header
// (portalHeader: false leaves it out). A string or Buffer body is sent as-is with `type`.
export async function request(base, method, p, { cookie, body, type = 'application/json', portalHeader = true, origin } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = type;
  if (portalHeader && method !== 'GET') headers['X-Requested-With'] = 'shop-portal';
  if (origin) headers.Origin = origin;
  const t = performance.now();
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text, headers: r.headers, ms: performance.now() - t };
}

// The session cookie ("sid=…") a response sets.
export const sid = (r) => (r.headers.get('set-cookie') || '').match(/sid=[0-9a-f]+/)?.[0];
