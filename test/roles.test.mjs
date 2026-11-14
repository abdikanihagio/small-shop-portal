// Roles & permissions tests. Each run uses its own portal on a random port with a temporary database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let S;
let child;
let dataDir;

const call = async (method, p, { cookie, body } = {}) => {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-Requested-With'] = 'shop-portal';
  const r = await fetch(S + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text };
};
const sid = (r) => (r.headers?.get?.('set-cookie') || '').match(/sid=[0-9a-f]+/)?.[0];
const login = async (username, password) => {
  const r = await fetch(S + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'shop-portal' },
    body: JSON.stringify({ username, password }),
  });
  return sid(r);
};

let owner, cashier, supply, accountant, roles;
const PW = { owner: 'Copper#Lantern2026', cashier: 'Staff#Pass2026', supply: 'Crate#Forklift2026', acct: 'Ledger#Balance2026' };

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-roles-'));
  const port = 40000 + Math.floor(Math.random() * 20000);
  child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', (d) => d.toString().includes('running at') && (clearTimeout(t), resolve()));
    child.on('exit', (code) => reject(new Error('server exited ' + code)));
  });
  S = `http://127.0.0.1:${port}`;
  await call('POST', '/api/setup', { body: { username: 'owner', password: PW.owner, shop_name: 'Test' } });
  owner = await login('owner', PW.owner);
  roles = (await call('GET', '/api/roles', { cookie: owner })).json;
  const id = (n) => roles.roles.find((r) => r.name === n).id;
  await call('POST', '/api/users', { cookie: owner, body: { username: 'cashier', password: PW.cashier, role: 'staff' } });
  await call('POST', '/api/users', { cookie: owner, body: { username: 'stores', password: PW.supply, role: 'staff', role_id: id('Supply chain') } });
  cashier = await login('cashier', PW.cashier);
  supply = await login('stores', PW.supply);
  await call('POST', '/api/products', { cookie: owner, body: { sku: 'A1', name: 'Rice 1kg', cost: 4, price: 6, stock: 10 } });
  await call('POST', '/api/suppliers', { cookie: owner, body: { name: 'Wholesaler' } });
});

