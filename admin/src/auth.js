// Admin accounts, sign-in sessions and login throttling.
const crypto = require('node:crypto');
const { db, transaction } = require('./db');
const { HttpError } = require('./http');
const config = require('./config');
const v = require('./validate');

const SESSION_MS = 7 * 86400e3;
const IDLE_MS = 12 * 3600e3;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve({ hash: key.toString('hex'), salt })))
  );
}
const DUMMY = (() => {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, password_hash: crypto.scryptSync('x', salt, 64).toString('hex') };
})();
async function passwordMatches(password, row) {
  if (String(password).length > 256) return false;
  const { hash } = await hashPassword(String(password), row.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.password_hash, 'hex'));
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ---- throttle: 5 failures per username / 20 per address, then a doubling wait (max 15 min) ----
const failures = new Map();
function throttleCheck(keys) {
  const now = Date.now();
  const wait = Math.max(0, ...keys.map((k) => (failures.get(k)?.until || 0) - now));
  if (wait > 0) {
    const s = Math.ceil(wait / 1000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${s < 60 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`}.`, { 'Retry-After': String(s) });
  }
}
function throttleFail(keys) {
  const now = Date.now();
  for (const k of keys) {
    const f = failures.get(k) || { count: 0, until: 0 };
    f.count++;
    const free = k.startsWith('ip:') ? 20 : 5;
    if (f.count >= free) f.until = now + Math.min(30e3 * 2 ** (f.count - free), 15 * 60e3);
    failures.set(k, f);
  }
  if (failures.size > 10000) failures.clear();
}
const throttleKeys = (name, ip) => [`u:${String(name).toLowerCase()}`, `ip:${ip}`];

// ---- sessions ----
async function startSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await db.run('INSERT INTO sessions (token_hash, admin_id, expires_at, last_seen) VALUES (?, ?, ?, ?)', sha256(token), adminId, now + SESSION_MS, now);
  await db.run('DELETE FROM sessions WHERE expires_at < ? OR last_seen < ?', now, now - IDLE_MS);
  return token;
}

async function adminForToken(token) {
  if (!token) return null;
  const now = Date.now();
  const row = await db.get(
    `SELECT a.id, a.username, a.name, s.last_seen FROM sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND s.last_seen > ?`,
    sha256(token), now, now - IDLE_MS
  );
  if (!row) return null;
  if (now - row.last_seen > 60e3) await db.run('UPDATE sessions SET last_seen = ? WHERE token_hash = ?', now, sha256(token));
  const { last_seen, ...admin } = row;
  return admin;
}

const endSession = (token) => token && db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));

// ---- setup / login / password ----
const needsSetup = async () => (await db.get('SELECT count(*) AS n FROM admins')).n === 0;

// The first admin may be created from this computer, or over the internet with SETUP_TOKEN.
function setupAllowedBy(isLocal, token) {
  if (isLocal) return true;
  if (config.SETUP_TOKEN.length < 24 || !token) return false;
  const a = Buffer.from(sha256(token)), b = Buffer.from(sha256(config.SETUP_TOKEN));
  return crypto.timingSafeEqual(a, b);
}

async function setup(ip, isLocal, body) {
  if (!(await needsSetup())) throw new HttpError(403, 'Setup is already done. Please sign in.');
  const keys = [`setup:${ip}`];
  throttleCheck(keys);
  if (!setupAllowedBy(isLocal, body.setup_token)) {
    throttleFail(keys);
    throw new HttpError(403, 'The first admin can only be created on the computer running the admin portal, or with the setup token.');
  }
  const username = v.username(body.username);
  const password = v.password(body.password, username);
  const name = v.str(body.name, 'Name', { max: 80 });
  const { hash, salt } = await hashPassword(password);
  return transaction(async () => {
    if (!(await needsSetup())) throw new HttpError(403, 'Setup is already done. Please sign in.');
    const id = await db.insert('INSERT INTO admins (username, name, password_hash, salt) VALUES (?, ?, ?, ?)', username, name, hash, salt);
    await db.run("INSERT INTO activity (who, action, details) VALUES (?, 'admin.created', ?)", username, `from ${ip}`);
    return startSession(id);
  });
}

async function login(ip, username, password) {
  const keys = throttleKeys(username, ip);
  throttleCheck(keys);
  const row = await db.get('SELECT * FROM admins WHERE lower(username) = lower(?)', String(username));
  const ok = await passwordMatches(password, row || DUMMY);
  if (!row || !ok) {
    throttleFail(keys);
    await db.run("INSERT INTO activity (who, action, details) VALUES (?, 'login.failed', ?)", String(username).slice(0, 50), `from ${ip}`);
    throw new HttpError(401, 'Wrong username or password');
  }
  keys.forEach((k) => failures.delete(k));
  await db.run("INSERT INTO activity (who, action, details) VALUES (?, 'login', ?)", row.username, `from ${ip}`);
  return startSession(row.id);
}

async function changePassword(admin, current, next, keepToken) {
  const row = await db.get('SELECT * FROM admins WHERE id = ?', admin.id);
  if (!(await passwordMatches(String(current ?? ''), row))) throw new HttpError(400, 'Your current password is wrong');
  const pw = v.password(next, row.username);
  const { hash, salt } = await hashPassword(pw);
  await db.run('UPDATE admins SET password_hash = ?, salt = ? WHERE id = ?', hash, salt, admin.id);
  // Every other signed-in browser is signed out.
  await db.run('DELETE FROM sessions WHERE admin_id = ? AND token_hash <> ?', admin.id, sha256(keepToken || ''));
  await db.run("INSERT INTO activity (who, action) VALUES (?, 'password.changed')", admin.username);
  return { ok: true };
}

module.exports = { needsSetup, setup, login, changePassword, adminForToken, endSession, sha256, SESSION_MS };
