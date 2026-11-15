// Roles & permissions tests. Each run uses its own portal on a random port with a temporary database.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, request, sid } from './helpers.mjs';

let S;
const call = (method, p, opts) => request(S, method, p, opts);
const login = async (username, password) => sid(await call('POST', '/api/login', { body: { username, password } }));

let owner, cashier, supply, accountant, roles;
const PW = { owner: 'Copper#Lantern2026', cashier: 'Staff#Pass2026', supply: 'Crate#Forklift2026', acct: 'Ledger#Balance2026' };

before(async () => {
  S = (await startServer()).base;
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

test('logo & icon: only "settings.manage" may change them, anyone may view them, only real pictures accepted', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const put = (kind, body, cookie, type = 'application/octet-stream') => call('PUT', `/api/branding/${kind}`, { cookie, body, type });

  assert.deepEqual((await call('GET', '/api/branding')).json, { logo: null, icon: null, colors: { primary: '', sidebar: '' } });
  assert.equal((await call('GET', '/api/branding/logo')).status, 404);
  assert.equal((await put('logo', png, cashier)).status, 403);
  assert.equal((await put('logo', png, '')).status, 401);
  assert.equal((await put('logo', Buffer.from('<svg onload="alert(1)"></svg>'), owner)).status, 400, 'SVG/HTML refused');
  assert.equal((await put('banner', png, owner)).status, 400, 'unknown kind');
  assert.equal((await put('logo', Buffer.concat([png, Buffer.alloc(1024 * 1024)]), owner)).status, 400, 'over 1 MB');
  assert.equal((await put('logo', png, owner, 'application/json')).status, 415);

  const ok = await put('logo', png, owner);
  assert.equal(ok.status, 200);
  const status = ok.json;
  assert.ok(status.logo && status.icon === null);

  const img = await fetch(S + '/api/branding/logo'); // no sign-in needed (sign-in page)
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
  assert.equal((await fetch(S + '/api/branding/logo', { headers: { 'If-None-Match': img.headers.get('etag') } })).status, 304);

  assert.equal((await call('DELETE', '/api/branding/logo', { cookie: cashier })).status, 403);
  assert.equal((await call('DELETE', '/api/branding/logo', { cookie: owner })).json.logo, null);
  assert.equal((await call('GET', '/api/branding/logo')).status, 404);
  const log = (await call('GET', '/api/audit', { cookie: owner })).json;
  const actions = (log.rows || log).map((r) => r.action);
  assert.ok(actions.includes('branding.updated') && actions.includes('branding.removed'));
});

test('appearance colours: only "settings.manage" may change them, only real colours accepted, and everyone (even signed out) gets them', async () => {
  const set = (body, cookie = owner) => call('PUT', '/api/settings', { cookie, body });
  assert.equal((await set({ primary_color: '#2563eb' }, cashier)).status, 403);
  assert.equal((await set({ primary_color: '#2563eb' }, '')).status, 401);
  for (const bad of ['blue', '#12345', '#1234567', '#gggggg', 'red;}body{display:none', 'url(x)']) {
    assert.equal((await set({ primary_color: bad })).status, 400, bad);
    assert.equal((await set({ sidebar_color: bad })).status, 400, bad);
  }
  assert.equal((await set({ primary_color: '#2563EB', sidebar_color: ' #F8FAFC ' })).status, 200);
  assert.deepEqual((await call('GET', '/api/branding')).json.colors, { primary: '#2563eb', sidebar: '#f8fafc' }, 'stored lower-case, public');
  assert.equal((await call('GET', '/api/me', { cookie: cashier })).json.settings.primary_color, '#2563eb');
  const log = (await call('GET', '/api/audit', { cookie: owner })).json;
  const change = log.find((r) => r.action === 'settings.updated' && r.details.includes('primary_color'));
  assert.deepEqual(JSON.parse(change.details).primary_color, { from: '', to: '#2563eb' });
  assert.equal((await set({ primary_color: '', sidebar_color: '' })).status, 200, 'back to the built-in colours');
  assert.deepEqual((await call('GET', '/api/branding')).json.colors, { primary: '', sidebar: '' });
});
