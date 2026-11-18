// The request pipeline:
//   security headers → static page (anything outside /api/)
//   → route match → sign-in check → access rule → same-site request guard → body → controller → JSON
//   → central error handler
const { buildRouter } = require('./routes');
const { securityHeaders } = require('./middleware/security-headers');
const { serveStatic } = require('./middleware/static-files');
const { authenticate } = require('./middleware/authenticate');
const { authorize } = require('./middleware/authorize');
const { requestGuard } = require('./middleware/request-guard');
const { handleError } = require('./middleware/error-handler');
const { readRaw, readJson, sendJson, clientIp, visitorHost } = require('./utils/http');
const { TRUST_PROXY } = require('./config/environment');
const billing = require('./services/billing.service');
const { HttpError } = require('./utils/http-error');

const ALLOWED_WHEN_LOCKED = new Set([
  '/api/login', '/api/login/verify', '/api/logout', '/api/setup', '/api/password', '/api/sessions/revoke-others',
  '/api/2fa/setup', '/api/2fa/enable', '/api/2fa/disable', '/api/2fa/recovery-codes', '/api/backups',
]);

function createApp() {
  const router = buildRouter();

  async function handleApi(req, res, url) {
    const { route, params } = router.match(req.method, url.pathname);
    const user = await authenticate(req);
    authorize(route.access, user);
    requestGuard(req, route);
    // Overdue subscription: read-only. Signing in and out, own password / two-step login and making
    // a backup still work, so nobody is locked out of their own data.
    if (req.method !== 'GET' && billing.isLocked() && !ALLOWED_WHEN_LOCKED.has(route.pattern)) {
      throw new HttpError(423, 'This portal is read-only until the monthly payment is received. Nothing can be changed for now; you can still view everything and download backups.');
    }
    const body = !['POST', 'PUT'].includes(req.method) ? {} : route.raw ? await readRaw(req, route.maxBody) : await readJson(req);
    // "actor" is who is acting, for permission checks and the activity log.
    const ip = clientIp(req);
    const actor = user ? { ...user, ip } : { ip };
    const result = await route.handler({ req, res, user, actor, params, query: url.searchParams, body });
    if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
  }

  return async function app(req, res) {
    // Behind a hosting proxy, a visitor who typed http:// is sent to the https:// address.
    if (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'http') {
      res.writeHead(308, { Location: `https://${visitorHost(req)}${req.url}` });
      return res.end();
    }
    securityHeaders(req, res);
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    try {
      await handleApi(req, res, url);
    } catch (err) {
      handleError(err, req, res);
    }
  };
}

module.exports = { createApp };
