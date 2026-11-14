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
const { readRaw, readJson, sendJson, clientIp } = require('./utils/http');

function createApp() {
  const router = buildRouter();

  async function handleApi(req, res, url) {
    const { route, params } = router.match(req.method, url.pathname);
    const user = authenticate(req);
    authorize(route.access, user);
    requestGuard(req, route);
    const body = !['POST', 'PUT'].includes(req.method) ? {} : route.raw ? await readRaw(req) : await readJson(req);
    // "actor" is who is acting, for permission checks and the activity log.
    const ip = clientIp(req);
    const actor = user ? { ...user, ip } : { ip };
    const result = await route.handler({ req, res, user, actor, params, query: url.searchParams, body });
    if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
  }

  return async function app(req, res) {
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
