// Building blocks for checking request input. Each returns the cleaned value or throws a 400 error
// with a message the shop staff can understand.
const { MAX_MONEY } = require('../config/constants');
const { bad } = require('../utils/http-error');
const { today, monthStart } = require('../utils/dates');

function str(v, field, { required = false, max = 200 } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw bad(`${field} is required`);
  if (s.length > max) throw bad(`${field} is too long`);
  return s;
}

function int(v, field, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw bad(`${field} must be a whole number${min > -Infinity ? ` ≥ ${min}` : ''}${max < Infinity ? ` and ≤ ${max.toLocaleString('en')}` : ''}`);
  }
  return n;
}

const id = (v, field = 'id') => int(v, field);

// Accepts a money amount in major units (e.g. 12.50) and returns cents.
function money(v, field, { min = 0, max = MAX_MONEY } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw bad(`${field} must be a valid amount`);
  if (n > max) throw bad(`${field} must be at most ${max.toLocaleString('en')}`);
  return Math.round(n * 100);
}

// A money amount that must be above zero (payments, expenses).
function positiveMoney(v, field = 'Amount') {
  const amount = money(v, field);
  if (amount <= 0) throw bad(`${field} must be more than zero`);
  return amount;
}

// Totals are checked too, in case many large lines are combined.
function safeTotal(n, field = 'Total') {
  if (!Number.isSafeInteger(n)) throw bad(`${field} is too large`);
  return n;
}

function dateParam(v, fallback) {
  if (!v) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Dates must be YYYY-MM-DD');
  return v;
}

// ?from=&to= on list and report URLs. Defaults to this month, or to "all time" for statements.
function dateRange(query, { allTime = false } = {}) {
  return {
    from: dateParam(query.get('from'), allTime ? '2000-01-01' : monthStart()),
    to: dateParam(query.get('to'), today()),
  };
}

const reason = (v, { required = true } = {}) => str(v, 'Reason', { required, max: 200 });

module.exports = { str, int, id, money, positiveMoney, safeTotal, dateParam, dateRange, reason };
