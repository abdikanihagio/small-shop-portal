// Input checks. Each returns the cleaned value or throws a 400 with a plain message.
const { bad } = require('./http');

const MAX_MONEY = 1e9; // in major units

function str(v, field, { required = false, max = 200 } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw bad(`${field} is required`);
  if (s.length > max) throw bad(`${field} is too long`);
  return s;
}

function int(v, field, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw bad(`${field} must be a whole number between ${min} and ${max}`);
  return n;
}

// Major units (12.50) -> cents; must be above zero.
function amount(v, field = 'Amount') {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw bad(`${field} must be more than zero`);
  if (n > MAX_MONEY) throw bad(`${field} is too large`);
  return Math.round(n * 100);
}

function date(v, field = 'Date') {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw bad(`${field} must be a date (YYYY-MM-DD)`);
  return s;
}

function currency(v) {
  const s = String(v || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) throw bad('Currency must be a 3-letter code such as USD');
  return s;
}

function url(v) {
  const s = str(v, 'Portal address', { max: 200 });
  if (!s) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(s)) throw bad('Portal address must start with https://');
  return s;
}

function email(v) {
  const s = str(v, 'Email', { max: 120 });
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('Email address is not valid');
  return s;
}

const METHODS = ['EVC Plus', 'Zaad', 'eDahab', 'Sahal', 'Bank transfer', 'Cash', 'Other'];
function method(v) {
  const s = str(v, 'Payment method', { required: true, max: 40 });
  if (!METHODS.includes(s)) throw bad('Choose a payment method from the list');
  return s;
}

function password(pw, username = '') {
  pw = String(pw ?? '');
  if (pw.length < 10) throw bad('Password must be at least 10 characters');
  if (pw.length > 256) throw bad('Password is too long');
  if (/^(.)\1+$/.test(pw) || (username.length >= 3 && pw.toLowerCase().includes(username.toLowerCase())) || /^(password|1234567890|qwertyuiop)/i.test(pw)) {
    throw bad('This password is too easy to guess. Try a longer phrase, for example three unrelated words.');
  }
  return pw;
}

function username(v) {
  const s = str(v, 'Username', { required: true, max: 50 });
  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(s)) throw bad('Username: 3-50 letters, digits, dots, dashes or underscores');
  return s;
}

module.exports = { str, int, amount, date, currency, url, email, method, METHODS, password, username };
