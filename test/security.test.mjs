// Security regression tests. Run with:  npm test
// Each test run starts its own portal on a random port with an empty, temporary database,
// so real shop data is never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readXlsx, writeZip } = require('../lib/xlsx.js');
const totp = require('../lib/totp.js');
const qr = require('../lib/qr.js');
import { decodeQr } from './qr-decode.mjs';
import { ROOT, startServer, request, sid } from './helpers.mjs';

let S; // main test server
// base: another test server instead of the main one.
const call = (method, p, { base = S.base, ...opts } = {}) => request(base, method, p, opts);
const login = async (username, password) => sid(await call('POST', '/api/login', { body: { username, password } }));

const OWNER = { username: 'owner', password: 'Copper#Lantern2026' };
const STAFF = { username: 'cashier', password: 'Staff#Pass2026' };
const CASHIER_PERMS = ['sell', 'sales.view', 'products.view', 'inventory.view'];
let admin, staff;

before(async () => {
  S = await startServer();
  const r = await call('POST', '/api/setup', { body: { ...OWNER, shop_name: 'Test' } });
  assert.equal(r.status, 200, 'setup from this computer works');
  admin = sid(r);
  await call('POST', '/api/users', { cookie: admin, body: { ...STAFF, role: 'staff' } });
  staff = await login(STAFF.username, STAFF.password);
  await call('POST', '/api/products', { cookie: admin, body: { sku: 'R1', name: 'Rice', cost: 4, price: 10, stock: 500 } });
  await call('POST', '/api/customers', { cookie: admin, body: { name: '=HYPERLINK("http://x.invalid","Click")', phone: '0712345678', id_number: 'ID-1', notes: 'private' } });
  await call('POST', '/api/suppliers', { cookie: admin, body: { name: 'Wholesaler' } });
  await call('POST', '/api/inventory/restock', { cookie: admin, body: { supplier_id: 1, payment_method: 'credit', items: [{ product_id: 1, qty: 5, unit_cost: 4 }] } });
  await call('POST', '/api/sales', { cookie: admin, body: { items: [{ product_id: 1, qty: 2 }], payment_method: 'credit', customer_id: 1 } });
});

// ---------- authorization (regression) ----------

test('every protected route rejects anonymous users, and admin or permission routes reject a cashier without that permission', async () => {
  const routesDir = path.join(ROOT, 'src', 'routes');
  const src = fs.readdirSync(routesDir).filter((f) => f.endsWith('.routes.js')).map((f) => fs.readFileSync(path.join(routesDir, f), 'utf8')).join('\n');
  const routes = [...src.matchAll(/route\(\s*'(GET|POST|PUT|DELETE)',\s*'([^']+)',\s*'(public|user|admin|perm:[a-z.|]+)'/g)].map((m) => ({ method: m[1], path: m[2], access: m[3] }));
  assert.ok(routes.length > 40);
  for (const r of routes.filter((x) => x.access !== 'public')) {
    const p = r.path.replace(/:name/, 'sales.csv').replace(/:\w+/g, '1');
    const body = r.method === 'GET' || r.method === 'DELETE' ? undefined : {};
    assert.equal((await call(r.method, p, { body })).status, 401, `${r.method} ${r.path} anon`);
    const cashierCan = r.access.startsWith('perm:') && r.access.slice(5).split('|').some((p) => CASHIER_PERMS.includes(p));
    if (r.access === 'admin' || (r.access.startsWith('perm:') && !cashierCan)) assert.equal((await call(r.method, p, { cookie: staff, body })).status, 403, `${r.method} ${r.path} staff`);
  }
});

test('SQL injection probes and path traversal are rejected (regression)', async () => {
  assert.equal((await call('GET', "/api/sales?from=2026-01-01'%20OR%201=1--", { cookie: admin })).status, 400);
  assert.equal((await call('GET', '/api/customers/1%20OR%201=1', { cookie: admin })).status, 400);
  assert.equal((await call('POST', '/api/login', { body: { username: "' OR '1'='1", password: "' OR '1'='1" } })).status, 401);
  for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%5cserver.js', '/../data/shop.db']) {
    const r = await call('GET', p);
    assert.ok(!/createServer|DatabaseSync|SQLite format/.test(r.text), p);
  }
});

// ---------- M1: first-run setup ----------

test('M1: owner account can only be created from this computer', async () => {
  const fresh = await startServer();
  const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  if (lanIp) {
    const viaLan = `http://${lanIp}:${fresh.port}`;
    assert.equal((await call('GET', '/api/setup', { base: viaLan })).json.setupAllowed, false);
    const r = await call('POST', '/api/setup', { base: viaLan, body: { username: 'intruder', password: 'Intruder#2026' } });
    assert.equal(r.status, 403);
  }
  assert.equal((await call('GET', '/api/setup', { base: fresh.base })).json.setupAllowed, true);
  assert.equal((await call('POST', '/api/setup', { base: fresh.base, body: { username: 'o', password: 'Owner#Pass2026' } })).status, 200);
  assert.equal((await call('POST', '/api/setup', { base: fresh.base, body: { username: 'x', password: 'Owner#Pass2026' } })).status, 403);
});

