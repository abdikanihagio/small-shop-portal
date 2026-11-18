// Waxool admin portal: sign-in, shops, monthly invoices, payments and the licence check shops make.
// Each run uses throwaway databases (created and dropped with the PG_ADMIN_* login from ../.env).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
require(path.join(ROOT, 'src', 'config.js')); // loads .env for the PG login
const pg = require('pg');

const children = [];
const databases = [];
const adminClient = () => new pg.Client({ user: process.env.PG_ADMIN_USER, password: process.env.PG_ADMIN_PASSWORD, database: 'postgres' });

async function createDb() {
  const name = `waxool_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const c = adminClient();
  await c.connect();
  await c.query(`CREATE DATABASE ${name} OWNER ${process.env.PGUSER}`);
  await c.end();
  databases.push(name);
  return name;
}

async function startAdmin(env = {}) {
  const database = await createDb();
  for (let attempt = 1; ; attempt++) {
    const port = 41000 + Math.floor(Math.random() * 18000);
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), ADMIN_PGDATABASE: database, DATABASE_URL: '', ...env } });
    children.push(child);
    let errors = '';
    child.stderr.on('data', (d) => (errors += d));
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('admin did not start: ' + errors)), 15000);
        child.stdout.on('data', (d) => d.toString().includes('running at') && (clearTimeout(t), resolve()));
        child.on('exit', (code) => (clearTimeout(t), reject(new Error(`exited ${code}: ${errors}`))));
      });
      return { base: `http://127.0.0.1:${port}`, database };
    } catch (err) {
      if (attempt >= 5 || !/EACCES|EADDRINUSE/.test(err.message)) throw err;
    }
  }
}

after(async () => {
  for (const c of children) {
    c.kill();
    await new Promise((r) => (c.exitCode !== null ? r() : c.once('exit', r)));
  }
  const c = adminClient();
  await c.connect();
  for (const d of databases) await c.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
  await c.end();
});

