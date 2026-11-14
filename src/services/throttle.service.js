// Login throttling. After 5 failures for the same username (or 20 from the same device, which several
// cashiers may share), further attempts are refused for 30 s, doubling with each further failure up to
// 15 minutes. A success clears the count. Kept in memory: a restart clears all locks.
const { HttpError } = require('../utils/http-error');

const failFree = (key) => (key.startsWith('ip:') ? 20 : 5);
const failures = new Map(); // key -> { count, lockedUntil, last }
const DAY = 24 * 3600e3;

function check(keys) {
  const now = Date.now();
  let wait = 0;
  for (const k of keys) {
    const f = failures.get(k);
    if (f && f.lockedUntil > now) wait = Math.max(wait, f.lockedUntil - now);
  }
  if (wait) {
    const secs = Math.ceil(wait / 1000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${secs < 60 ? `${secs} seconds` : `${Math.ceil(secs / 60)} minutes`}.`, {
      'Retry-After': String(secs),
    });
  }
}

function fail(keys) {
  const now = Date.now();
  for (const k of keys) {
    const f = failures.get(k) && now - failures.get(k).last < DAY ? failures.get(k) : { count: 0, lockedUntil: 0 };
    f.count++;
    f.last = now;
    if (f.count >= failFree(k)) f.lockedUntil = now + Math.min(30e3 * 2 ** (f.count - failFree(k)), 15 * 60e3);
    failures.set(k, f);
  }
  if (failures.size > 10000) for (const [k, f] of failures) if (now - f.last > DAY) failures.delete(k);
}

const clear = (keys) => keys.forEach((k) => failures.delete(k));

const loginKeys = (username, ip) => [`u:${String(username).toLowerCase()}`, `ip:${ip}`];

module.exports = { check, fail, clear, loginKeys };
