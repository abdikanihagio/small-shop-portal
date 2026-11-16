// Backups: automatic daily backup, manual backup, download, upload, restore, retention and access rules.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { startServer, request, sid, sql } from './helpers.mjs';

let S, owner, manager, cashier;
const call = (method, p, opts = {}) => request(S.base, method, p, opts);
const login = async (username, password) => sid(await call('POST', '/api/login', { body: { username, password } }));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const count = async (table) => Number((await sql(S.database, `SELECT COUNT(*) AS n FROM ${table}`))[0].n);

before(async () => {
  S = await startServer({ env: { BACKUP_FIRST_CHECK_MS: '300' } });
  owner = sid(await call('POST', '/api/setup', { body: { username: 'owner', password: 'Copper#Lantern2026', shop_name: 'Backup Shop' } }));
  // These tests sell without opening cash shifts (shifts are tested in shifts-expiry.test.mjs).
  await call('PUT', '/api/settings', { cookie: owner, body: { require_shift: '0' } });
  await call('POST', '/api/users', { cookie: owner, body: { username: 'manager', password: 'Ledger#Balance2026', role: 'admin' } });
  await call('POST', '/api/users', { cookie: owner, body: { username: 'cashier', password: 'Staff#Pass2026', role: 'staff' } });
  manager = await login('manager', 'Ledger#Balance2026');
  cashier = await login('cashier', 'Staff#Pass2026');
  await call('POST', '/api/products', { cookie: owner, body: { sku: 'A1', name: 'Rice', cost: 4, price: 6, stock: 10 } });
  await call('POST', '/api/sales', { cookie: owner, body: { items: [{ product_id: 1, qty: 2 }] } });
  await call('PUT', '/api/branding/logo', { cookie: owner, body: PNG, type: 'application/octet-stream' });
});