// ---------- H3: staff discount limit ----------

test('H3: staff discounts are capped by the owner setting; admins are not', async () => {
  const sale = (cookie, discount, discount_type) => call('POST', '/api/sales', { cookie, body: { items: [{ product_id: 1, qty: 1 }], discount, discount_type } });
  assert.equal((await sale(staff, 100, 'percent')).status, 400);
  assert.equal((await sale(staff, 11, 'percent')).status, 400);
  assert.equal((await sale(staff, 10, 'percent')).status, 200);
  assert.equal((await sale(staff, 1.01, 'amount')).status, 400, 'money discount over 10% of $10');
  assert.equal((await sale(staff, 1, 'amount')).status, 200);
  assert.equal((await sale(admin, 100, 'percent')).status, 200);
  await call('PUT', '/api/settings', { cookie: admin, body: { max_staff_discount: 0 } });
  assert.equal((await sale(staff, 1, 'percent')).status, 400);
  await call('PUT', '/api/settings', { cookie: admin, body: { max_staff_discount: 10 } });
  assert.equal((await call('PUT', '/api/settings', { cookie: admin, body: { max_staff_discount: 150 } })).status, 400);
});

// ---------- M2: sessions ----------

test('M2: password reset and change sign out old sessions', async () => {
  await call('POST', '/api/users', { cookie: admin, body: { username: 'temp1', password: 'Temp#Pass2026', role: 'staff' } });
  const old = await login('temp1', 'Temp#Pass2026');
  assert.equal((await call('GET', '/api/me', { cookie: old })).status, 200);
  const id = (await call('GET', '/api/users', { cookie: admin })).json.find((u) => u.username === 'temp1').id;
  await call('PUT', `/api/users/${id}`, { cookie: admin, body: { password: 'Temp#Pass2027' } });
  assert.equal((await call('GET', '/api/me', { cookie: old })).status, 401, 'old session revoked after admin reset');

  const a = await login('temp1', 'Temp#Pass2027');
  const b = await login('temp1', 'Temp#Pass2027');
  const r = await call('POST', '/api/password', { cookie: a, body: { current: 'Temp#Pass2027', password: 'Temp#Pass2028' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.signed_out, 1);
  assert.equal((await call('GET', '/api/me', { cookie: a })).status, 200, 'current session kept');
  assert.equal((await call('GET', '/api/me', { cookie: b })).status, 401, 'other session revoked');

  const c = await login('temp1', 'Temp#Pass2028');
  assert.equal((await call('POST', '/api/sessions/revoke-others', { cookie: a })).json.signed_out, 1);
  assert.equal((await call('GET', '/api/me', { cookie: c })).status, 401);
});

test('M2/H1: new passwords must be 8–256 characters', async () => {
  const r = await call('POST', '/api/users', { cookie: admin, body: { username: 'longpw', password: 'x'.repeat(300) } });
  assert.equal(r.status, 400);
});

// ---------- M3: what staff can read ----------

test('M3: staff do not receive costs, profit, supplier details or customer personal data', async () => {
  const products = (await call('GET', '/api/products', { cookie: staff })).json;
  assert.ok(products.length && products.every((p) => !('cost_cents' in p)));
  const sales = (await call('GET', '/api/sales', { cookie: staff })).json;
  assert.ok(sales.length && sales.every((s) => !('cogs_cents' in s)));
  const sale = (await call('GET', '/api/sales/1', { cookie: staff })).json;
  assert.ok(!('cogs_cents' in sale) && sale.items.every((i) => !('cost_cents' in i)));
  const moves = (await call('GET', '/api/inventory/movements', { cookie: staff })).json;
  assert.ok(moves.length && moves.every((m) => !('unit_cost_cents' in m) && !('supplier' in m)));
  const customers = (await call('GET', '/api/customers', { cookie: staff })).json;
  assert.deepEqual(Object.keys(customers[0]).sort(), ['active', 'balance_cents', 'credit_limit_cents', 'id', 'name', 'phone']);
  assert.match(customers[0].phone, /^•••• 5678$/);
  // The owner still sees everything.
  assert.ok('cost_cents' in (await call('GET', '/api/products', { cookie: admin })).json[0]);
  assert.equal((await call('GET', '/api/customers', { cookie: admin })).json[0].id_number, 'ID-1');
});

// ---------- M4: CSV formula injection ----------

test('M4: exported CSV cells cannot run as spreadsheet formulas; staff cannot type customer names', async () => {
  const csv = (await call('GET', '/api/export/sales.csv?from=2000-01-01', { cookie: admin })).text;
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x.invalid"",""Click"")"`), 'formula neutralised with leading apostrophe');
  assert.ok(!/(^|,)"?=HYPERLINK/m.test(csv), 'no cell starts with =');

  const r = await call('POST', '/api/sales', { cookie: staff, body: { items: [{ product_id: 1, qty: 1 }], customer: '=HYPERLINK("http://x.invalid/s","s")' } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', `/api/sales/${r.json.id}`, { cookie: admin })).json.customer, '');

  // Negative amounts stay numbers (customer paid in advance → balance -X.00).
  await call('POST', '/api/customers', { cookie: admin, body: { name: 'Advance Payer', phone: '0700000002' } });
  const cust = (await call('GET', '/api/customers', { cookie: admin })).json.find((c) => c.name === 'Advance Payer');
  await call('POST', `/api/customers/${cust.id}/payments`, { cookie: admin, body: { amount: 5 } });
  const st = (await call('GET', `/api/customers/${cust.id}/statement.csv`, { cookie: admin })).text;
  assert.ok(st.trim().endsWith(',-5.00'), 'negative balance exported as a plain number');
});

// ---------- M5: audit log and reversals ----------

test('M5: payments are reversed (not deleted), cannot be reversed twice, and balances stay correct', async () => {
  const before = (await call('GET', '/api/customers/1', { cookie: admin })).json.balance_cents;
  const pay = (await call('POST', '/api/customers/1/payments', { cookie: admin, body: { amount: 3 } })).json.payment;
  assert.equal((await call('GET', '/api/customers/1', { cookie: admin })).json.balance_cents, before - 300);
  assert.equal((await call('DELETE', `/api/customers/1/payments/${pay.id}`, { cookie: admin })).status, 404, 'delete no longer exists');
  assert.equal((await call('POST', `/api/customers/1/payments/${pay.id}/reverse`, { cookie: admin, body: {} })).status, 400, 'reason required');
  assert.equal((await call('POST', `/api/customers/1/payments/${pay.id}/reverse`, { cookie: admin, body: { reason: 'entered twice' } })).status, 200);
  assert.equal((await call('POST', `/api/customers/1/payments/${pay.id}/reverse`, { cookie: admin, body: { reason: 'again' } })).status, 400);
  assert.equal((await call('GET', '/api/customers/1', { cookie: admin })).json.balance_cents, before, 'balance restored');
  const entry = (await call('GET', '/api/customers/1/statement', { cookie: admin })).json.entries.find((e) => e.ref === pay.ref);
  assert.equal(entry.status, 'reversed');
  assert.equal(entry.paid_cents, 0);

  const spay = (await call('POST', '/api/suppliers/1/payments', { cookie: admin, body: { amount: 2 } })).json.payment;
  assert.equal((await call('POST', `/api/suppliers/1/payments/${spay.id}/reverse`, { cookie: admin, body: { reason: 'wrong supplier' } })).status, 200);
  assert.equal((await call('GET', '/api/suppliers/1', { cookie: admin })).json.balance_cents, 2000);
});

test('M5: reversed expenses stay listed but stop counting', async () => {
  await call('POST', '/api/expenses', { cookie: admin, body: { category: 'Rent', amount: 50 } });
  const pl1 = (await call('GET', '/api/reports/pl', { cookie: admin })).json.total_expenses;
  const exp = (await call('GET', '/api/expenses', { cookie: admin })).json.expenses.find((e) => e.amount_cents === 5000);
  assert.equal((await call('DELETE', `/api/expenses/${exp.id}`, { cookie: admin })).status, 404);
  assert.equal((await call('POST', `/api/expenses/${exp.id}/reverse`, { cookie: admin, body: { reason: 'duplicate' } })).status, 200);
  assert.equal((await call('GET', '/api/reports/pl', { cookie: admin })).json.total_expenses, pl1 - 5000);
  assert.ok((await call('GET', '/api/expenses', { cookie: admin })).json.expenses.find((e) => e.id === exp.id).reversed_at);
});

test('M5: important actions are written to an append-only audit log that staff cannot read', async () => {
  await call('PUT', '/api/products/1', { cookie: admin, body: { sku: 'R1', name: 'Rice', cost: 4, price: 11 } });
  await call('POST', '/api/login', { body: { username: 'owner', password: 'wrong-password' } });
  const log = (await call('GET', '/api/audit?from=2000-01-01', { cookie: admin })).json;
  const actions = new Set(log.map((r) => r.action));
  for (const a of ['setup.owner_created', 'login.success', 'login.failed', 'user.created', 'user.updated', 'settings.updated', 'product.updated', 'stock.received', 'sale.discount', 'customer_payment.recorded', 'customer_payment.reversed', 'supplier_payment.reversed', 'expense.reversed']) {
    assert.ok(actions.has(a), `audit has ${a}`);
  }
  const price = log.find((r) => r.action === 'product.updated');
  assert.deepEqual(JSON.parse(price.details).price_cents, { from: 1000, to: 1100 });
  assert.equal((await call('GET', '/api/audit', { cookie: staff })).status, 403);

  const db = new DatabaseSync(path.join(S.dataDir, 'shop.db'));
  assert.throws(() => db.exec('DELETE FROM audit_log'), /append-only/);
  assert.throws(() => db.exec("UPDATE audit_log SET action = 'x'"), /append-only/);
  db.close();
});

// ---------- headers, cookies, robustness ----------

test('Security headers are sent on pages and API responses', async () => {
  for (const p of ['/', '/api/setup']) {
    const h = (await call('GET', p)).headers;
    assert.match(h.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(h.get('content-security-policy'), /script-src 'self'/);
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('referrer-policy'), 'no-referrer');
    assert.equal(h.get('strict-transport-security'), null, 'no HSTS over plain HTTP');
  }
});

test('A badly encoded cookie or URL from another app does not crash requests', async () => {
  assert.equal((await call('GET', '/api/me', { cookie: `other=%zz; ${admin}` })).status, 200);
  assert.equal((await call('GET', '/api/sales/%E0%A4%A', { cookie: admin })).status, 400);
});

// ---------- Priority 3 ----------

test('L2: changes without the portal header, with the wrong content type, or from another website are refused', async () => {
  const exp = { category: 'Other', amount: 1 };
  assert.equal((await call('POST', '/api/expenses', { cookie: admin, body: exp, portalHeader: false })).status, 403, 'no portal header');
  assert.equal((await call('POST', '/api/expenses', { cookie: admin, body: JSON.stringify(exp), type: 'text/plain' })).status, 415, 'text/plain form body');
  assert.equal((await call('POST', '/api/expenses', { cookie: admin, body: 'category=Other&amount=1', type: 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await call('POST', '/api/expenses', { cookie: admin, body: exp, origin: 'http://evil.example' })).status, 403, 'foreign Origin');
  assert.equal((await call('POST', '/api/products/import?filename=x.csv', { cookie: admin, body: 'Name,Price\nX,1\n', type: 'text/plain' })).status, 415, 'import needs a file upload');
  assert.equal((await call('POST', '/api/login', { body: OWNER, portalHeader: false })).status, 403, 'login form from elsewhere');
  assert.equal((await call('POST', '/api/expenses', { cookie: admin, body: exp, origin: S.base })).status, 200, 'same origin works');
  assert.equal((await call('GET', '/api/products', { cookie: admin, portalHeader: false })).status, 200, 'reading needs no header');
});

test('L4: amounts and quantities have sensible upper limits', async () => {
  const p = (body) => call('POST', '/api/products', { cookie: admin, body: { name: 'Big', cost: 1, price: 1, ...body } });
  assert.equal((await p({ sku: 'BIG1', price: 1e17 })).status, 400);
  assert.equal((await p({ sku: 'BIG2', price: 1_000_000_001 })).status, 400);
  assert.equal((await p({ sku: 'BIG3', stock: 2_000_000 })).status, 400);
  assert.equal((await p({ sku: 'BIG4', price: 1_000_000_000, stock: 1_000_000 })).status, 200, 'at the limits is fine');
  const id = (await call('GET', '/api/products', { cookie: admin })).json.find((x) => x.sku === 'BIG4').id;
  const r = await call('POST', '/api/sales', { cookie: admin, body: { items: [{ product_id: id, qty: 100000 }] } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /too large/);
  assert.equal((await call('POST', '/api/inventory/restock', { cookie: admin, body: { items: [{ product_id: id, qty: 1, unit_cost: 1 }] } })).status, 400, 'stock over the limit');
  assert.equal((await call('POST', '/api/expenses', { cookie: admin, body: { category: 'Rent', amount: 5e9 } })).status, 400);
});

test('L5: the movements "limit" parameter is validated', async () => {
  for (const v of ['-1', '0', '0.5', '5000', 'abc']) assert.equal((await call('GET', `/api/inventory/movements?limit=${v}`, { cookie: admin })).status, 400, v);
  const r = await call('GET', '/api/inventory/movements?limit=2', { cookie: admin });
  assert.equal(r.status, 200);
  assert.ok(r.json.length <= 2);
});

test('L6: the database stores only hashes of sign-in tokens, and idle sessions expire', async () => {
  const cookie = await login(STAFF.username, STAFF.password);
  const raw = cookie.split('=')[1];
  const db = new DatabaseSync(path.join(S.dataDir, 'shop.db'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token = ?').get(raw).n, 0, 'raw token not stored');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token = ?').get(crypto.createHash('sha256').update(raw).digest('hex')).n, 1);
  assert.equal((await call('GET', '/api/me', { cookie })).status, 200);
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(Date.now() - 13 * 3600e3, crypto.createHash('sha256').update(raw).digest('hex'));
  db.close();
  assert.equal((await call('GET', '/api/me', { cookie })).status, 401, 'idle for 13 hours → signed out');
});

test('L6: sessions created before the upgrade keep working after it (tokens hashed in place)', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-old-'));
  const old = new DatabaseSync(path.join(dataDir, 'shop.db'));
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT '');
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    INSERT INTO users (id, username, role, password_hash, salt) VALUES (1, 'owner', 'admin', 'aa', 'bb');`);
  const token = 'a'.repeat(64);
  old.prepare('INSERT INTO sessions VALUES (?, 1, ?)').run(token, Date.now() + 86400e3);
  old.close();
  const upgraded = await startServer({ dataDir });
  const r = await call('GET', '/api/me', { base: upgraded.base, cookie: `sid=${token}` });
  assert.equal(r.status, 200, 'old sign-in still valid');
  assert.equal(r.json.user.username, 'owner');
  assert.equal(r.json.user.is_owner, 1, 'existing earliest admin becomes the owner');
});

test('L7: easy-to-guess passwords are refused for new and changed passwords', async () => {
  const add = (username, password) => call('POST', '/api/users', { cookie: admin, body: { username, password } });
  for (const pw of ['password123', 'Password1', '12345678', 'qwertyuiop', 'aaaaaaaaaa', 'maryjones2026', 'Test-shop-2026']) {
    const r = await add('maryjones', pw);
    assert.equal(r.status, 400, pw);
    assert.match(r.json.error, /too easy/);
  }
  assert.equal((await add('maryjones', 'blue tiger lamp river')).status, 200, 'a passphrase is accepted');
  const r = await call('POST', '/api/password', { cookie: admin, body: { current: OWNER.password, password: 'iloveyou1' } });
  assert.equal(r.status, 400);
});

test('L7: first-time setup also refuses a password containing the shop name being entered', async () => {
  const t = await startServer();
  const r = await call('POST', '/api/setup', { base: t.base, body: { username: 'amina', password: 'Corner Market 2026', shop_name: 'Corner Market' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /too easy/);
  assert.equal((await call('POST', '/api/setup', { base: t.base, body: { username: 'amina', password: 'blue tiger lamp river', shop_name: 'Corner Market' } })).status, 200);
});

test('A: first-run setup refuses requests addressed to another website name (DNS rebinding)', async () => {
  const t = await startServer();
  // fetch() silently drops a custom Host header, so send a raw request that really carries it.
  const status = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ username: 'attacker', password: 'blue tiger lamp river' });
    const req = http.request(
      { host: '127.0.0.1', port: t.port, path: '/api/setup', method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Requested-With': 'shop-portal' } },
      (res) => (res.resume(), resolve(res.statusCode))
    );
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(status, 403);
  assert.equal((await call('GET', '/api/setup', { base: t.base })).json.setupAllowed, true, 'normal local setup still offered');
  assert.equal((await call('POST', '/api/setup', { base: t.base, body: { username: 'amina', password: 'blue tiger lamp river' } })).status, 200);
});

test('B: only the owner can change admins; nobody else can take over the owner account', async () => {
  const t = await startServer();
  const B = { base: t.base };
  const owner = sid(await call('POST', '/api/setup', { ...B, body: OWNER }));
  assert.equal((await call('GET', '/api/me', { ...B, cookie: owner })).json.user.is_owner, 1, 'setup account is the owner');
  const add = (cookie, username, role) => call('POST', '/api/users', { ...B, cookie, body: { username, password: 'blue tiger lamp river', role } });
  assert.equal((await add(owner, 'manager', 'admin')).status, 200, 'owner can add admins');
  assert.equal((await add(owner, 'manager2', 'admin')).status, 200);
  const manager = sid(await call('POST', '/api/login', { ...B, body: { username: 'manager', password: 'blue tiger lamp river' } }));
  assert.equal((await add(manager, 'till', 'staff')).status, 200, 'admins still add cashiers');
  assert.equal((await add(manager, 'sneaky', 'admin')).status, 403, 'only the owner adds admins');
  const users = (await call('GET', '/api/users', { ...B, cookie: owner })).json;
  const id = (n) => users.find((u) => u.username === n).id;
  // Owner switches on two-step login, then the audit's takeover is attempted.
  const setup = (await call('POST', '/api/2fa/setup', { ...B, cookie: owner, body: { password: OWNER.password } })).json;
  await call('POST', '/api/2fa/enable', { ...B, cookie: owner, body: { code: totp.hotp(totp.base32Decode(setup.secret.replace(/ /g, '')), totp.stepAt()) } });
  assert.equal((await call('POST', `/api/users/${id('owner')}/reset-2fa`, { ...B, cookie: manager })).status, 403);
  assert.equal((await call('PUT', `/api/users/${id('owner')}`, { ...B, cookie: manager, body: { password: 'taken over by manager' } })).status, 403);
  assert.equal((await call('PUT', `/api/users/${id('owner')}`, { ...B, cookie: manager, body: { role: 'staff' } })).status, 403);
  assert.equal((await call('PUT', `/api/users/${id('owner')}`, { ...B, cookie: manager, body: { active: false } })).status, 403);
  assert.equal((await call('POST', '/api/login', { ...B, body: { username: 'owner', password: 'taken over by manager' } })).status, 401, 'owner password unchanged');
  // Other admins are protected the same way; cashiers are still managed by any admin.
  assert.equal((await call('PUT', `/api/users/${id('manager2')}`, { ...B, cookie: manager, body: { password: 'changed by manager' } })).status, 403);
  assert.equal((await call('PUT', `/api/users/${id('till')}`, { ...B, cookie: manager, body: { role: 'admin' } })).status, 403, 'no promoting to admin');
  assert.equal((await call('PUT', `/api/users/${id('till')}`, { ...B, cookie: manager, body: { password: 'green apple door seven', role: 'staff' } })).status, 200);
  // The owner keeps full control.
  assert.equal((await call('PUT', `/api/users/${id('manager2')}`, { ...B, cookie: owner, body: { role: 'staff' } })).status, 200);
  assert.equal((await call('PUT', `/api/users/${id('manager')}`, { ...B, cookie: owner, body: { password: 'owner reset this one' } })).status, 200);
  assert.equal((await call('GET', '/api/me', { ...B, cookie: manager })).status, 401, 'manager signed out by the reset');
});

test('C: an admin cannot change their own password through user management (needs the current one)', async () => {
  const me = (await call('GET', '/api/users', { cookie: admin })).json.find((u) => u.username === OWNER.username);
  const r = await call('PUT', `/api/users/${me.id}`, { cookie: admin, body: { password: 'changed without current one' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Change your password/);
});

test('L8: the Excel reader handles real Excel files and hostile sheet ids safely', () => {
  const saved = readXlsx(fs.readFileSync(path.join(ROOT, 'test/fixtures/saved-by-excel.xlsx')));
  assert.deepEqual(saved[1], ['Pasta 500g', '6001111000011', 'Food', 0.8, 1.5, 30]);
  const shared = readXlsx(fs.readFileSync(path.join(ROOT, 'test/fixtures/shared-strings-rid3.xlsx')));
  assert.equal(shared[2][0], 'Cooking Oil & Ghee 1L');

  const evilId = '(a+)+$' + 'a'.repeat(40) + '!';
  const file = writeZip(
    [
      ['xl/workbook.xml', `<workbook><sheets><sheet name="S" sheetId="1" r:id="${evilId}"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="rId9" Target="worksheets/other.xml"/><Relationship Id="${evilId}" Target="worksheets/sheet1.xml"/></Relationships>`],
      ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row></sheetData></worksheet>'],
    ].map(([name, data]) => ({ name, data: Buffer.from(data) }))
  );
  const t = performance.now();
  assert.deepEqual(readXlsx(file), [['Name']]);
  assert.ok(performance.now() - t < 200, 'parsed quickly');
});

test('L1: failed logins take about as long for unknown usernames as for real ones', async () => {
  const t = await startServer();
  const owner = sid(await call('POST', '/api/setup', { base: t.base, body: OWNER }));
  for (let i = 0; i < 6; i++) await call('POST', '/api/users', { base: t.base, cookie: owner, body: { username: 'user' + i, password: 'blue tiger lamp ' + i } });
  const time = async (username) => (await call('POST', '/api/login', { base: t.base, body: { username, password: 'wrong guess' } })).ms;
  const real = [];
  const fake = [];
  for (let i = 0; i < 6; i++) {
    real.push(await time('user' + i));
    fake.push(await time('nobody' + i));
  }
  const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  assert.ok(median(fake) > median(real) * 0.5, `unknown ${median(fake).toFixed(1)} ms vs real ${median(real).toFixed(1)} ms`);
});

// ---------- H1: login throttling (own server, so lock-outs don't affect other tests) ----------

test('H1: password hashing does not block other requests', async () => {
  const t = await startServer();
  const owner = sid(await call('POST', '/api/setup', { base: t.base, body: OWNER }));
  const slow = Array.from({ length: 4 }, () => call('POST', '/api/login', { base: t.base, body: { username: 'owner', password: 'wrong' } }));
  const me = await call('GET', '/api/me', { base: t.base, cookie: owner });
  await Promise.all(slow);
  assert.equal(me.status, 200);
  assert.ok(me.ms < 50, `till stays responsive during logins (${Math.round(me.ms)} ms)`);
  assert.equal((await call('POST', '/api/login', { base: t.base, body: OWNER })).status, 200, 'below the limit, the right password works');
});

test('H1: 5 wrong passwords lock the account (Retry-After); other accounts on the device still work', async () => {
  const t = await startServer();
  const owner = sid(await call('POST', '/api/setup', { base: t.base, body: OWNER }));
  await call('POST', '/api/users', { base: t.base, cookie: owner, body: { ...STAFF, role: 'staff' } });
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/login', { base: t.base, body: { username: 'cashier', password: 'nope' + i } })).status, 401);
  const locked = await call('POST', '/api/login', { base: t.base, body: { username: 'cashier', password: 'nope' } });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) >= 30);
  assert.equal((await call('POST', '/api/login', { base: t.base, body: STAFF })).status, 429, 'even the right password waits during the lock');
  assert.equal((await call('POST', '/api/login', { base: t.base, body: OWNER })).status, 200, 'the owner can still sign in on the shared till');
});

test('H1: 20 failures from one device lock that device for every account', async () => {
  const t = await startServer();
  await call('POST', '/api/setup', { base: t.base, body: OWNER });
  for (let i = 0; i < 20; i++) await call('POST', '/api/login', { base: t.base, body: { username: 'guess' + i, password: 'x' } });
  assert.equal((await call('POST', '/api/login', { base: t.base, body: OWNER })).status, 429);
});

// ---------- Two-step login ----------

test('2FA: one-time codes match the RFC 6238 / RFC 4226 test values', () => {
  const key = Buffer.from('12345678901234567890');
  for (const [sec, code] of [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(totp.hotp(key, Math.floor(sec / 30), 8), code);
  }
  assert.deepEqual([0, 1, 2, 3].map((c) => totp.hotp(key, c)), ['755224', '287082', '359152', '969429']);
  assert.equal(totp.base32Encode(key), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});

test('2FA: QR codes decode back to the exact setup link (independent decoder, all sizes and masks)', () => {
  const { rsDivisor, rsRemainder } = qr._internal;
  assert.deepEqual(rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], rsDivisor(10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  const masks = new Set();
  const samples = [];
  for (let n = 1; n <= 134; n++) samples.push('m'.repeat(n));
  for (let i = 0; i < 150; i++) samples.push(totp.otpauthUri(totp.newSecret(), 'user' + i, 'Shop name ' + i));
  samples.push(totp.otpauthUri(totp.newSecret(), 'a-very-long-username-here', 'A Very Long Shop Name That Goes On And On'));
  for (const text of samples) {
    const sym = qr.encode(text);
    assert.equal(decodeQr(sym.modules).text, text);
    masks.add(sym.mask);
  }
  assert.equal(masks.size, 8, 'all 8 mask patterns exercised');
});

test('2FA: setup, sign-in with app code, no code re-use, recovery codes, switch off', async () => {
  const t = await startServer();
  const B = { base: t.base };
  const owner = sid(await call('POST', '/api/setup', { ...B, body: OWNER }));
  const other = sid(await call('POST', '/api/login', { ...B, body: OWNER }));
  assert.equal((await call('GET', '/api/me', { ...B, cookie: other })).status, 200, 'second session works before');
  assert.equal((await call('POST', '/api/2fa/setup', { ...B, cookie: owner, body: { password: 'wrong' } })).status, 400, 'password required');
  const setup = (await call('POST', '/api/2fa/setup', { ...B, cookie: owner, body: { password: OWNER.password } })).json;
  assert.match(setup.qr_svg, /^<svg[^>]*>.*<path d="M/);
  assert.equal(decodeQr(qr.encode(setup.uri).modules).text, setup.uri);
  assert.match(setup.uri, /^otpauth:\/\/totp\/[^?]+\?secret=[A-Z2-7]{32}/);
  const key = totp.base32Decode(setup.secret.replace(/ /g, ''));
  const s0 = totp.stepAt();
  assert.equal((await call('POST', '/api/2fa/enable', { ...B, cookie: owner, body: { code: '000000' === totp.hotp(key, s0) ? '111111' : '000000' } })).status, 400);
  const en = await call('POST', '/api/2fa/enable', { ...B, cookie: owner, body: { code: totp.hotp(key, s0) } });
  assert.equal(en.status, 200);
  assert.equal(en.json.recovery_codes.length, 8);
  assert.equal((await call('GET', '/api/me', { ...B, cookie: owner })).status, 200, 'current session kept');
  assert.equal((await call('GET', '/api/me', { ...B, cookie: other })).status, 401, 'other sessions signed out when switched on');

  // Password alone no longer signs in.
  const step1 = await call('POST', '/api/login', { ...B, body: OWNER });
  assert.equal(step1.status, 200);
  assert.equal(step1.json.two_step, true);
  assert.equal(step1.headers.get('set-cookie'), null, 'no session before the code');
  assert.equal((await call('POST', '/api/login/verify', { ...B, body: { ticket: step1.json.ticket, code: totp.hotp(key, s0) } })).status, 401, 'code already used to switch on');
  const ok = await call('POST', '/api/login/verify', { ...B, body: { ticket: step1.json.ticket, code: totp.hotp(key, s0 + 1) } });
  assert.equal(ok.status, 200);
  assert.ok(sid(ok));
  assert.equal((await call('POST', '/api/login/verify', { ...B, body: { ticket: step1.json.ticket, code: totp.hotp(key, s0 + 1) } })).status, 401, 'ticket single-use');

  // Recovery code: works once.
  const rc = en.json.recovery_codes[0];
  const t2 = (await call('POST', '/api/login', { ...B, body: OWNER })).json.ticket;
  const viaRc = await call('POST', '/api/login/verify', { ...B, body: { ticket: t2, code: rc.toUpperCase() } });
  assert.equal(viaRc.status, 200);
  assert.equal(viaRc.json.recovery_codes_left, 7);
  const t3 = (await call('POST', '/api/login', { ...B, body: OWNER })).json.ticket;
  assert.equal((await call('POST', '/api/login/verify', { ...B, body: { ticket: t3, code: rc } })).status, 401, 'recovery code used up');
  assert.equal((await call('GET', '/api/2fa', { ...B, cookie: owner })).json.recovery_codes_left, 7);

  // New recovery codes replace the old ones.
  const fresh = (await call('POST', '/api/2fa/recovery-codes', { ...B, cookie: owner, body: { password: OWNER.password } })).json.recovery_codes;
  const t4 = (await call('POST', '/api/login', { ...B, body: OWNER })).json.ticket;
  assert.equal((await call('POST', '/api/login/verify', { ...B, body: { ticket: t4, code: en.json.recovery_codes[1] } })).status, 401, 'old codes stop working');

  // Switch off needs password and a code.
  assert.equal((await call('POST', '/api/2fa/disable', { ...B, cookie: owner, body: { password: OWNER.password, code: '123456' } })).status, 400);
  assert.equal((await call('POST', '/api/2fa/disable', { ...B, cookie: owner, body: { password: OWNER.password, code: fresh[0] } })).status, 200);
  const plain = await call('POST', '/api/login', { ...B, body: OWNER });
  assert.ok(sid(plain) && !plain.json.two_step, 'password alone works again');

  const log = (await call('GET', '/api/audit?from=2000-01-01', { ...B, cookie: owner })).json.map((r) => r.action);
  for (const a of ['2fa.enabled', 'login.2fa_failed', '2fa.recovery_codes_replaced', '2fa.disabled']) assert.ok(log.includes(a), a);
  assert.ok((await call('GET', '/api/audit?from=2000-01-01', { ...B, cookie: owner })).json.some((r) => r.action === 'login.success' && /recovery/.test(r.details)));
});

test('2FA: wrong codes are limited per sign-in attempt; admin and shop-PC resets work; staff cannot reset', async () => {
  const t = await startServer();
  const B = { base: t.base };
  const owner = sid(await call('POST', '/api/setup', { ...B, body: OWNER }));
  const enable = async (username, password) => {
    const c = sid(await call('POST', '/api/login', { ...B, body: { username, password } }));
    const setup = (await call('POST', '/api/2fa/setup', { ...B, cookie: c, body: { password } })).json;
    await call('POST', '/api/2fa/enable', { ...B, cookie: c, body: { code: totp.hotp(totp.base32Decode(setup.secret.replace(/ /g, '')), totp.stepAt()) } });
    return c;
  };
  for (const u of ['anna', 'brian', 'chris']) await call('POST', '/api/users', { ...B, cookie: owner, body: { username: u, password: 'blue tiger lamp river' } });
  const brian = await enable('brian', 'blue tiger lamp river');
  await enable('anna', 'blue tiger lamp river');
  await enable('chris', 'blue tiger lamp river');

  // 5 wrong codes end the sign-in attempt.
  const tk = (await call('POST', '/api/login', { ...B, body: { username: 'anna', password: 'blue tiger lamp river' } })).json.ticket;
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/api/login/verify', { ...B, body: { ticket: tk, code: '000000' } })).status, 401);
  const fifth = await call('POST', '/api/login/verify', { ...B, body: { ticket: tk, code: '000000' } });
  assert.match(fifth.json.error, /sign in again/i);
  assert.equal((await call('POST', '/api/login/verify', { ...B, body: { ticket: tk, code: '000000' } })).status, 401);
  const locked = await call('POST', '/api/login', { ...B, body: { username: 'anna', password: 'blue tiger lamp river' } });
  assert.equal(locked.status, 429, 'and the account is throttled like wrong passwords');

  // Staff cannot reset; admin can (and the user is signed out).
  const users = (await call('GET', '/api/users', { ...B, cookie: owner })).json;
  const id = (n) => users.find((u) => u.username === n).id;
  assert.equal(users.find((u) => u.username === 'brian').two_step, 1);
  assert.equal((await call('POST', `/api/users/${id('chris')}/reset-2fa`, { ...B, cookie: brian })).status, 403);
  assert.equal((await call('POST', `/api/users/${id('brian')}/reset-2fa`, { ...B, cookie: owner })).status, 200);
  assert.equal((await call('GET', '/api/me', { ...B, cookie: brian })).status, 401);
  const b2 = await call('POST', '/api/login', { ...B, body: { username: 'brian', password: 'blue tiger lamp river' } });
  assert.ok(sid(b2) && !b2.json.two_step);

  // Last-resort reset on the shop computer.
  const out = spawnSync(process.execPath, ['scripts/reset-2fa.js', 'chris'], { cwd: ROOT, env: { ...process.env, DATA_DIR: t.dataDir } });
  assert.equal(out.status, 0, out.stderr?.toString());
  const c2 = await call('POST', '/api/login', { ...B, body: { username: 'chris', password: 'blue tiger lamp river' } });
  assert.ok(sid(c2) && !c2.json.two_step);
  const log = (await call('GET', '/api/audit?from=2000-01-01', { ...B, cookie: owner })).json.map((r) => r.action);
  assert.ok(log.includes('2fa.reset_by_admin') && log.includes('2fa.reset_on_computer'));
});

// ---------- H2: HTTPS ----------

test('H2: with a certificate the portal serves HTTPS, Secure cookies and HSTS', async (t) => {
  const openssl = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'].find(
    (bin) => spawnSync(bin, ['version']).status === 0
  );
  if (!openssl) return t.skip('openssl not available to create a test certificate');
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-cert-'));
  const key = path.join(certDir, 'key.pem');
  const cert = path.join(certDir, 'cert.pem');
  const gen = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost']);
  assert.equal(gen.status, 0, gen.stderr?.toString());
  const tls = await startServer({ env: { TLS_CERT: cert, TLS_KEY: key } });
  const res = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ username: 'o', password: 'Owner#Pass2026' });
    const req = https.request(
      { host: '127.0.0.1', port: tls.port, path: '/api/setup', method: 'POST', rejectUnauthorized: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Requested-With': 'shop-portal' } },
      (r) => {
        r.resume();
        r.on('end', () => resolve(r));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie'][0], /; Secure/);
  assert.match(res.headers['strict-transport-security'], /max-age=/);
  fs.rmSync(certDir, { recursive: true, force: true });
});
