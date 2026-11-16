// Every request that changes something must come from the portal's own page:
// - a custom header, which other websites cannot add without the browser asking us first (we never agree);
// - if the browser says where the request came from (Origin), it must be this portal;
// - JSON routes take JSON, the import route takes a file. Plain HTML forms can send neither.
const { HttpError } = require('../utils/http-error');
const { visitorHost } = require('../utils/http');

function requestGuard(req, { raw }) {
  if (req.method === 'GET') return;
  if (req.headers['x-requested-with'] !== 'shop-portal') throw new HttpError(403, 'Request blocked: please use the portal page.');
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let host;
    try {
      host = new URL(origin).host;
    } catch {}
    if (host !== visitorHost(req)) throw new HttpError(403, 'Request blocked: it came from another website.');
  }
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
  const expected = raw ? 'application/octet-stream' : 'application/json';
  if ((hasBody || type) && type !== expected) throw new HttpError(415, `Expected ${expected}`);
}

module.exports = { requestGuard };