async function request(base, method, p, { cookie, body, headers = {}, portal = true } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (portal && method !== 'GET') h['X-Requested-With'] = 'waxool-admin';
  const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const sid = (r) => (r.headers.get('set-cookie') || '').match(/wsid=[0-9a-f]+/)?.[0];

const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

let A, cookie;
const call = (method, p, body) => request(A.base, method, p, { cookie, body });
const ok = async (p) => {
  const r = await p;
  assert.equal(r.status, 200, r.text);
  return r.json;
};
const licence = (key) => request(A.base, 'GET', '/api/licence', { headers: key ? { Authorization: `Bearer ${key}` } : {} });

before(async () => {
  A = await startAdmin();
  const r = await request(A.base, 'POST', '/api/setup', { body: { username: 'boss', name: 'Boss', password: 'Copper lantern river 7' } });
  assert.equal(r.status, 200, r.text);
  cookie = sid(r);
});

test('setup happens once, sign-in works, and everything else needs a signed-in admin', async () => {
  assert.equal((await request(A.base, 'POST', '/api/setup', { body: { username: 'x', password: 'Another long pass 9' } })).status, 403);
  assert.equal((await request(A.base, 'GET', '/api/shops')).status, 401);
  assert.equal((await request(A.base, 'POST', '/api/login', { body: { username: 'boss', password: 'wrong password here' } })).status, 401);
  const r = await request(A.base, 'POST', '/api/login', { body: { username: 'boss', password: 'Copper lantern river 7' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await request(A.base, 'POST', '/api/shops', { cookie, body: { name: 'X', monthly_fee: 1 }, portal: false })).status, 403, 'needs the portal header');
});

test('a new shop gets a licence key shown once; the key is never listed again', async () => {
  const r = await ok(call('POST', '/api/shops', { name: 'Key Shop', monthly_fee: 20, billing_day: 1, started_on: day(40) }));
  assert.match(r.licence_key, /^wx_[A-Za-z0-9_-]{30,}$/);
  const list = await ok(call('GET', '/api/shops'));
  const s = list.find((x) => x.id === r.id);
  assert.equal(s.key_hash, undefined);
  assert.equal(s.key_hint, r.licence_key.slice(-4));
  assert.ok(!JSON.stringify(list).includes(r.licence_key));
  assert.equal((await licence(r.licence_key)).json.state, 'ok', 'starts in the future: nothing owed');
  assert.equal((await licence('wx_' + 'a'.repeat(32))).status, 401);
  assert.equal((await licence()).status, 401);
  const replaced = await ok(call('POST', `/api/shops/${r.id}/key`));
  assert.equal((await licence(r.licence_key)).status, 401, 'old key stops working');
  assert.equal((await licence(replaced.licence_key)).status, 200);
});

test('monthly invoices are issued once per month from the billing day', async () => {
  const { id, licence_key } = await ok(call('POST', '/api/shops', { name: 'Monthly Shop', monthly_fee: 25, billing_day: 1, started_on: '2020-01-01', grace_days: 60 }));
  const detail = await ok(call('GET', `/api/shops/${id}`));
  assert.equal(detail.invoices.length, 1, 'only this month: earlier months are not billed afterwards');
  const inv = detail.invoices[0];
  assert.equal(inv.amount_cents, 2500);
  assert.equal(inv.period, day(0).slice(0, 7));
  assert.equal(inv.due_on, `${day(0).slice(0, 7)}-01`);
  assert.match(inv.description, /^Monthly portal fee, /);
  assert.equal((await ok(call('POST', '/api/invoices/generate'))).created, 0, 'never twice');
  const l = (await licence(licence_key)).json;
  assert.equal(l.state, 'warn');
  assert.equal(l.amount_due_cents, 2500);
  assert.match(l.message, /\$25\.00 is due/);
});

test('warn, then locked after the grace days; paying unlocks; reversing locks again', async () => {
  const { id, licence_key } = await ok(call('POST', '/api/shops', { name: 'Grace Shop', monthly_fee: 30, billing_day: 1, started_on: day(40), grace_days: 3 }));
  const inv = await ok(call('POST', `/api/shops/${id}/invoices`, { description: 'Setup', amount: 50, issued_on: day(-10), due_on: day(0) }));
  let l = (await licence(licence_key)).json;
  assert.deepEqual([l.state, l.lock_on], ['warn', day(4)]);
  await ok(call('POST', `/api/invoices/${inv.id}/due`, { due_on: day(-4) }));
  l = (await licence(licence_key)).json;
  assert.equal(l.state, 'locked', 'four days late with three grace days');
  assert.match(l.message, /read-only/);

  assert.equal((await call('POST', `/api/invoices/${inv.id}/payments`, { amount: 60, method: 'EVC Plus' })).status, 400, 'more than owed');
  assert.equal((await call('POST', `/api/invoices/${inv.id}/payments`, { amount: 10, method: 'Bitcoin' })).status, 400, 'unknown method');
  let r = await ok(call('POST', `/api/invoices/${inv.id}/payments`, { amount: 20, method: 'Zaad', reference: 'TX1' }));
  assert.deepEqual([r.status, r.balance_cents], ['open', 3000]);
  assert.equal((await licence(licence_key)).json.state, 'locked', 'part payment is not enough');
  r = await ok(call('POST', `/api/invoices/${inv.id}/payments`, { amount: 30, method: 'EVC Plus', reference: 'TX2' }));
  assert.deepEqual([r.status, r.balance_cents], ['paid', 0]);
  assert.equal((await licence(licence_key)).json.state, 'ok');
  assert.equal((await call('POST', `/api/invoices/${inv.id}/void`, { reason: 'x' })).status, 400, 'cannot void with payments');

  const pay = r.payments.find((p) => p.reference === 'TX2');
  r = await ok(call('POST', `/api/payments/${pay.id}/reverse`, { reason: 'bounced' }));
  assert.equal(r.status, 'open');
  assert.equal((await licence(licence_key)).json.state, 'locked');
  assert.equal((await call('POST', `/api/payments/${pay.id}/reverse`, { reason: 'again' })).status, 400);
});

test('suspending locks the shop portal; activating unlocks it', async () => {
  const { id, licence_key } = await ok(call('POST', '/api/shops', { name: 'Paused Shop', monthly_fee: 10, billing_day: 1, started_on: day(40) }));
  await ok(call('POST', `/api/shops/${id}/status`, { status: 'suspended' }));
  const l = (await licence(licence_key)).json;
  assert.deepEqual([l.state, l.reason], ['locked', 'suspended']);
  await ok(call('POST', `/api/shops/${id}/status`, { status: 'active' }));
  assert.equal((await licence(licence_key)).json.state, 'ok');
});

test('voiding an open invoice clears what is owed', async () => {
  const { id, licence_key } = await ok(call('POST', '/api/shops', { name: 'Void Shop', monthly_fee: 10, billing_day: 1, started_on: day(40) }));
  const inv = await ok(call('POST', `/api/shops/${id}/invoices`, { description: 'Mistake', amount: 99, due_on: day(0) }));
  assert.equal((await licence(licence_key)).json.state, 'warn');
  assert.equal((await call('POST', `/api/invoices/${inv.id}/void`, {})).status, 400, 'reason required');
  await ok(call('POST', `/api/invoices/${inv.id}/void`, { reason: 'wrong amount' }));
  assert.equal((await licence(licence_key)).json.state, 'ok');
});

test('the dashboard adds it all up; settings feed the message shops see', async () => {
  await ok(call('PUT', '/api/settings', { business_name: 'Waxool', payment_instructions: 'Pay by EVC Plus to 610000000.' }));
  const d = await ok(call('GET', '/api/dashboard'));
  assert.ok(d.active >= 4);
  assert.ok(d.monthly[0].cents > 0);
  assert.ok(d.needs_attention.some((s) => s.name === 'Grace Shop' && s.portal.state === 'locked'));
  const shops = await ok(call('GET', '/api/shops'));
  assert.match(shops.find((s) => s.name === 'Grace Shop').portal.message, /Pay by EVC Plus to 610000000\./);
});

test("a shop's account shows its own plan, invoices and payments, and nothing internal", async () => {
  const one = await ok(call('POST', '/api/shops', { name: 'Account Shop', monthly_fee: 40, billing_day: 1, started_on: day(40), notes: 'secret internal note' }));
  const other = await ok(call('POST', '/api/shops', { name: 'Other Shop', monthly_fee: 99, billing_day: 1, started_on: day(40) }));
  const inv = await ok(call('POST', `/api/shops/${one.id}/invoices`, { description: 'Monthly portal fee', amount: 40, due_on: day(0) }));
  await ok(call('POST', `/api/invoices/${inv.id}/payments`, { amount: 15, method: 'Zaad', reference: 'ZX9', note: 'internal payment note' }));
  const voided = await ok(call('POST', `/api/shops/${one.id}/invoices`, { description: 'Wrong', amount: 5, due_on: day(0) }));
  await ok(call('POST', `/api/invoices/${voided.id}/void`, { reason: 'internal void reason' }));
  await ok(call('POST', `/api/shops/${other.id}/invoices`, { description: 'Not yours', amount: 99, due_on: day(0) }));

  const r = await request(A.base, 'GET', '/api/licence/account', { headers: { Authorization: `Bearer ${one.licence_key}` } });
  assert.equal(r.status, 200, r.text);
  const a = r.json;
  assert.deepEqual([a.state, a.balance_cents, a.plan.monthly_fee_cents, a.plan.billing_day], ['warn', 2500, 4000, 1]);
  assert.deepEqual(a.invoices.map((i) => [i.description, i.amount_cents, i.paid_cents, i.balance_cents]), [['Monthly portal fee', 4000, 1500, 2500]], 'void and other shops\' invoices are not shown');
  assert.deepEqual(a.payments.map((p) => [p.amount_cents, p.method, p.reference]), [[1500, 'Zaad', 'ZX9']]);
  for (const hidden of ['secret internal note', 'internal payment note', 'internal void reason', 'boss', 'Not yours', 'key_hash']) {
    assert.ok(!r.text.includes(hidden), `must not show "${hidden}"`);
  }
  assert.equal((await request(A.base, 'GET', '/api/licence/account')).status, 401, 'needs the key');
});

test('review fixes: currency locked once invoiced, huge ids are 404, predictable passwords refused', async () => {
  const { id } = await ok(call('POST', '/api/shops', { name: 'Currency Shop', monthly_fee: 10, billing_day: 1, started_on: day(40) }));
  await ok(call('PUT', `/api/shops/${id}`, { currency: 'EUR' }), 'no invoices yet: may change');
  await ok(call('POST', `/api/shops/${id}/invoices`, { description: 'Setup', amount: 5, due_on: day(5) }));
  const r = await call('PUT', `/api/shops/${id}`, { currency: 'USD' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /already has invoices in EUR/);
  assert.equal((await call('PUT', `/api/shops/${id}`, { name: 'Currency Shop 2' })).status, 200, 'other changes still fine');
  assert.equal((await call('GET', '/api/shops/99999999999')).status, 404);
  assert.equal((await call('GET', '/api/invoices/2147483648')).status, 404);
  for (const weak of ['Admin@2026!', 'Password#2026', '2026202620!!', 'Boss@20262026']) {
    assert.equal((await call('POST', '/api/password', { current: 'Copper lantern river 7', password: weak })).status, 400, weak);
  }
});

test('over the internet the first admin needs the setup token', async () => {
  const B = await startAdmin({ TRUST_PROXY: '1', SETUP_TOKEN: 'a-long-random-setup-token-123456' });
  const body = { username: 'remote', password: 'Brass kettle meadow 4' };
  assert.equal((await request(B.base, 'GET', '/api/setup', { headers: { 'X-Forwarded-Proto': 'https' } })).json.local, false);
  assert.equal((await request(B.base, 'POST', '/api/setup', { body, headers: { 'X-Forwarded-Proto': 'https' } })).status, 403);
  assert.equal((await request(B.base, 'POST', '/api/setup', { body: { ...body, setup_token: 'wrong-token-wrong-token-wrong' }, headers: { 'X-Forwarded-Proto': 'https' } })).status, 403);
  const r = await request(B.base, 'POST', '/api/setup', { body: { ...body, setup_token: 'a-long-random-setup-token-123456' }, headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('set-cookie'), /; Secure/);
});
