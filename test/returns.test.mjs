// Return items: partial and full returns, exact refund maths, stock, accounts and reports.
// Every expected figure (cents) is worked out by hand in the comments. Run with:  npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, request, sid } from './helpers.mjs';

let base, admin, staff;

// Signed in as the owner unless another cookie is given.
const call = (method, p, { cookie = admin, ...opts } = {}) => request(base, method, p, { cookie, ...opts });
const ok = async (...a) => {
  const r = await call(...a);
  if (r.status !== 200) throw new Error(`${a[0]} ${a[1]} -> ${r.status} ${r.text}`);
  return r.json;
};
const ret = (saleId, items, refund_method, extra = {}) => call('POST', `/api/sales/${saleId}/returns`, { body: { items, refund_method, reason: 'test', ...extra } });

before(async () => {
  ({ base } = await startServer());
  admin = sid(await request(base, 'POST', '/api/setup', { body: { username: 'boss', password: 'Copper#Lantern2026', shop_name: 'Ret' } }));
  await ok('POST', '/api/users', { body: { username: 'till', password: 'blue tiger lamp river', role: 'staff' } });
  staff = sid(await request(base, 'POST', '/api/login', { body: { username: 'till', password: 'blue tiger lamp river' } }));
  await ok('PUT', '/api/settings', { body: { tax_rate: 10 } });
  await ok('POST', '/api/products', { body: { sku: 'P1', name: 'Pen', cost: 2, price: 3.33, stock: 100 } });
  await ok('POST', '/api/products', { body: { sku: 'P2', name: 'Pad', cost: 6, price: 10, stock: 100 } });
  await ok('POST', '/api/customers', { body: { name: 'Cara', phone: '0700000001' } });
  // S1 cash: 3×P1 + 2×P2, 7% off. subtotal 2999, discount round(209.93)=210, tax round(278.9)=279, total 3068, cogs 1800
  await ok('POST', '/api/sales', { body: { items: [{ product_id: 1, qty: 3 }, { product_id: 2, qty: 2 }], discount: 7, discount_type: 'percent', payment_method: 'cash' } });
  // S2 credit to Cara: 2×P2. subtotal 2000, tax 200, total 2200
  await ok('POST', '/api/sales', { body: { items: [{ product_id: 2, qty: 2 }], payment_method: 'credit', customer_id: 1 } });
});

const items = async (saleId) => (await ok('GET', `/api/sales/${saleId}`)).items;

test('partial returns refund the exact share of what was paid, and all of them add up to the sale', async () => {
  const [i1, i2] = await items(1);

  // Preview changes nothing.
  const pv = await ok('POST', '/api/sales/1/returns', { body: { items: [{ sale_item_id: i1.id, qty: 1 }], refund_method: 'cash', preview: true } });
  assert.deepEqual([pv.subtotal_cents, pv.discount_cents, pv.tax_cents, pv.total_cents], [333, 23, 31, 341]);
  assert.equal((await ok('GET', '/api/sales/1')).returns.length, 0);

  // R1: 1×P1 cash. share of discount round(210·333/2999)=23, tax round(279·333/2999)=31 → 333−23+31 = 341
  const r1 = (await ret(1, [{ sale_item_id: i1.id, qty: 1 }], 'cash')).json;
  assert.deepEqual([r1.ref, r1.refund_method, r1.discount_cents, r1.tax_cents, r1.total_cents], ['RET001', 'cash', 23, 31, 341]);

  // R2: 1×P1 + 1×P2 (damaged), card. running gross 333→1666: discount 117−23=94, tax 155−31=124 → 1333−94+124 = 1363
  const r2 = (await ret(1, [{ sale_item_id: i1.id, qty: 1 }, { sale_item_id: i2.id, qty: 1, damaged: true }], 'card')).json;
  assert.deepEqual([r2.ref, r2.refund_method, r2.discount_cents, r2.tax_cents, r2.total_cents], ['RET002', 'card', 94, 124, 1363]);

  // Store credit is refused: this sale has no registered customer.
  assert.equal((await ret(1, [{ sale_item_id: i1.id, qty: 1 }], 'credit')).status, 400);

  // R3: the rest (1×P1 + 1×P2). discount 210−117=93, tax 279−155=124 → 1333−93+124 = 1364
  const r3 = (await ret(1, [{ sale_item_id: i1.id, qty: 1 }, { sale_item_id: i2.id, qty: 1 }], 'mobile')).json;
  assert.deepEqual([r3.discount_cents, r3.tax_cents, r3.total_cents], [93, 124, 1364]);
  assert.equal(341 + 1363 + 1364, 3068, 'refunds = sale total exactly');

  const sale = await ok('GET', '/api/sales/1');
  assert.deepEqual(sale.items.map((i) => [i.qty, i.returned_qty]), [[3, 3], [2, 2]]);
  assert.equal(sale.returns.reduce((a, r) => a + r.total_cents, 0), sale.total_cents);
  assert.equal(sale.returns.reduce((a, r) => a + r.discount_cents, 0), sale.discount_cents);
  assert.equal(sale.returns.reduce((a, r) => a + r.tax_cents, 0), sale.tax_cents);
});

