// Request / response helpers, errors and the security headers sent with every response.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    if (headers) this.headers = headers;
  }
}
const bad = (m) => new HttpError(400, m);
const notFound = (m = 'Not found') => new HttpError(404, m);

const HTTPS = config.TRUST_PROXY > 0;
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  ...(HTTPS ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch {
        reject(bad('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
}

const socketIp = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

// The visitor's address; behind TRUST_PROXY proxies it is that many places from the end of
// X-Forwarded-For (anything further left was written by the visitor and is ignored).
function clientIp(req) {
  if (!config.TRUST_PROXY) return socketIp(req);
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (hops[hops.length - config.TRUST_PROXY] || socketIp(req)).replace(/^::ffff:/, '');
}

const visitorHost = (req) => String((config.TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host || '').split(',')[0].trim();

// A request made on this computer to a local address. Behind a hosting proxy nothing is local.
const isLocalRequest = (req) =>
  !config.TRUST_PROXY &&
  ['127.0.0.1', '::1'].includes(socketIp(req)) &&
  ['localhost', '127.0.0.1', '[::1]'].includes(String(req.headers.host || '').toLowerCase().replace(/:\d+$/, ''));

// Changes must come from the portal page itself: a custom header, a matching Origin, JSON only.
function requestGuard(req) {
  if (req.method === 'GET') return;
  if (req.headers['x-requested-with'] !== 'waxool-admin') throw new HttpError(403, 'Request blocked: please use the admin portal page.');
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
  if ((hasBody || type) && type !== 'application/json') throw new HttpError(415, 'Expected application/json');
}

const sessionCookie = (token, maxAge) => `wsid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${HTTPS ? '; Secure' : ''}`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function serveStatic(res, pathname) {
  let file = path.normalize(path.join(config.PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(config.PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(config.PUBLIC_DIR, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

module.exports = {
  HttpError, bad, notFound, SECURITY_HEADERS, sendJson, readJson, parseCookies, clientIp, visitorHost,
  isLocalRequest, requestGuard, sessionCookie, serveStatic,
};
