// The shop portal's subscription check with the Waxool admin portal (a stand-in server here):
// a reminder when payment is due, read-only when overdue, and the last answer kept when the admin
// portal cannot be reached.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, request, sid } from './helpers.mjs';

const KEY = 'wx_' + 'k'.repeat(32);
let answer = { status: 200, body: { state: 'ok', message: '' } };
let seenAuth = '';
const fake = http.createServer((req, res) => {
  seenAuth = req.headers.authorization || '';
  if (req.url === '/api/licence/account') {
    if (answer.status !== 200) return res.writeHead(answer.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer.body));
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      ...answer.body,
      business_name: 'Waxool',
      payment_instructions: 'Pay by EVC Plus.',
      plan: { monthly_fee_cents: 2500, currency: 'USD', billing_day: 1, grace_days: 7, status: 'active' },
      balance_cents: 2500,
      invoices: [{ number: 'INV-2026-0001', description: 'Monthly portal fee', issued_on: '2026-11-01', due_on: '2026-11-01', status: 'open', amount_cents: 2500, paid_cents: 0, balance_cents: 2500 }],
      payments: [],
    }));
  }
  if (answer.redirect) return res.writeHead(302, { Location: answer.redirect }).end();
  if (req.url !== '/api/licence') return res.writeHead(404).end();
  res.writeHead(answer.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer.body));
});

let S, owner;
const call = (method, p, body) => request(S.base, method, p, { cookie: owner, body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(stateName) {
  for (let i = 0; i < 60; i++) {
    const b = (await call('GET', '/api/billing')).json;
    if (b?.state === stateName) return b;
    await sleep(100);
  }
  assert.fail(`billing state never became ${stateName}`);
}

before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  S = await startServer({ env: { BILLING_URL: `http://127.0.0.1:${fake.address().port}/`, BILLING_KEY: KEY, BILLING_CHECK_MS: '200' } });
  owner = sid(await request(S.base, 'POST', '/api/setup', { body: { username: 'owner', password: 'Copper#Lantern2026', shop_name: 'Billing Shop' } }));
  await call('PUT', '/api/settings', { require_shift: '0' });
});
after(() => fake.close());

test('the shop portal sends its licence key and shows nothing when paid up', async () => {
  const b = await waitFor('ok');
  assert.equal(seenAuth, `Bearer ${KEY}`);
  assert.equal(b.enabled, true);
  assert.ok(!JSON.stringify(b).includes(KEY), 'the key never reaches the browser');
  assert.equal((await call('POST', '/api/products', { sku: 'A1', name: 'Apple', cost: 1, price: 2, stock: 5 })).status, 200);
});

test('payment due: a reminder on every screen, everything still works', async () => {
  answer = { status: 200, body: { state: 'warn', message: '$25.00 is due. Please pay before 2026-12-09.', amount_due_cents: 2500, currency: 'USD', lock_on: '2026-12-09' } };
  const b = await waitFor('warn');
  assert.match(b.message, /\$25\.00 is due/);
  assert.equal((await call('GET', '/api/me')).json.billing.state, 'warn');
  assert.equal((await call('POST', '/api/products', { sku: 'A2', name: 'Pear', cost: 1, price: 2, stock: 5 })).status, 200);
});

test('owners and admins see their subscription: balance, invoices and payments; cashiers do not', async () => {
  const a = await call('GET', '/api/billing/account');
  assert.equal(a.status, 200, a.text);
  assert.deepEqual([a.json.state, a.json.balance_cents, a.json.invoices.length, a.json.plan.monthly_fee_cents], ['warn', 2500, 1, 2500]);
  assert.ok(!a.text.includes(KEY), 'the key never reaches the browser');
  await call('POST', '/api/users', { username: 'till', password: 'Staff#Pass2026', role: 'staff' });
  const till = sid(await request(S.base, 'POST', '/api/login', { body: { username: 'till', password: 'Staff#Pass2026' } }));
  assert.equal((await request(S.base, 'GET', '/api/billing/account', { cookie: till })).status, 403);
  assert.equal((await request(S.base, 'GET', '/api/billing', { cookie: till })).json.state, 'warn', 'everyone still sees the reminder');
});