after(() => {
  child?.kill();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

test('built-in roles: Cashier (built-in) and Supply chain exist; new staff default to Cashier', async () => {
  const names = roles.roles.map((r) => r.name);
  assert.deepEqual(names.slice(0, 2).sort(), ['Cashier', 'Supply chain']);
  assert.ok(roles.permissions.some((p) => p.key === 'accounting'));
  const users = (await call('GET', '/api/users', { cookie: owner })).json;
  assert.equal(users.find((u) => u.username === 'cashier').role_name, 'Cashier');
  assert.equal(users.find((u) => u.username === 'stores').role_name, 'Supply chain');
  const me = (await call('GET', '/api/me', { cookie: supply })).json.user;
  assert.equal(me.role_name, 'Supply chain');
  assert.ok(me.permissions.includes('inventory.manage'));
});

test('Supply chain can receive stock, adjust counts, edit products and manage suppliers', async () => {
  const r = await call('POST', '/api/inventory/restock', { cookie: supply, body: { supplier_id: 1, payment_method: 'credit', items: [{ product_id: 1, qty: 5, unit_cost: 4 }] } });
  assert.equal(r.status, 200, r.text);
  assert.equal((await call('POST', '/api/inventory/adjust', { cookie: supply, body: { product_id: 1, new_count: 14, note: 'recount' } })).status, 200);
  assert.equal((await call('PUT', '/api/products/1', { cookie: supply, body: { sku: 'A1', name: 'Rice 1kg bag', cost: 4, price: 6.5 } })).status, 200);
  assert.equal((await call('GET', '/api/suppliers/1/statement', { cookie: supply })).status, 200);
  assert.ok((await call('GET', '/api/products', { cookie: supply })).json[0].cost_cents != null, 'sees costs');
});

test('Supply chain cannot sell, see accounting, customers, activity, settings or users', async () => {
  const no = [
    ['POST', '/api/sales', { items: [{ product_id: 1, qty: 1 }] }],
    ['GET', '/api/sales'],
    ['GET', '/api/reports/pl'],
    ['GET', '/api/expenses'],
    ['GET', '/api/export/sales.csv'],
    ['GET', '/api/customers'],
    ['GET', '/api/audit'],
    ['PUT', '/api/settings', { shop_name: 'X' }],
    ['GET', '/api/users'],
    ['GET', '/api/roles'],
    ['POST', '/api/roles', { name: 'Boss', permissions: ['accounting'] }],
  ];
  for (const [m, p, body] of no) assert.equal((await call(m, p, { cookie: supply, body })).status, 403, `${m} ${p}`);
  const dash = (await call('GET', '/api/dashboard', { cookie: supply })).json;
  assert.equal(dash.month, undefined, 'no month profit on dashboard');
});

test('Cashier keeps the old staff rights: sells, cannot receive stock or see costs', async () => {
  assert.equal((await call('POST', '/api/sales', { cookie: cashier, body: { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' } })).status, 200);
  assert.equal((await call('POST', '/api/inventory/restock', { cookie: cashier, body: { items: [{ product_id: 1, qty: 1, unit_cost: 4 }] } })).status, 403);
  assert.equal((await call('GET', '/api/products', { cookie: cashier })).json[0].cost_cents, undefined);
  assert.equal((await call('GET', '/api/reports/pl', { cookie: cashier })).status, 403);
});

test('a new "Accountant" role gets accounting only; changes apply at once and are logged', async () => {
  const created = await call('POST', '/api/roles', { cookie: owner, body: { name: 'Accountant', permissions: ['accounting', 'sales.view'] } });
  assert.equal(created.status, 200, created.text);
  const rid = created.json.id;
  await call('POST', '/api/users', { cookie: owner, body: { username: 'books', password: PW.acct, role: 'staff', role_id: rid } });
  accountant = await login('books', PW.acct);
  assert.equal((await call('GET', '/api/reports/pl', { cookie: accountant })).status, 200);
  assert.equal((await call('GET', '/api/export/sales.csv', { cookie: accountant })).status, 200);
  assert.equal((await call('POST', '/api/inventory/restock', { cookie: accountant, body: {} })).status, 403);
  assert.equal((await call('GET', '/api/audit', { cookie: accountant })).status, 403);

  // Take accounting away: the signed-in user loses it immediately.
  assert.equal((await call('PUT', `/api/roles/${rid}`, { cookie: owner, body: { permissions: ['sales.view'] } })).status, 200);
  assert.equal((await call('GET', '/api/reports/pl', { cookie: accountant })).status, 403);

  const log = (await call('GET', '/api/audit', { cookie: owner })).json;
  const entries = log;
  const actions = JSON.stringify(entries);
  assert.ok(actions.includes('role.created') && actions.includes('role.updated'));
});

test('a role that cannot see costs cannot change them by editing a product', async () => {
  const r = await call('POST', '/api/roles', { cookie: owner, body: { name: 'Shelf staff', permissions: ['products.view', 'products.manage'] } });
  await call('POST', '/api/users', { cookie: owner, body: { username: 'shelf', password: 'Basket#Aisle2026', role: 'staff', role_id: r.json.id } });
  const shelf = await login('shelf', 'Basket#Aisle2026');
  const before = (await call('GET', '/api/products', { cookie: owner })).json[0].cost_cents;
  const put = await call('PUT', '/api/products/1', { cookie: shelf, body: { sku: 'A1', name: 'Rice 1kg bag', cost: 0, price: 6.5 } });
  assert.equal(put.status, 200);
  assert.equal(put.json.cost_cents, undefined);
  assert.equal((await call('GET', '/api/products', { cookie: owner })).json[0].cost_cents, before);
});

test('role rules: bad input refused, Cashier cannot be renamed or deleted, roles in use cannot be deleted', async () => {
  const cashierRole = roles.roles.find((r) => r.builtin);
  const supplyRole = roles.roles.find((r) => r.name === 'Supply chain');
  assert.equal((await call('POST', '/api/roles', { cookie: owner, body: { name: 'Admin', permissions: [] } })).status, 400);
  assert.equal((await call('POST', '/api/roles', { cookie: owner, body: { name: 'supply CHAIN', permissions: [] } })).status, 400);
  assert.equal((await call('POST', '/api/roles', { cookie: owner, body: { name: 'X', permissions: ['users.manage'] } })).status, 400);
  assert.equal((await call('DELETE', `/api/roles/${cashierRole.id}`, { cookie: owner })).status, 400);
  await call('PUT', `/api/roles/${cashierRole.id}`, { cookie: owner, body: { name: 'Renamed', permissions: cashierRole.permissions } });
  assert.equal((await call('GET', '/api/roles', { cookie: owner })).json.roles.find((r) => r.id === cashierRole.id).name, 'Cashier');
  assert.equal((await call('DELETE', `/api/roles/${supplyRole.id}`, { cookie: owner })).status, 400, 'in use');
  assert.equal((await call('POST', '/api/users', { cookie: owner, body: { username: 'ghost', password: 'Phantom#Mist2026', role: 'staff', role_id: 999 } })).status, 400);
  const temp = await call('POST', '/api/roles', { cookie: owner, body: { name: 'Temporary', permissions: [] } });
  assert.equal((await call('DELETE', `/api/roles/${temp.json.id}`, { cookie: owner })).status, 200);
});

test('moving a user to another role changes what they can do', async () => {
  const users = (await call('GET', '/api/users', { cookie: owner })).json;
  const c = users.find((u) => u.username === 'cashier');
  const supplyRole = roles.roles.find((r) => r.name === 'Supply chain');
  assert.equal((await call('PUT', `/api/users/${c.id}`, { cookie: owner, body: { role: 'staff', role_id: supplyRole.id, active: true } })).status, 200);
  assert.equal((await call('POST', '/api/inventory/adjust', { cookie: cashier, body: { product_id: 1, new_count: 12, note: 'recount' } })).status, 200);
  assert.equal((await call('POST', '/api/sales', { cookie: cashier, body: { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' } })).status, 403);
});
