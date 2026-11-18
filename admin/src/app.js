// Routes of the admin portal. Everything under /api/ except setup, login and the shop licence check
// needs a signed-in admin.
const auth = require('./auth');
const billing = require('./billing');
const config = require('./config');
const v = require('./validate');
const H = require('./http');

const routes = [];
const route = (method, path, access, handler) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '(\\d+)')) + '$');
  routes.push({ method, re, keys, access, handler });
};

const cookieToken = (req) => H.parseCookies(req).wsid || null;

// ---- setup and sign-in ----
route('GET', '/api/setup', 'public', async ({ req }) => ({
  needsSetup: await auth.needsSetup(),
  local: H.isLocalRequest(req),
  tokenSetup: config.SETUP_TOKEN.length >= 24,
}));
route('POST', '/api/setup', 'public', async ({ req, res, ip, body }) => {
  const token = await auth.setup(ip, H.isLocalRequest(req), body);
  res.setHeader('Set-Cookie', H.sessionCookie(token, auth.SESSION_MS / 1000));
  return { ok: true };
});
route('POST', '/api/login', 'public', async ({ res, ip, body }) => {
  const token = await auth.login(ip, v.str(body.username, 'Username', { max: 50 }), String(body.password ?? ''));
  res.setHeader('Set-Cookie', H.sessionCookie(token, auth.SESSION_MS / 1000));
  return { ok: true };
});
route('POST', '/api/logout', 'public', async ({ req, res }) => {
  await auth.endSession(cookieToken(req));
  res.setHeader('Set-Cookie', H.sessionCookie('', 0));
  return { ok: true };
});
route('GET', '/api/me', 'admin', async ({ admin }) => ({ admin, settings: await billing.getSettings(), methods: v.METHODS, today: billing.today() }));
route('POST', '/api/password', 'admin', ({ req, admin, body }) => auth.changePassword(admin, body.current, body.password, cookieToken(req)));

// ---- the licence check each shop portal makes (no cookie; the shop's licence key) ----
route('GET', '/api/licence', 'licence', async ({ req }) => {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
  return billing.licence(m ? m[1] : '');
});

// ---- dashboard, shops, invoices, payments ----
route('GET', '/api/dashboard', 'admin', () => billing.dashboard());
route('GET', '/api/shops', 'admin', () => billing.listShops());
route('POST', '/api/shops', 'admin', ({ admin, body }) => billing.createShop(admin, body));
route('GET', '/api/shops/:id', 'admin', ({ params }) => billing.shopDetail(params.id));
route('PUT', '/api/shops/:id', 'admin', ({ admin, params, body }) => billing.updateShop(admin, params.id, body));
route('POST', '/api/shops/:id/status', 'admin', ({ admin, params, body }) => billing.setStatus(admin, params.id, String(body.status || '')));
route('POST', '/api/shops/:id/key', 'admin', ({ admin, params }) => billing.regenerateKey(admin, params.id));
route('POST', '/api/shops/:id/invoices', 'admin', ({ admin, params, body }) => billing.createInvoice(admin, params.id, body));

route('GET', '/api/invoices', 'admin', ({ query }) => billing.listInvoices(query.get('status')));
route('POST', '/api/invoices/generate', 'admin', ({ admin }) => billing.generateDue(admin.username));
route('GET', '/api/invoices/:id', 'admin', ({ params }) => billing.getInvoice(params.id));
route('POST', '/api/invoices/:id/due', 'admin', ({ admin, params, body }) => billing.changeDueDate(admin, params.id, body));
route('POST', '/api/invoices/:id/void', 'admin', ({ admin, params, body }) => billing.voidInvoice(admin, params.id, body));
route('POST', '/api/invoices/:id/payments', 'admin', ({ admin, params, body }) => billing.recordPayment(admin, params.id, body));

route('GET', '/api/payments', 'admin', () => billing.listPayments());
route('POST', '/api/payments/:id/reverse', 'admin', ({ admin, params, body }) => billing.reversePayment(admin, params.id, body));

route('GET', '/api/activity', 'admin', () => billing.listActivity());
route('GET', '/api/settings', 'admin', () => billing.getSettings());
route('PUT', '/api/settings', 'admin', ({ admin, body }) => billing.saveSettings(admin, body));

// Licence checks are cheap but public: at most 120 a minute from one address.
const licenceHits = new Map();
function licenceRate(ip) {
  const now = Date.now();
  const h = licenceHits.get(ip);
  if (!h || now - h.start > 60e3) return licenceHits.set(ip, { start: now, n: 1 });
  if (++h.n > 120) throw new H.HttpError(429, 'Too many requests', { 'Retry-After': '60' });
  if (licenceHits.size > 5000) licenceHits.clear();
}

function createApp() {
  return async function app(req, res) {
    // Behind a hosting proxy, a visitor who typed http:// is sent to https://.
    if (config.TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'http') {
      res.writeHead(308, { Location: `https://${H.visitorHost(req)}${req.url}` });
      return res.end();
    }
    for (const [k, val] of Object.entries(H.SECURITY_HEADERS)) res.setHeader(k, val);
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return H.serveStatic(res, url.pathname);
    try {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw H.notFound();
      const m = url.pathname.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])]));
      const ip = H.clientIp(req);
      let admin = null;
      if (r.access === 'licence') licenceRate(ip);
      else {
        admin = await auth.adminForToken(cookieToken(req));
        if (r.access === 'admin' && !admin) throw new H.HttpError(401, 'Please sign in');
        H.requestGuard(req);
      }
      const body = ['POST', 'PUT'].includes(req.method) && r.access !== 'licence' ? await H.readJson(req) : {};
      const result = await r.handler({ req, res, ip, admin, params, query: url.searchParams, body });
      if (!res.headersSent) H.sendJson(res, 200, result ?? { ok: true });
    } catch (err) {
      if (!(err instanceof H.HttpError) && err.code === '23505') err = H.bad('This already exists');
      if (!(err instanceof H.HttpError)) console.error(err);
      if (!res.headersSent) H.sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong' }, err.headers);
    }
  };
}

module.exports = { createApp };
