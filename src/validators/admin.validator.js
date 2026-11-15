// Shop settings, roles, user accounts and expenses.
const { PERMISSION_KEYS } = require('../config/permissions');
const { bad } = require('../utils/http-error');
const { today } = require('../utils/dates');
const { str, dateParam, positiveMoney } = require('./common.validator');

// Only the fields that were sent are changed.
function readSettings(body) {
  const pct = (v, label) => {
    const t = Number(v);
    if (!Number.isFinite(t) || t < 0 || t > 100) throw bad(`${label} must be between 0 and 100`);
    return String(t);
  };
  const out = {};
  if (body.shop_name !== undefined) out.shop_name = str(body.shop_name, 'Shop name', { required: true });
  if (body.currency !== undefined) out.currency = str(body.currency, 'Currency', { required: true, max: 5 }).toUpperCase();
  if (body.tax_rate !== undefined) out.tax_rate = pct(body.tax_rate, 'Tax rate');
  if (body.max_staff_discount !== undefined) out.max_staff_discount = pct(body.max_staff_discount, 'Maximum staff discount');
  // Appearance: "#rrggbb", or empty for the built-in colours.
  const colour = (v, label) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (s && !/^#[0-9a-f]{6}$/.test(s)) throw bad(`${label} must be a colour like #0f766e`);
    return s;
  };
  if (body.primary_color !== undefined) out.primary_color = colour(body.primary_color, 'Accent colour');
  if (body.sidebar_color !== undefined) out.sidebar_color = colour(body.sidebar_color, 'Menu colour');
  return out;
}

function readRoleName(v) {
  const name = str(v, 'Role name', { required: true, max: 40 });
  if (/^admin$/i.test(name)) throw bad('"Admin" is reserved');
  return name;
}

function readPermissions(list) {
  if (!Array.isArray(list)) throw bad('Choose the permissions');
  const keys = [...new Set(list.map(String))];
  const unknown = keys.filter((k) => !PERMISSION_KEYS.has(k));
  if (unknown.length) throw bad(`Unknown permission: ${unknown.join(', ')}`);
  return keys;
}

const readUsername = (v) => str(v, 'Username', { required: true, max: 50 });

function readExpense(body) {
  return {
    date: dateParam(body.date, today()),
    amount: positiveMoney(body.amount),
    category: str(body.category, 'Category', { required: true, max: 50 }),
    description: str(body.description, 'Description'),
    method: str(body.payment_method, 'Payment method', { max: 20 }) || 'cash',
  };
}

module.exports = { readSettings, readRoleName, readPermissions, readUsername, readExpense };