test('overdue: read-only, but signing in, viewing and backups still work', async () => {
  answer = { status: 200, body: { state: 'locked', message: 'This portal is read-only because $25.00 is overdue.' } };
  await waitFor('locked');
  const r = await call('POST', '/api/products', { sku: 'A3', name: 'Plum', cost: 1, price: 2, stock: 5 });
  assert.equal(r.status, 423);
  assert.match(r.json.error, /read-only/);
  assert.equal((await call('POST', '/api/sales', { items: [{ product_id: 1, qty: 1 }], payment_method: 'cash' })).status, 423, 'no sales either');
  assert.equal((await call('GET', '/api/products')).status, 200, 'viewing works');
  assert.equal((await call('POST', '/api/backups')).status, 200, 'a backup can still be made');
  const again = await request(S.base, 'POST', '/api/login', { body: { username: 'owner', password: 'Copper#Lantern2026' } });
  assert.equal(again.status, 200, 'signing in works');
});

test('if the admin portal is unreachable or refuses the key, the last answer is kept', async () => {
  answer = { status: 401, body: { error: 'Invalid licence key' } };
  await sleep(700);
  assert.equal((await call('GET', '/api/billing')).json.state, 'locked');
  assert.equal((await call('GET', '/api/billing/account')).status, 502, 'the Subscription page says it cannot load');
  answer = { status: 200, body: { state: 'ok', message: '' } };
  await waitFor('ok');
  assert.equal((await call('POST', '/api/products', { sku: 'A4', name: 'Fig', cost: 1, price: 2, stock: 5 })).status, 200, 'paid: works again');
});

test('the licence key never follows a redirect and is never sent over plain http to another computer', async () => {
  answer = { status: 200, body: { state: 'locked', message: 'x' }, redirect: 'http://127.0.0.1:9/steal' };
  await sleep(700);
  assert.equal((await call('GET', '/api/billing')).json.state, 'ok', 'redirect refused: last answer (ok) kept');
  answer = { status: 200, body: { state: 'ok', message: '' } };
  const P = await startServer({ env: { BILLING_URL: 'http://billing.example.com', BILLING_KEY: KEY } });
  const c = sid(await request(P.base, 'POST', '/api/setup', { body: { username: 'owner', password: 'Copper#Lantern2026' } }));
  assert.deepEqual((await request(P.base, 'GET', '/api/billing', { cookie: c })).json, { state: 'ok', enabled: false }, 'switched off rather than send the key unencrypted');
});

test('the last answer survives a restart, and a shop without billing settings is never locked', async () => {
  answer = { status: 200, body: { state: 'locked', message: 'Overdue.' } };
  await waitFor('locked');
  fake.close();
  // Same database, admin portal now unreachable: still locked after the restart.
  const T = await startServer({ database: S.database, env: { BILLING_URL: 'http://127.0.0.1:9/', BILLING_KEY: KEY } });
  const cookie = sid(await request(T.base, 'POST', '/api/login', { body: { username: 'owner', password: 'Copper#Lantern2026' } }));
  let b;
  for (let i = 0; i < 50 && b?.state !== 'locked'; i++, await sleep(100)) b = (await request(T.base, 'GET', '/api/billing', { cookie })).json;
  assert.equal(b.state, 'locked');
  // Same database, no billing settings (a shop running its own copy): never locked.
  const U = await startServer({ database: S.database, env: { BILLING_URL: '', BILLING_KEY: '' } });
  const c2 = sid(await request(U.base, 'POST', '/api/login', { body: { username: 'owner', password: 'Copper#Lantern2026' } }));
  assert.deepEqual((await request(U.base, 'GET', '/api/billing', { cookie: c2 })).json, { state: 'ok', enabled: false });
  assert.equal((await request(U.base, 'POST', '/api/products', { cookie: c2, body: { sku: 'A5', name: 'Kiwi', cost: 1, price: 2, stock: 5 } })).status, 200);
});
