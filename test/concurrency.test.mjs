// PostgreSQL runs requests in parallel: changes that check-then-write must still never step on each other.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, request, sid } from './helpers.mjs';

let base, owner;
const call = (method, p, opts = {}) => request(base, method, p, { cookie: owner, ...opts });

before(async () => {
  ({ base } = await startServer());
  owner = sid(await call('POST', '/api/setup', { body: { username: 'owner', password: 'Copper#Lantern2026', shop_name: 'Race' } }));
  await call('POST', '/api/products', { body: { sku: 'LAST', name: 'Last one', cost: 1, price: 2, stock: 1 } });
  await call('POST', '/api/customers', { body: { name: 'Cara', phone: '0700000001' } });
});

test('ten tills selling the last item at the same moment: exactly one sale goes through', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => call('POST', '/api/sales', { body: { items: [{ product_id: 1, qty: 1 }] } })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 400 && /Not enough stock/.test(r.json.error)));
  assert.equal((await call('GET', '/api/products')).json[0].stock, 0);
});

test('payments recorded at the same moment get different, consecutive reference numbers', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/api/customers/1/payments', { body: { amount: 1 } })));
  const refs = results.map((r) => r.json.payment.ref).sort();
  assert.deepEqual(refs, ['CUST001', 'CUST002', 'CUST003', 'CUST004', 'CUST005', 'CUST006', 'CUST007', 'CUST008']);
});

test('the same SKU added twice at once: one is refused with a clear message, not a crash', async () => {
  const results = await Promise.all([1, 2].map(() => call('POST', '/api/products', { body: { sku: 'twin', name: 'Twin', cost: 0.5, price: 1 } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400], results.map((r) => r.text).join(' | '));
  assert.match(results.find((r) => r.status === 400).json.error, /already exists/);
});
