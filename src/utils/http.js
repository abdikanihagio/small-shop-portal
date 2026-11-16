// Low-level request/response helpers for node:http.
const { MAX_BODY } = require('../config/constants');
const { HttpError, bad } = require('./http-error');

function readRaw(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `File or request too large (max ${Math.round(limit / 1024 / 1024)} MB)`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readRaw(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw bad('Invalid JSON');
  }
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

// A file the browser saves (PDF, Excel, CSV).
function sendDownload(res, data, contentType, filename) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

// CSV with a byte-order mark so Excel reads accents and symbols correctly.
const sendCsv = (res, csvText, filename) => sendDownload(res, '﻿' + csvText, 'text/csv; charset=utf-8', filename);

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    // Other apps on this computer share localhost cookies; one badly encoded cookie must not break the portal.
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
}

const clientIp = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

// True only for a request made on this computer to a local address (not a look-alike website name).
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1';
const hostName = (req) => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
const isLocalRequest = (req) => isLoopback(clientIp(req)) && LOCAL_HOSTNAMES.has(hostName(req));

module.exports = { readRaw, readJson, sendJson, sendDownload, sendCsv, XLSX_TYPE, parseCookies, clientIp, isLocalRequest };
