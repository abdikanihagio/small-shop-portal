// Running behind a hosting service's HTTPS proxy (TRUST_PROXY=1, e.g. Railway).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, request, sid } from './helpers.mjs';

const OWNER = { username: 'owner', password: 'Copper#Lantern2026' };
const SITE = 'shop.example.com';
let P; // the portal behind the proxy
// What the proxy sends along: the visitor's address appended to X-Forwarded-For, the protocol and the site name.
const viaProxy = (method, p, { ip = '203.0.113.7', spoofed, proto = 'https', ...opts } = {}) =>
  request(P.base, method, p, {
    ...opts,
    headers: { 'X-Forwarded-For': [spoofed, ip].filter(Boolean).join(', '), 'X-Forwarded-Proto': proto, 'X-Forwarded-Host': SITE, ...opts.headers },
  });

before(async () => {
  // Set up the shop the normal way, then run the same database behind the proxy.
  const local = await startServer();
  await request(local.base, 'POST', '/api/setup', { body: { ...OWNER, shop_name: 'Online' } });
  P = await startServer({ database: local.database, env: { TRUST_PROXY: '1' } });
});

test('the sign-in cookie is HTTPS-only, and HSTS is sent', async () => {
  const r = await viaProxy('POST', '/api/login', { body: OWNER, origin: `https://${SITE}` });
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('set-cookie'), /; Secure/);
  assert.match(r.headers.get('strict-transport-security') || '', /max-age=/);
});

test('the activity log records the visitor\'s address, not one the visitor made up', async () => {
  const cookie = sid(await viaProxy('POST', '/api/login', { body: OWNER, ip: '198.51.100.20', spoofed: '127.0.0.1' }));
  await viaProxy('POST', '/api/login', { body: { ...OWNER, password: 'wrong-Password1' }, ip: '198.51.100.99', spoofed: '10.0.0.1' });
  const log = (await viaProxy('GET', '/api/audit', { cookie })).json;
  assert.equal(log.find((r) => r.action === 'login.failed').ip, '198.51.100.99');
  assert.ok(log.some((r) => r.action === 'login.success' && r.ip === '198.51.100.20'));
});

test('http:// is redirected to https://', async () => {
  const r = await viaProxy('GET', '/some/page?x=1', { proto: 'http' });
  assert.equal(r.status, 308);
  assert.equal(r.headers.get('location'), `https://${SITE}/some/page?x=1`);
});

test('requests from another website are still refused', async () => {
  const r = await viaProxy('POST', '/api/login', { body: OWNER, origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('first-time setup is never allowed through the proxy, even claiming to be this computer', async () => {
  const fresh = await startServer({ env: { TRUST_PROXY: '1' } });
  const r = await request(fresh.base, 'POST', '/api/setup', { body: { ...OWNER, shop_name: 'X' }, headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Proto': 'https' } });
  assert.equal(r.status, 403);
  assert.equal((await request(fresh.base, 'GET', '/api/setup', { headers: { 'X-Forwarded-Proto': 'https' } })).json.setupAllowed, false);
});
