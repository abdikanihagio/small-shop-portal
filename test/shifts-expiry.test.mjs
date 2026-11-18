// Cash closing (shifts / Z-report) and expiry dates (batches). Every expected figure is in cents.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { startServer, request, sid, sql } from './helpers.mjs';

let S, owner, cashier, stores;
const call = (method, p, opts = {}) => request(S.base, method, p, opts);
const as = (cookie) => ({
  get: (p) => call('GET', p, { cookie }),
  post: (p, body = {}) => call('POST', p, { cookie, body }),
  put: (p, body = {}) => call('PUT', p, { cookie, body }),
});
const login = async (username, password) => sid(await call('POST', '/api/login', { body: { username, password } }));
const ok = async (p) => {
  const r = await p;
  assert.ok(r.status === 200, `${r.status} ${r.text}`);
  return r.json;
};
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const batchesOf = async (productId) =>
  (await sql(S.database, 'SELECT expiry_date, qty_left FROM stock_batches WHERE product_id = $1 ORDER BY expiry_date', [productId])).map((b) => `${b.expiry_date}:${b.qty_left}`);

before(async () => {
  S = await startServer();
  owner = sid(await call('POST', '/api/setup', { body: { username: 'owner', password: 'Copper#Lantern2026', shop_name: 'Till Shop' } }));
  const roles = (await as(owner).get('/api/roles')).json.roles;
  await as(owner).post('/api/users', { username: 'cashier', password: 'Staff#Pass2026', role: 'staff' });
  await as(owner).post('/api/users', { username: 'stores', password: 'Crate#Forklift2026', role: 'staff', role_id: roles.find((r) => r.name === 'Supply chain').id });
  cashier = await login('cashier', 'Staff#Pass2026');
  stores = await login('stores', 'Crate#Forklift2026');
  await as(owner).post('/api/products', { sku: 'RICE', name: 'Rice', cost: 4, price: 6, stock: 100 });
  await as(owner).post('/api/customers', { name: 'Cara', phone: '0700000001' });
  await as(owner).post('/api/suppliers', { name: 'Wholesaler' });
});

// ---------- cash closing ----------

