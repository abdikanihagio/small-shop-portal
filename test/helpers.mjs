// Shared by the test files: start throwaway portals (own port, own temporary database, so real shop
// data is never touched) and call their API the way the portal page does. Contains no tests.
import { after } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const servers = [];

// Starts a portal. dataDir: an existing folder (e.g. holding an old database); default a new empty one.
// Every portal started by a test file is stopped and its folder deleted when that file's tests end.
export async function startServer({ env = {}, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-test-')) } = {}) {
  const port = 40000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...env } });
  servers.push({ child, dataDir });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', (d) => d.toString().includes('running at') && (clearTimeout(t), resolve()));
    child.on('exit', (code) => reject(new Error('server exited ' + code)));
  });
  return { port, dataDir, base: `http://127.0.0.1:${port}` };
}

// Registered once per test file, at the top level (a hook added from inside before() never runs).
after(stopServers);

function stopServers() {
  for (const s of servers.splice(0)) {
    s.child.kill();
    try {
      fs.rmSync(s.dataDir, { recursive: true, force: true });
    } catch {}
  }
}

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