test('a daily automatic backup is made soon after the portal starts', async () => {
  let s;
  for (let i = 0; i < 40; i++) {
    s = (await call('GET', '/api/backups', { cookie: owner })).json;
    if (s.last_auto) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(s.last_auto, 'automatic backup exists');
  assert.equal(s.last_auto.kind, 'auto');
  assert.equal(s.auto_error, null);
  assert.equal(s.backups.filter((b) => b.kind === 'auto').length, 1, 'only one per day');
});

test('only admins may see, make or download backups; names cannot point outside the backup folder', async () => {
  assert.equal((await call('GET', '/api/backups')).status, 401);
  assert.equal((await call('GET', '/api/backups', { cookie: cashier })).status, 403);
  assert.equal((await call('POST', '/api/backups', { cookie: cashier })).status, 403);
  assert.equal((await call('POST', '/api/backups/upload', { cookie: cashier, body: 'x', type: 'application/octet-stream' })).status, 403);
  for (const bad of ['..%5c..%5cserver.js', '..%2F..%2F.env', 'shop-backup-x.json.gz', 'shop.db']) {
    const r = await call('GET', `/api/backups/${bad}/download`, { cookie: owner });
    assert.ok([400, 404].includes(r.status), `${bad} → ${r.status}`);
    assert.ok(!/PGPASSWORD|createServer/.test(r.text));
  }
});

test('back up now, download, change things, then restore: everything returns to the backup', async () => {
  const made = await call('POST', '/api/backups', { cookie: manager });
  assert.equal(made.status, 200);
  assert.equal(made.json.kind, 'manual');

  assert.equal((await call('GET', `/api/backups/${made.json.name}/download`, { cookie: manager })).status, 403, 'backups hold every password hash: owner only');
  const dl = await fetch(`${S.base}/api/backups/${made.json.name}/download`, { headers: { Cookie: owner } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  const file = Buffer.from(await dl.arrayBuffer());
  const doc = JSON.parse(zlib.gunzipSync(file).toString());
  assert.equal(doc.format, 'small-shop-backup');
  assert.equal(doc.tables.sales.length, 1);
  assert.equal(doc.counts.products, 1);

  // Changes after the backup.
  await call('POST', '/api/sales', { cookie: owner, body: { items: [{ product_id: 1, qty: 3 }] } });
  await call('POST', '/api/products', { cookie: owner, body: { sku: 'B2', name: 'Sugar', cost: 1, price: 2, stock: 5 } });
  await call('POST', '/api/customers', { cookie: owner, body: { name: 'Cara', phone: '0700000001' } });
  await call('DELETE', '/api/branding/logo', { cookie: owner });
  assert.equal(await count('sales'), 2);

  // Only the owner, and only with the typed confirmation.
  assert.equal((await call('POST', `/api/backups/${made.json.name}/restore`, { cookie: manager, body: { confirm: 'RESTORE' } })).status, 403);
  assert.equal((await call('POST', `/api/backups/${made.json.name}/restore`, { cookie: owner, body: {} })).status, 400);
  const r = await call('POST', `/api/backups/${made.json.name}/restore`, { cookie: owner, body: { confirm: 'RESTORE' } });
  assert.equal(r.status, 200, r.text);

  assert.equal(await count('sales'), 1, 'the later sale is gone');
  assert.equal(await count('products'), 1);
  assert.equal(await count('customers'), 0);
  assert.equal((await sql(S.database, 'SELECT stock FROM products WHERE id = 1'))[0].stock, 8, 'stock as it was');
  const logo = await fetch(`${S.base}/api/branding/logo`);
  assert.deepEqual(Buffer.from(await logo.arrayBuffer()), PNG, 'logo bytes restored exactly');

  // A safety backup of the data from just before the restore exists and has both sales.
  const s = (await call('GET', '/api/backups', { cookie: owner })).json;
  const safety = s.backups.find((b) => b.name === r.json.safety_backup);
  assert.equal(safety.kind, 'before-restore');
  const safetyDoc = JSON.parse(zlib.gunzipSync(Buffer.from(await (await fetch(`${S.base}/api/backups/${safety.name}/download`, { headers: { Cookie: owner } })).arrayBuffer())).toString());
  assert.equal(safetyDoc.tables.sales.length, 2);

  // The shop keeps working: numbering continues, the activity log is still append-only and records the restore.
  const sale = await call('POST', '/api/sales', { cookie: owner, body: { items: [{ product_id: 1, qty: 1 }] } });
  assert.equal(sale.status, 200);
  assert.equal(sale.json.id, 2);
  await assert.rejects(sql(S.database, 'DELETE FROM audit_log'), /append-only/);
  const log = (await call('GET', '/api/audit', { cookie: owner })).json.map((x) => x.action);
  assert.ok(log.includes('backup.restored') && log.includes('backup.created'));
});

test('uploading: only real backup files are accepted', async () => {
  const up = (body) => call('POST', '/api/backups/upload', { cookie: owner, body, type: 'application/octet-stream' });
  assert.equal((await call('POST', '/api/backups/upload', { cookie: manager, body: Buffer.from('x'), type: 'application/octet-stream' })).status, 403, 'only the owner brings a backup in');
  assert.equal((await up(Buffer.from('not a backup'))).status, 400);
  assert.equal((await up(zlib.gzipSync('{"format":"something-else"}'))).status, 400);
  assert.equal((await up(zlib.gzipSync(JSON.stringify({ format: 'small-shop-backup', version: 1, tables: { users: [] } })))).status, 400, 'no admin account');
  const name = (await call('GET', '/api/backups', { cookie: owner })).json.backups.find((b) => b.kind === 'manual').name;
  const file = Buffer.from(await (await fetch(`${S.base}/api/backups/${name}/download`, { headers: { Cookie: owner } })).arrayBuffer());
  const r = await up(file);
  assert.equal(r.status, 200);
  assert.equal(r.json.kind, 'uploaded');
});

test('old backups are removed: at most 20 manual/other files are kept', async () => {
  for (let i = 0; i < 22; i++) assert.equal((await call('POST', '/api/backups', { cookie: owner })).status, 200);
  const s = (await call('GET', '/api/backups', { cookie: owner })).json;
  assert.equal(s.backups.filter((b) => b.kind !== 'auto').length, 20);
  assert.equal(s.backups.filter((b) => b.kind === 'auto').length, 1, 'the automatic one is kept separately');
});
