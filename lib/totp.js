// Time-based one-time passwords (RFC 6238, as used by Google/Microsoft Authenticator and similar)
// and single-use recovery codes. Built-in crypto only.
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('Invalid base32');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 160-bit secret, shown to the user as base32.
const newSecret = () => base32Encode(crypto.randomBytes(20));

// HOTP (RFC 4226) for one counter value.
function hotp(secretBuf, counter, digits = DIGITS) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, '0');
}

const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

// Checks a 6-digit code, allowing one step either side for phone clocks that drift.
// Returns the matching time step (so callers can refuse re-use of the same code), or null.
function verifyTotp(secretB32, code, { now = Date.now(), notAfterStep = -1, window = 1 } = {}) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32);
  const current = stepAt(now);
  for (let d = -window; d <= window; d++) {
    const step = current + d;
    if (step <= notAfterStep) continue;
    const expected = hotp(key, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

// otpauth:// link encoded in the QR code. Kept short enough for a small QR code.
function otpauthUri(secretB32, account, issuer) {
  const clip = (s, n) => String(s).replace(/[:]/g, ' ').trim().slice(0, n);
  let iss = clip(issuer, 20) || 'Shop Portal';
  const acct = clip(account, 20);
  const build = (withIssuerParam) =>
    `otpauth://totp/${encodeURIComponent(iss)}:${encodeURIComponent(acct)}?secret=${secretB32}` +
    (withIssuerParam ? `&issuer=${encodeURIComponent(iss)}` : '');
  let uri = build(true);
  if (Buffer.byteLength(uri) > 106) uri = build(false);
  while (Buffer.byteLength(uri) > 106 && iss.length > 1) {
    iss = iss.slice(0, -1);
    uri = build(false);
  }
  return uri;
}

// Recovery codes: 8 codes like "k7tq-9x2m", each usable once. Only hashes are stored.
function newRecoveryCodes(n = 8) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alike characters
  return Array.from({ length: n }, () => {
    const bytes = crypto.randomBytes(8);
    const s = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

const normaliseRecovery = (code) => String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecovery = (code) => crypto.createHash('sha256').update(normaliseRecovery(code)).digest('hex');

module.exports = { base32Encode, base32Decode, newSecret, hotp, verifyTotp, otpauthUri, newRecoveryCodes, hashRecovery, normaliseRecovery, stepAt };