test('cannot return more than was sold, an item twice in one go, an item from another sale, or nothing', async () => {
  const [i1] = await items(1);
  const [s2] = await items(2);
  assert.match((await ret(1, [{ sale_item_id: i1.id, qty: 1 }], 'cash')).json.error, /Only 0 of Pen/);
  assert.equal((await ret(2, [{ sale_item_id: s2.id, qty: 1 }, { sale_item_id: s2.id, qty: 1 }], 'cash')).status, 400);
  assert.equal((await ret(2, [{ sale_item_id: i1.id, qty: 1 }], 'cash')).status, 400);
  assert.equal((await ret(2, [{ sale_item_id: s2.id, qty: 0 }], 'cash')).status, 400);
  assert.equal((await ret(2, [{ sale_item_id: s2.id, qty: 1 }], 'cash', { reason: '' })).status, 400, 'reason required');
  assert.equal((await ret(2, [{ sale_item_id: s2.id, qty: 1 }], 'bitcoin')).status, 400, 'unknown refund method refused');
});

test('a sale with returns cannot be voided; returns are owner-only; cashiers see returns without costs', async () => {
  assert.match((await call('POST', '/api/sales/1/void', { body: { reason: 'x' } })).json.error, /already has returns/);
  const [s2] = await items(2);
  assert.equal((await call('POST', '/api/sales/2/returns', { cookie: staff, body: { items: [{ sale_item_id: s2.id, qty: 1 }], reason: 'x' } })).status, 403);
  const view = (await call('GET', '/api/sales/1', { cookie: staff })).json;
  assert.equal(view.returns.length, 3);
  assert.equal(view.returns[0].cogs_cents, undefined);
  assert.equal(view.returns[0].items[0].cost_cents, undefined);
});

test('credit sale: a return comes off what the customer owes (even if cash is chosen)', async () => {
  const [s2] = await items(2);
  // R4: 1×P2 of a credit sale. tax round(200·1000/2000)=100 → 1100, method forced to the account
  const r4 = (await ret(2, [{ sale_item_id: s2.id, qty: 1 }], 'cash')).json;
  assert.deepEqual([r4.ref, r4.refund_method, r4.total_cents], ['RET004', 'credit', 1100]);
  const c = await ok('GET', '/api/customers/1');
  assert.equal(c.balance_cents, 2200 - 1100);
  assert.equal(c.total_returned_cents, 1100);
  const st = await ok('GET', '/api/customers/1/statement');
  assert.deepEqual(st.entries.map((e) => [e.kind, e.charge_cents, e.paid_cents, e.balance_cents]), [['sale', 2200, 0, 2200], ['return', -1100, 0, 1100]]);
  assert.equal(st.entries[1].ref, 'RET004');
  assert.match((await call('GET', '/api/customers/1/statement.csv')).text, /Return,RET004,.*-11\.00,0\.00,11\.00/);
});

test('stock: returned items go back on the shelf, damaged ones do not; history adds up', async () => {
  const all = await ok('GET', '/api/products');
  const p1 = all.find((p) => p.sku === 'P1');
  const p2 = all.find((p) => p.sku === 'P2');
  assert.equal(p1.stock, 100, 'P1: 100 − 3 sold + 3 returned');
  assert.equal(p2.stock, 98, 'P2: 100 − 2 − 2 sold + 1 returned (S1) + 1 returned (S2); 1 damaged written off');
  assert.equal(p1.cost_cents, 200);
  assert.equal(p2.cost_cents, 600);
  const moves = await ok('GET', '/api/inventory/movements?limit=1000');
  assert.equal(moves.filter((m) => m.type === 'return').length, 5, 'R1 1 + R2 1 (damaged not restocked) + R3 2 + R4 1');
  for (const p of [p1, p2]) assert.equal(moves.filter((m) => m.product_id === p.id).reduce((a, m) => a + m.qty_change, 0), p.stock);
});

test('profit & loss, cash flow and dashboard include returns', async () => {
  const pl = await ok('GET', '/api/reports/pl');
  assert.equal(pl.gross_sales, 4999);
  assert.equal(pl.discounts, 210);
  assert.equal(pl.returns, 310 + 1239 + 1240 + 1000, 'returned items net of their discount share');
  assert.equal(pl.returns_count, 4);
  assert.equal(pl.net_sales, 1000, 'only one Pad (S2) is still sold');
  assert.equal(pl.cogs, 600);
  assert.equal(pl.gross_profit, 400);
  assert.equal(pl.returns_written_off, 600, 'damaged Pad');
  assert.equal(pl.net_profit, 400 - 600);
  assert.equal(pl.tax_collected, 100, 'tax on the one Pad still sold');
  assert.equal(pl.cash.sales_collected, 3068);
  assert.equal(pl.cash.refunds_paid, 3068);
  assert.equal(pl.cash.returns_to_accounts, 1100);
  assert.equal(pl.cash.net, 0);
  assert.deepEqual(pl.receivables, { total: 1100, customers: 1 });
  const d = await ok('GET', '/api/reports/dashboard');
  assert.deepEqual(d.today, { count: 2, total: 5268, refunds: 4168 });
});

test('exports and audit log', async () => {
  const sales = (await call('GET', '/api/export/sales.csv')).text.trim().split('\r\n');
  assert.equal(sales[0].split(',').at(-1), 'Refunded (returns)');
  assert.equal(sales[1].split(',').at(-1), '30.68');
  const rcsv = (await call('GET', '/api/export/returns.csv')).text.trim().split('\r\n');
  assert.equal(rcsv.length, 5);
  assert.match(rcsv[2], /RET002,.*1 × Pen, 1 × Pad \(damaged\)",card,13\.33,0\.94,1\.24,13\.63,test/);
  const log = await ok('GET', '/api/audit?from=2000-01-01&action=sale.returned');
  assert.equal(log.length, 4);
});