test('a cashier opens one shift, counts blind, and the Z-report shows expected, counted and the difference', async () => {
  const c = as(cashier);
  assert.equal((await c.get('/api/shifts/current')).json.shift, null);
  const refused = await c.post('/api/sales', { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' });
  assert.equal(refused.status, 400, 'no sale without an open shift');
  assert.match(refused.json.error, /Open your shift/);
  await ok(as(owner).post('/api/shifts/open', { float: 0 })); // the owner sells too, in their own shift
  const opened = await ok(c.post('/api/shifts/open', { float: 50 }));
  assert.equal(opened.opening_float_cents, 5000);
  assert.equal((await c.post('/api/shifts/open', { float: 10 })).status, 400, 'only one open shift');

  await ok(c.post('/api/sales', { items: [{ product_id: 1, qty: 2 }], payment_method: 'cash' })); // 1200 cash
  await ok(c.post('/api/sales', { items: [{ product_id: 1, qty: 1 }], payment_method: 'card' })); // 600 card
  await ok(as(owner).post('/api/sales', { items: [{ product_id: 1, qty: 5 }], payment_method: 'cash' })); // the owner's, not in this shift

  const live = (await c.get('/api/shifts/current')).json.shift;
  assert.equal(live.summary.sales_count, 2);
  assert.equal(live.summary.sales_total, 1800);
  assert.equal(live.summary.expected_cash, undefined, 'the cashier counts blind');
  const seenByOwner = await ok(as(owner).get(`/api/shifts/${live.id}`));
  assert.equal(seenByOwner.summary.expected_cash, 6200, 'Accounting sees it: 5000 float + 1200 cash sales');

  const z = await ok(c.post('/api/shifts/close', { counted: 60, note: 'short' }));
  assert.equal(z.status, 'closed');
  assert.deepEqual([z.expected_cents, z.counted_cents, z.difference_cents], [6200, 6000, -200]);
  assert.equal(z.summary.cash_sales, 1200);
  assert.deepEqual(z.summary.sales_by_method.map((m) => [m.method, m.count, m.amount]), [['cash', 1, 1200], ['card', 1, 600]]);
  assert.equal((await c.post('/api/shifts/close', { counted: 1 })).status, 400, 'nothing left to close');

  // The Z-report is frozen: voiding a sale afterwards doesn't change it.
  await ok(as(owner).post('/api/sales/1/void', { reason: 'test' }));
  assert.equal((await ok(c.get(`/api/shifts/${z.id}`))).summary.cash_sales, 1200);
});

test('expected cash counts every cash movement of that person during the shift', async () => {
  const o = as(owner);
  await ok(o.post('/api/shifts/close', { counted: 30 })); // the owner's first shift
  const shift = await ok(o.post('/api/shifts/open', { float: 100 })); // 10000
  await ok(o.post('/api/sales', { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' })); // +600
  const saleId = (await o.get('/api/sales')).json[0].id;
  const item = (await o.get(`/api/sales/${saleId}`)).json.items[0];
  await ok(o.post(`/api/sales/${saleId}/returns`, { items: [{ sale_item_id: item.id, qty: 1 }], refund_method: 'cash', reason: 'test' })); // −600
  await ok(o.post('/api/sales', { items: [{ product_id: 1, qty: 3 }], payment_method: 'credit', customer_id: 1 }));
  await ok(o.post('/api/customers/1/payments', { amount: 10, method: 'cash' })); // +1000
  await ok(o.post('/api/suppliers/1/payments', { amount: 7, method: 'cash' })); // −700
  await ok(o.post('/api/inventory/restock', { supplier_id: 1, payment_method: 'cash', items: [{ product_id: 1, qty: 2, unit_cost: 3 }] })); // −600
  await ok(o.post('/api/expenses', { category: 'Supplies', amount: 5, payment_method: 'cash' })); // −500
  await ok(o.post('/api/expenses', { category: 'Supplies', amount: 2, payment_method: 'bank' })); // not cash
  const z = await ok(o.post('/api/shifts/close', { counted: 92 }));
  assert.equal(z.id, shift.id);
  assert.deepEqual(
    [z.summary.cash_sales, z.summary.cash_refunds, z.summary.customer_payments_cash, z.summary.supplier_payments_cash, z.summary.deliveries_paid_cash, z.summary.expenses_cash],
    [600, 600, 1000, 700, 600, 500]
  );
  assert.deepEqual([z.expected_cents, z.difference_cents], [9200, 0]);
});

test('who sees which shifts: cashiers their own, Accounting all; roles that cannot sell have no shifts', async () => {
  const mine = await ok(as(cashier).get('/api/shifts'));
  assert.ok(mine.length >= 1 && mine.every((s) => s.username === 'cashier'));
  assert.equal((await ok(as(owner).get('/api/shifts'))).length, 3);
  const ownerShift = (await ok(as(owner).get('/api/shifts'))).find((s) => s.username === 'owner');
  // Open shifts show their sales so far; only Accounting sees the expected cash.
  await ok(as(cashier).post('/api/shifts/open', { float: 20 }));
  await ok(as(cashier).post('/api/sales', { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' }));
  const liveForOwner = (await ok(as(owner).get('/api/shifts'))).find((s) => s.username === 'cashier' && s.status === 'open');
  assert.deepEqual([liveForOwner.sales_count, liveForOwner.sales_total, liveForOwner.expected_so_far], [1, 600, 2600]);
  const liveForCashier = (await ok(as(cashier).get('/api/shifts'))).find((s) => s.status === 'open');
  assert.equal(liveForCashier.sales_total, 600);
  assert.equal(liveForCashier.expected_so_far, undefined, 'still blind for the cashier');
  await ok(as(cashier).post('/api/shifts/close', { counted: 26 }));
  assert.equal((await as(cashier).get(`/api/shifts/${ownerShift.id}`)).status, 403);
  assert.equal((await as(stores).post('/api/shifts/open', { float: 1 })).status, 403);
  assert.equal((await as(stores).get('/api/shifts')).status, 403);
  const log = (await ok(as(owner).get('/api/audit'))).map((r) => r.action);
  assert.ok(log.includes('shift.opened') && log.includes('shift.closed'));
});

test('the shop can switch the shift rule off and on', async () => {
  await ok(as(owner).put('/api/settings', { require_shift: false }));
  assert.ok((await ok(as(cashier).post('/api/sales', { items: [{ product_id: 1, qty: 2 }], payment_method: 'cash' }))).id, 'allowed with the rule off');
  await ok(as(owner).put('/api/settings', { require_shift: true }));
  assert.equal((await as(cashier).post('/api/sales', { items: [{ product_id: 1, qty: 1 }] })).status, 400, 'rule back on');
});

test('a voided cash sale is paid back from the drawer of the shift it was voided in', async () => {
  const o = as(owner);
  await o.post('/api/shifts/close', { counted: 0 }).catch(() => {}); // start clean
  await ok(o.post('/api/shifts/open', { float: 0 }));
  const sale = await ok(o.post('/api/sales', { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' })); // +600
  const same = await ok(o.post('/api/sales', { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' })); // +600
  await ok(o.post(`/api/sales/${same.id}/void`, { reason: 'same shift' })); // −600 in this shift
  const z1 = await ok(o.post('/api/shifts/close', { counted: 6 }));
  assert.deepEqual([z1.summary.cash_sales, z1.summary.cash_voids, z1.expected_cents, z1.difference_cents], [1200, 600, 600, 0], 'same-shift void cancels out');
  await ok(o.post('/api/shifts/open', { float: 6 })); // the 6.00 stays in the drawer
  await ok(o.post(`/api/sales/${sale.id}/void`, { reason: 'brought back next shift' })); // 6.00 paid back now
  const z2 = await ok(o.post('/api/shifts/close', { counted: 0 }));
  assert.deepEqual([z2.summary.cash_voids, z2.expected_cents, z2.difference_cents], [600, 0, 0], 'a later void is counted where it happened');
  assert.equal((await ok(o.get(`/api/shifts/${z1.id}`))).expected_cents, 600, 'the earlier Z-report is unchanged');
  const v = (await sql(S.database, 'SELECT voided_by, voided_in_shift FROM sales WHERE id = $1', [sale.id]))[0];
  assert.equal(v.voided_in_shift, z2.id);
});

test('admins can close anyone\'s open shift; cashiers only their own', async () => {
  await ok(as(cashier).post('/api/shifts/open', { float: 10 }));
  await ok(as(cashier).post('/api/sales', { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' })); // +600
  const open = (await ok(as(owner).get('/api/shifts'))).find((s) => s.username === 'cashier' && s.status === 'open');
  assert.equal((await as(cashier).post(`/api/shifts/${open.id}/close`, { counted: 16 })).status, 403, 'not for cashiers');
  const z = await ok(as(owner).post(`/api/shifts/${open.id}/close`, { counted: 15, note: 'left without closing' }));
  assert.deepEqual([z.status, z.expected_cents, z.counted_cents, z.difference_cents], ['closed', 1600, 1500, -100]);
  assert.equal(z.username, 'cashier');
  assert.equal(z.closed_by_username, 'owner');
  assert.equal((await ok(as(cashier).get('/api/shifts/current'))).shift, null, 'the cashier has no open shift now');
  assert.equal((await as(owner).post(`/api/shifts/${open.id}/close`, { counted: 1 })).status, 400, 'already closed');
  const log = (await ok(as(owner).get('/api/audit'))).find((r) => r.action === 'shift.closed' && r.entity_id === String(open.id));
  assert.equal(JSON.parse(log.details).cashier, 'cashier');
});

test('a role with "shifts.close" sees and closes everyone\'s shifts, counting blind', async () => {
  const role = await ok(as(owner).post('/api/roles', { name: 'Supervisor', permissions: ['shifts.close'] }));
  await ok(as(owner).post('/api/users', { username: 'super', password: 'Night#Shift2026', role: 'staff', role_id: role.id }));
  const sup = as(await login('super', 'Night#Shift2026'));
  await ok(as(cashier).post('/api/shifts/open', { float: 5 }));
  await ok(as(cashier).post('/api/sales', { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' })); // +600

  const open = (await ok(sup.get('/api/shifts'))).find((s) => s.username === 'cashier' && s.status === 'open');
  assert.ok(open, "the supervisor sees the cashier's shift");
  assert.equal(open.expected_so_far, undefined, 'no expected cash before counting (blind)');
  assert.equal((await ok(sup.get(`/api/shifts/${open.id}`))).summary.expected_cash, undefined);
  assert.equal((await as(stores).post(`/api/shifts/${open.id}/close`, { counted: 11 })).status, 403, 'not for other roles');

  const z = await ok(sup.post(`/api/shifts/${open.id}/close`, { counted: 11 }));
  assert.deepEqual([z.expected_cents, z.difference_cents, z.closed_by_username], [1100, 0, 'super']);
});

test('an open shift is listed whatever dates are chosen', async () => {
  const fresh = await startServer();
  const c = (method, p, opts = {}) => request(fresh.base, method, p, opts);
  const boss = sid(await c('POST', '/api/setup', { body: { username: 'boss', password: 'Copper#Lantern2026', shop_name: 'History' } }));
  await c('POST', '/api/shifts/open', { cookie: boss, body: { float: 0 } });
  const past = (await c('GET', '/api/shifts?from=2020-01-01&to=2020-01-02', { cookie: boss })).json;
  assert.deepEqual(past.map((s) => s.status), ['open']);
});

// ---------- expiry dates ----------

test('a new product can take production and expiry dates for its opening stock', async () => {
  const o = as(owner);
  const made = day(-20), expires = day(300);
  const p = await ok(o.post('/api/products', { sku: 'JUICE', name: 'Juice', cost: 1, price: 2, stock: 12, production_date: made, expiry_date: expires }));
  const b = (await ok(o.get('/api/inventory/batches'))).batches.find((x) => x.product_id === p.id);
  assert.deepEqual([b.production_date, b.expiry_date, b.qty_left, b.qty_received], [made, expires, 12, 12], 'the opening stock is one batch');
  const bad = (body) => o.post('/api/products', { cost: 1, price: 2, ...body });
  assert.equal((await bad({ sku: 'J2', name: 'J2', stock: 0, expiry_date: expires })).status, 400, 'dates need opening stock');
  assert.equal((await bad({ sku: 'J3', name: 'J3', stock: 5, production_date: made })).status, 400, 'production date alone is not enough');
  assert.equal((await bad({ sku: 'J4', name: 'J4', stock: 5, production_date: expires, expiry_date: made })).status, 400, 'expiry after production');
  assert.equal((await bad({ sku: 'J5', name: 'J5', stock: 5, production_date: day(3), expiry_date: day(300) })).status, 400, 'production not in the future');
  assert.equal((await bad({ sku: 'J6', name: 'J6', stock: 5, expiry_date: '2026-02-30' })).status, 400, 'a real date');
  const plain = await ok(o.post('/api/products', { sku: 'J7', name: 'Plain', cost: 1, price: 2, stock: 3 }));
  assert.ok(!(await ok(o.get('/api/inventory/batches'))).batches.some((x) => x.product_id === plain.id), 'no dates: no batch');
});

test('stock received with expiry dates is sold soonest-expiry first; voids and returns put it back', async () => {
  const o = as(owner);
  await ok(o.post('/api/shifts/open', { float: 0 }));
  await ok(o.post('/api/products', { sku: 'MILK', name: 'Milk', cost: 1, price: 2, stock: 0 }));
  const milk = (await o.get('/api/products')).json.find((p) => p.sku === 'MILK').id;
  const late = day(200), early = day(100);
  await ok(o.post('/api/inventory/restock', { payment_method: 'cash', items: [{ product_id: milk, qty: 5, unit_cost: 1, expiry: late }] }));
  await ok(o.post('/api/inventory/restock', { payment_method: 'cash', items: [{ product_id: milk, qty: 5, unit_cost: 1, expiry: early }, { product_id: milk, qty: 3, unit_cost: 1 }] }));
  assert.deepEqual(await batchesOf(milk), [`${early}:5`, `${late}:5`], 'the line without a date is not a batch');

  const sale = await ok(o.post('/api/sales', { items: [{ product_id: milk, qty: 6 }] }));
  assert.deepEqual(await batchesOf(milk), [`${early}:0`, `${late}:4`], 'earliest expiry first');
  await ok(o.post(`/api/sales/${sale.id}/void`, { reason: 'test' }));
  assert.deepEqual(await batchesOf(milk), [`${early}:5`, `${late}:5`], 'void puts it all back');

  const s2 = await ok(o.post('/api/sales', { items: [{ product_id: milk, qty: 2 }] }));
  const item = (await o.get(`/api/sales/${s2.id}`)).json.items[0];
  await ok(o.post(`/api/sales/${s2.id}/returns`, { items: [{ sale_item_id: item.id, qty: 1 }], refund_method: 'cash', reason: 'back' }));
  assert.deepEqual(await batchesOf(milk), [`${early}:4`, `${late}:5`], 'a return goes back to its batch');
  await ok(o.post(`/api/sales/${s2.id}/returns`, { items: [{ sale_item_id: item.id, qty: 1, damaged: true }], refund_method: 'cash', reason: 'broken' }));
  assert.deepEqual(await batchesOf(milk), [`${early}:4`, `${late}:5`], 'a damaged return is not restocked');

  // Expired stock is not sold while good stock remains; counting stock out takes the soonest first.
  await ok(o.post('/api/inventory/restock', { payment_method: 'cash', items: [{ product_id: milk, qty: 2, unit_cost: 1, expiry: day(-1) }] }));
  await ok(o.post('/api/sales', { items: [{ product_id: milk, qty: 1 }] }));
  assert.deepEqual(await batchesOf(milk), [`${day(-1)}:2`, `${early}:3`, `${late}:5`]);
  const stock = (await o.get('/api/products')).json.find((p) => p.id === milk).stock;
  await ok(o.post('/api/inventory/adjust', { product_id: milk, new_count: stock - 1, note: 'Damaged' }));
  assert.deepEqual(await batchesOf(milk), [`${day(-1)}:2`, `${early}:2`, `${late}:5`]);
});

test('expired and soon-expiring stock is listed and on the dashboard, and can be written off', async () => {
  const list = await ok(as(stores).get('/api/inventory/batches'));
  assert.equal(list.warning_days, 30);
  const expired = list.batches.find((b) => b.state === 'expired');
  assert.equal(expired.days_left, -1);
  assert.equal(expired.product_name, 'Milk');
  assert.ok(list.batches.every((b) => b.state !== 'expired' || b.days_left < 0));
  const seenByCashier = (await ok(as(cashier).get('/api/inventory/batches'))).batches[0];
  assert.equal(seenByCashier.unit_cost_cents, undefined, 'no costs for cashiers');
  assert.equal(seenByCashier.supplier, undefined, 'no supplier details either, as in stock movements');
  assert.equal(seenByCashier.invoice, undefined);

  const dash = await ok(as(owner).get('/api/reports/dashboard'));
  assert.deepEqual([dash.expiring.batches, dash.expiring.expired, dash.expiring.qty], [1, 1, 2]);
  await ok(as(owner).put('/api/settings', { expiry_warning_days: 150 }));
  assert.equal((await ok(as(owner).get('/api/reports/dashboard'))).expiring.batches, 2, 'the batch due in 100 days now counts too');
  assert.equal((await as(owner).put('/api/settings', { expiry_warning_days: 0 })).status, 400);
  await ok(as(owner).put('/api/settings', { expiry_warning_days: 30 }));

  const before = (await ok(as(owner).get('/api/products'))).find((p) => p.sku === 'MILK').stock;
  assert.equal((await as(cashier).post(`/api/inventory/batches/${expired.id}/write-off`, {})).status, 403);
  const w = await ok(as(stores).post(`/api/inventory/batches/${expired.id}/write-off`, { reason: 'Expired' }));
  assert.equal(w.qty, 2);
  assert.equal((await ok(as(owner).get('/api/products'))).find((p) => p.sku === 'MILK').stock, before - 2);
  assert.equal((await as(stores).post(`/api/inventory/batches/${expired.id}/write-off`, {})).status, 400, 'nothing left');
  const moves = await ok(as(owner).get('/api/inventory/movements?limit=1'));
  assert.equal(moves[0].qty_change, -2);
  assert.match(moves[0].note, /Expired/);
});

test('expiry dates must be real dates; backups include shifts and batches', async () => {
  for (const bad of ['2026-02-30', '30/01/2027', 'tomorrow', '1999-12-31']) {
    const r = await as(owner).post('/api/inventory/restock', { payment_method: 'cash', items: [{ product_id: 1, qty: 1, unit_cost: 1, expiry: bad }] });
    assert.equal(r.status, 400, bad);
  }
  const b = await ok(as(owner).post('/api/backups'));
  const file = Buffer.from(await (await fetch(`${S.base}/api/backups/${b.name}/download`, { headers: { Cookie: owner } })).arrayBuffer());
  const doc = JSON.parse(zlib.gunzipSync(file).toString());
  assert.equal(doc.tables.cash_shifts.length, 9, 'every shift opened in these tests');
  assert.equal(doc.tables.stock_batches.length, 4, 'three received lines and one opening stock had expiry dates');
  assert.ok(doc.tables.stock_batches.some((b) => b.production_date), 'production dates are backed up too');
});
