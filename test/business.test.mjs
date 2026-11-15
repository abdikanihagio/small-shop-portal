// Business-logic regression test: a realistic month of trading on a throwaway database, with
// every total checked against figures worked out by hand (in cents). Run with:  npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, request, sid } from './helpers.mjs';

let base, admin, staff;

// Any error answer fails the test straight away.
const call = async (method, p, opts) => {
  const r = await request(base, method, p, opts);
  if (r.status >= 400) throw new Error(`${method} ${p} -> ${r.status} ${r.text}`);
  return r;
};
const A = (p, body) => call('POST', p, { cookie: admin, body });
const G = (p, cookie = admin) => call('GET', p, { cookie }).then((r) => r.json);

before(async () => {
  ({ base } = await startServer());
  admin = sid(await call('POST', '/api/setup', { body: { username: 'boss', password: 'Copper#Lantern2026', shop_name: 'Biz' } }));
  await A('/api/users', { username: 'till', password: 'blue tiger lamp river', role: 'staff' });
  staff = sid(await call('POST', '/api/login', { body: { username: 'till', password: 'blue tiger lamp river' } }));

  await call('PUT', '/api/settings', { cookie: admin, body: { tax_rate: 10 } });
  await A('/api/products', { sku: 'A', name: 'Alpha', cost: 4, price: 10, stock: 10, reorder_level: 2 });
  await A('/api/products', { sku: 'B', name: 'Beta', cost: 1, price: 2.5, stock: 20 });
  await A('/api/customers', { name: 'Cara', phone: '0700000001' });
  await A('/api/suppliers', { name: 'Supply Co' });

  // 1. Cash sale, 2×A, 10% off.        subtotal 2000, discount 200, tax 180, total 1980, cogs 800
  await A('/api/sales', { items: [{ product_id: 1, qty: 2 }], discount: 10, discount_type: 'percent', payment_method: 'cash' });
  // 2. Credit sale to Cara, 1×A + 2×B. subtotal 1500, tax 150, total 1650, cogs 600
  await A('/api/sales', { items: [{ product_id: 1, qty: 1 }, { product_id: 2, qty: 2 }], payment_method: 'credit', customer_id: 1 });
  // 3. Card sale, 4×B, 1.00 off.       subtotal 1000, discount 100, tax 90, total 990, cogs 400 (voided later)
  await A('/api/sales', { items: [{ product_id: 2, qty: 4 }], discount: 1, payment_method: 'card' });
  // 4. Receive 10×A @ 6.00 on credit.  A: 7 in stock @ 4.00 → avg round((7·400 + 10·600) / 17) = 518
  await A('/api/inventory/restock', { supplier_id: 1, payment_method: 'credit', note: 'INV-1', items: [{ product_id: 1, qty: 10, unit_cost: 6 }] });
  // 5. Receive 6×B @ 1.50 paid cash.   B: 14 @ 1.00 → avg round((14·100 + 6·150) / 20) = 115
  await A('/api/inventory/restock', { payment_method: 'cash', items: [{ product_id: 2, qty: 6, unit_cost: 1.5 }] });
  // 6. Customer pays 10.00; a 2.00 payment is entered and reversed.
  await A('/api/customers/1/payments', { amount: 10, method: 'mobile' });
  const p2 = (await A('/api/customers/1/payments', { amount: 2 })).json.payment;
  await A(`/api/customers/1/payments/${p2.id}/reverse`, { reason: 'typo' });
  // 7. Pay supplier 25.00.
  await A('/api/suppliers/1/payments', { amount: 25, method: 'bank' });
  // 8. Rent 50.00; utilities 20.00 entered and reversed.
  await A('/api/expenses', { category: 'Rent', amount: 50 });
  await A('/api/expenses', { category: 'Utilities', amount: 20 });
  await A('/api/expenses/2/reverse', { reason: 'wrong month' });
  // 9. Count B: 20 → 19 (one damaged at avg cost 115).
  await A('/api/inventory/adjust', { product_id: 2, new_count: 19, note: 'Damaged' });
  // 10. Void the card sale (B back +4 → 23).
  await A('/api/sales/3/void', { reason: 'returned' });
  // 11. Cash sale 1×A at the new average cost.  subtotal 1000, tax 100, total 1100, cogs 518
  await A('/api/sales', { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' });
});

test('stock levels and weighted average costs', async () => {
  const [a, b] = await G('/api/products');
  assert.deepEqual({ stock: a.stock, cost: a.cost_cents }, { stock: 16, cost: 518 });
  assert.deepEqual({ stock: b.stock, cost: b.cost_cents }, { stock: 23, cost: 115 });
});

test('profit & loss', async () => {
  const pl = await G('/api/reports/pl');
  assert.equal(pl.sales_count, 3, 'voided sale excluded');
  assert.equal(pl.gross_sales, 4500);
  assert.equal(pl.discounts, 200);
  assert.equal(pl.net_sales, 4300);
  assert.equal(pl.cogs, 1918);
  assert.equal(pl.gross_profit, 2382);
  assert.equal(pl.inventory_adjustments, 115);
  assert.deepEqual(pl.expenses, [{ category: 'Rent', amount: 5000 }], 'reversed expense excluded');
  assert.equal(pl.total_expenses, 5000);
  assert.equal(pl.net_profit, 2382 - 115 - 5000);
  assert.equal(pl.tax_collected, 430);
});

test('cash flow, receivables and payables', async () => {
  const { cash, receivables, payables } = await G('/api/reports/pl');
  assert.equal(cash.sales_collected, 3080, 'cash + card sales, not credit, not voided');
  assert.equal(cash.credit_sales, 1650);
  assert.equal(cash.customer_payments, 1000, 'reversed payment excluded');
  assert.equal(cash.inventory_purchases, 900, 'only stock paid on delivery');
  assert.equal(cash.credit_purchases, 6000);
  assert.equal(cash.supplier_payments, 2500);
  assert.equal(cash.expenses_paid, 5000);
  assert.equal(cash.net, 3080 + 1000 - 900 - 2500 - 5000);
  assert.deepEqual(
    cash.by_method.map((m) => [m.method, m.count, m.amount]).sort(),
    [['cash', 2, 3080], ['credit', 1, 1650]]
  );
  assert.deepEqual(receivables, { total: 650, customers: 1 });
  assert.deepEqual(payables, { total: 3500, suppliers: 1 });
});

test('customer account and statement', async () => {
  const c = await G('/api/customers/1');
  assert.deepEqual(
    { balance: c.balance_cents, sales: c.sale_count, bought: c.total_purchases_cents, credit: c.total_credit_cents, paid: c.total_paid_cents },
    { balance: 650, sales: 1, bought: 1650, credit: 1650, paid: 1000 }
  );
  const st = await G('/api/customers/1/statement');
  assert.equal(st.opening_balance, 0);
  assert.equal(st.closing_balance, 650);
  assert.deepEqual(st.entries.map((e) => [e.kind, e.charge_cents, e.paid_cents, e.balance_cents, e.status]), [
    ['sale', 1650, 0, 1650, 'completed'],
    ['payment', 0, 1000, 650, 'completed'],
    ['payment', 0, 0, 650, 'reversed'],
  ]);
  assert.deepEqual(st.entries.filter((e) => e.kind === 'payment').map((e) => e.ref), ['CUST001', 'CUST002']);
});

test('supplier account and statement', async () => {
  const s = await G('/api/suppliers/1');
  assert.equal(s.balance_cents, 3500);
  const st = await G('/api/suppliers/1/statement');
  assert.deepEqual(st.entries.map((e) => [e.kind, e.charge_cents, e.paid_cents, e.balance_cents]), [
    ['purchase', 6000, 0, 6000],
    ['payment', 0, 2500, 3500],
  ]);
  const d = await G('/api/purchases/1');
  assert.deepEqual(d.items.map((i) => [i.name, i.qty, i.unit_cost_cents]), [['Alpha', 10, 600]]);
  assert.equal(d.total_cents, 6000);
});

test('dashboard figures (owner and cashier)', async () => {
  const d = await G('/api/reports/dashboard');
  assert.deepEqual(d.today, { count: 3, total: 4730, refunds: 0 });
  assert.equal(d.inventory_value, 16 * 518 + 23 * 115);
  assert.equal(d.month.net_profit, 2382 - 115 - 5000);
  assert.deepEqual(d.low_stock, []);
  const s = await G('/api/reports/dashboard', staff);
  assert.equal(s.month, undefined, 'cashier sees no profit');
  assert.equal(s.inventory_value, undefined);
});

test('sale detail, receipt numbers and staff view', async () => {
  const s1 = await G('/api/sales/1');
  assert.deepEqual([s1.subtotal_cents, s1.discount_cents, s1.discount_percent, s1.tax_cents, s1.total_cents, s1.cogs_cents], [2000, 200, 10, 180, 1980, 800]);
  const s3 = await G('/api/sales/3');
  assert.equal(s3.status, 'void');
  assert.equal(s3.discount_percent, null, 'money discount has no %');
  const staffView = await G('/api/sales/1', staff);
  assert.equal(staffView.total_cents, 1980);
  assert.equal(staffView.cogs_cents, undefined);
});

test('stock movement history adds up to current stock', async () => {
  const moves = await G('/api/inventory/movements?limit=1000');
  for (const [id, stock] of [[1, 16], [2, 23]]) {
    const sum = moves.filter((m) => m.product_id === id).reduce((a, m) => a + m.qty_change, 0);
    assert.equal(sum, stock, `product ${id}`);
  }
});

test('exports: sales CSV totals and expense status', async () => {
  const csv = (await call('GET', '/api/export/sales.csv', { cookie: admin })).text.trim().split('\r\n');
  assert.equal(csv.length, 1 + 4);
  const totals = csv.slice(1).map((l) => l.split(','));
  assert.deepEqual(totals.map((r) => [r[0], r[2], r[9]]), [['1', 'completed', '19.80'], ['2', 'completed', '16.50'], ['3', 'void', '9.90'], ['4', 'completed', '11.00']]);
  const exp = (await call('GET', '/api/export/expenses.csv', { cookie: admin })).text;
  assert.match(exp, /Utilities.*reversed .*wrong month/);
  assert.match(exp, /Rent,,cash,50\.00,ok/);
});

test('date filters: a range before today has no sales', async () => {
  const pl = await G('/api/reports/pl?from=2000-01-01&to=2000-01-31');
  assert.equal(pl.sales_count, 0);
  assert.equal(pl.net_profit, 0);
  assert.deepEqual(await G('/api/sales?from=2000-01-01&to=2000-01-31'), []);
});

test('import with "update existing" changes prices but does not re-activate retired products', async () => {
  await call('PUT', '/api/products/2', { cookie: admin, body: { sku: 'B', name: 'Beta', cost: 1.15, price: 2.5, active: false } });
  const r = await fetch(base + '/api/products/import?filename=prices.csv&update=1&commit=1', {
    method: 'POST',
    headers: { Cookie: admin, 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'shop-portal' },
    body: 'SKU,Name,Selling price\nB,Beta,2.75\n',
  });
  assert.equal(r.status, 200);
  const b = (await G('/api/products?all=1')).find((p) => p.sku === 'B');
  assert.equal(b.price_cents, 275, 'price updated');
  assert.equal(b.active, 0, 'still retired');
  assert.ok(!(await G('/api/products')).some((p) => p.sku === 'B'), 'not back at the till');
});
