// Client shops, their monthly invoices and payments, and the licence status each shop portal checks.
//
// A shop's portal state:
//   ok      nothing owed
//   warn    an invoice is open: the shop sees a reminder (from the day it is issued)
//   locked  an invoice is still unpaid more than grace_days after its due date, or the shop is
//           suspended / cancelled: the shop portal becomes read-only (its data is never touched)
const crypto = require('node:crypto');
const { db, transaction } = require('./db');
const { bad, notFound, HttpError } = require('./http');
const v = require('./validate');
const { sha256 } = require('./auth');

// ---- dates (YYYY-MM-DD in the admin's time zone) ----
const pad = (n) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const monthName = (period) => new Date(`${period}-01T00:00:00Z`).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const fmt = (cents, currency) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
};

const log = (who, action, shopId, details = '') =>
  db.run('INSERT INTO activity (who, action, shop_id, details) VALUES (?, ?, ?, ?)', who, action, shopId ?? null, details);

// ---- settings ----
const SETTINGS = { business_name: 'Waxool', payment_instructions: '' };
async function getSettings() {
  const rows = await db.all('SELECT key, value FROM settings');
  return { ...SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}
async function saveSettings(admin, body) {
  const next = {
    business_name: v.str(body.business_name, 'Business name', { required: true, max: 80 }),
    payment_instructions: v.str(body.payment_instructions, 'Payment instructions', { max: 500 }),
  };
  for (const [k, val] of Object.entries(next)) {
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', k, val);
  }
  await log(admin.username, 'settings.updated', null);
  return getSettings();
}

// ---- invoices with what has been paid on them ----
const INVOICE_SELECT = `
  SELECT i.*, s.name AS shop_name, s.currency,
         COALESCE((SELECT sum(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id AND p.reversed_at IS NULL), 0) AS paid_cents
  FROM invoices i JOIN shops s ON s.id = i.shop_id`;
const withBalance = (i) => ({ ...i, balance_cents: i.status === 'void' ? 0 : Math.max(0, i.amount_cents - i.paid_cents) });

// What the shop portal should do now, from the shop and its open invoices.
function portalState(shop, openInvoices, settings, on = today()) {
  const contact = settings.business_name;
  const howToPay = settings.payment_instructions ? ` ${settings.payment_instructions}` : '';
  if (shop.status !== 'active') {
    return {
      state: 'locked',
      reason: shop.status,
      message: `This portal has been ${shop.status === 'cancelled' ? 'cancelled' : 'suspended'}. It is read-only; please contact ${contact}.`,
    };
  }
  const owed = openInvoices.filter((i) => i.balance_cents > 0).sort((a, b) => a.due_on.localeCompare(b.due_on));
  if (!owed.length) return { state: 'ok', message: '' };
  const total = owed.reduce((s, i) => s + i.balance_cents, 0);
  const first = owed[0];
  const lockOn = addDays(first.due_on, shop.grace_days + 1); // first read-only day
  const base = { amount_due_cents: total, currency: shop.currency, due_on: first.due_on, lock_on: lockOn, invoices: owed.map((i) => i.number) };
  if (on >= lockOn) {
    return {
      ...base,
      state: 'locked',
      reason: 'overdue',
      message: `This portal is read-only because ${fmt(total, shop.currency)} is overdue (${first.description}).${howToPay} It unlocks shortly after the payment is recorded.`,
    };
  }
  return {
    ...base,
    state: 'warn',
    message: `${fmt(total, shop.currency)} is due for ${first.description}. Please pay before ${lockOn} to keep the portal working.${howToPay}`,
  };
}

async function openInvoicesByShop() {
  const rows = (await db.all(`${INVOICE_SELECT} WHERE i.status = 'open'`)).map(withBalance);
  const map = new Map();
  for (const i of rows) map.set(i.shop_id, [...(map.get(i.shop_id) || []), i]);
  return map;
}

// ---- shops ----
function readShop(body, existing = {}) {
  const pick = (k) => (body[k] === undefined ? existing[k] : body[k]);
  return {
    name: v.str(pick('name'), 'Shop name', { required: true, max: 100 }),
    contact_name: v.str(pick('contact_name'), 'Contact name', { max: 100 }),
    phone: v.str(pick('phone'), 'Phone', { max: 40 }),
    email: v.email(pick('email')),
    portal_url: v.url(pick('portal_url')),
    monthly_fee_cents: body.monthly_fee !== undefined ? v.amount(body.monthly_fee, 'Monthly fee') : existing.monthly_fee_cents ?? v.amount(undefined, 'Monthly fee'),
    currency: v.currency(pick('currency')),
    billing_day: v.int(pick('billing_day') ?? 1, 'Billing day', { min: 1, max: 28 }),
    grace_days: v.int(pick('grace_days') ?? 7, 'Grace days', { min: 0, max: 60 }),
    started_on: v.date(pick('started_on') || today(), 'Start date'),
    notes: v.str(pick('notes'), 'Notes', { max: 1000 }),
  };
}

const newKey = () => {
  const key = `wx_${crypto.randomBytes(24).toString('base64url')}`;
  return { key, key_hash: sha256(key), key_hint: key.slice(-4) };
};

async function createShop(admin, body) {
  const s = readShop(body);
  const { key, key_hash, key_hint } = newKey();
  const id = await db.insert(
    `INSERT INTO shops (name, contact_name, phone, email, portal_url, monthly_fee_cents, currency, billing_day, grace_days, started_on, notes, key_hash, key_hint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.name, s.contact_name, s.phone, s.email, s.portal_url, s.monthly_fee_cents, s.currency, s.billing_day, s.grace_days, s.started_on, s.notes, key_hash, key_hint
  );
  await log(admin.username, 'shop.created', id, `${s.name}, ${fmt(s.monthly_fee_cents, s.currency)}/month`);
  await generateDue(admin.username);
  return { id, licence_key: key };
}

async function findShop(id) {
  const shop = await db.get('SELECT * FROM shops WHERE id = ?', id);
  if (!shop) throw notFound('Shop not found');
  return shop;
}

async function updateShop(admin, id, body) {
  const old = await findShop(id);
  const s = readShop(body, old);
  await db.run(
    `UPDATE shops SET name = ?, contact_name = ?, phone = ?, email = ?, portal_url = ?, monthly_fee_cents = ?, currency = ?,
       billing_day = ?, grace_days = ?, started_on = ?, notes = ? WHERE id = ?`,
    s.name, s.contact_name, s.phone, s.email, s.portal_url, s.monthly_fee_cents, s.currency, s.billing_day, s.grace_days, s.started_on, s.notes, id
  );
  await log(admin.username, 'shop.updated', id, s.name);
  return shopDetail(id);
}

async function setStatus(admin, id, status) {
  if (!['active', 'suspended', 'cancelled'].includes(status)) throw bad('Unknown status');
  const shop = await findShop(id);
  await db.run('UPDATE shops SET status = ? WHERE id = ?', status, id);
  await log(admin.username, `shop.${status}`, id, shop.name);
  if (status === 'active') await generateDue(admin.username);
  return shopDetail(id);
}

async function regenerateKey(admin, id) {
  const shop = await findShop(id);
  const { key, key_hash, key_hint } = newKey();
  await db.run('UPDATE shops SET key_hash = ?, key_hint = ? WHERE id = ?', key_hash, key_hint, id);
  await log(admin.username, 'shop.key_replaced', id, shop.name);
  return { licence_key: key };
}

async function listShops() {
  const [shops, open, settings] = await Promise.all([db.all('SELECT * FROM shops ORDER BY lower(name)'), openInvoicesByShop(), getSettings()]);
  return shops.map(({ key_hash, ...s }) => {
    const inv = open.get(s.id) || [];
    return { ...s, balance_cents: inv.reduce((t, i) => t + i.balance_cents, 0), portal: portalState(s, inv, settings) };
  });
}

async function shopDetail(id) {
  const { key_hash, ...shop } = await findShop(id);
  const invoices = (await db.all(`${INVOICE_SELECT} WHERE i.shop_id = ? ORDER BY i.issued_on DESC, i.id DESC`, id)).map(withBalance);
  const payments = await db.all(
    `SELECT p.*, i.number AS invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.shop_id = ? ORDER BY p.paid_on DESC, p.id DESC`,
    id
  );
  const activity = await db.all('SELECT * FROM activity WHERE shop_id = ? ORDER BY id DESC LIMIT 50', id);
  const open = invoices.filter((i) => i.status === 'open');
  return {
    shop: { ...shop, balance_cents: open.reduce((t, i) => t + i.balance_cents, 0), portal: portalState(shop, open, await getSettings()) },
    invoices,
    payments,
    activity,
  };
}

// ---- invoices ----
async function nextNumber(issuedOn) {
  const year = issuedOn.slice(0, 4);
  const { n } = await db.get("SELECT count(*) AS n FROM invoices WHERE number LIKE ?", `INV-${year}-%`);
  return `INV-${year}-${String(n + 1).padStart(4, '0')}`;
}

// Issues this month's invoice for every active shop whose billing day has come (once per month).
// Months before a shop started, or while it was suspended, are not billed afterwards.
function generateDue(who = 'schedule', on = today()) {
  return transaction(async () => {
    const period = on.slice(0, 7);
    const shops = await db.all("SELECT * FROM shops WHERE status = 'active'");
    const made = [];
    for (const s of shops) {
      const billOn = `${period}-${pad(s.billing_day)}`;
      if (on < billOn || s.started_on > billOn) continue;
      const exists = await db.get("SELECT 1 FROM invoices WHERE shop_id = ? AND period = ? AND monthly AND status <> 'void'", s.id, period);
      if (exists) continue;
      const number = await nextNumber(billOn);
      const id = await db.insert(
        `INSERT INTO invoices (shop_id, number, period, description, amount_cents, issued_on, due_on, monthly)
         VALUES (?, ?, ?, ?, ?, ?, ?, true)`,
        s.id, number, period, `Monthly portal fee, ${monthName(period)}`, s.monthly_fee_cents, billOn, billOn
      );
      await log(who, 'invoice.issued', s.id, `${number} ${fmt(s.monthly_fee_cents, s.currency)}`);
      made.push(id);
    }
    return { created: made.length };
  });
}

async function createInvoice(admin, shopId, body) {
  const shop = await findShop(shopId);
  const issued = v.date(body.issued_on || today(), 'Issue date');
  const due = v.date(body.due_on || issued, 'Due date');
  if (due < issued) throw bad('The due date cannot be before the issue date');
  const description = v.str(body.description, 'Description', { required: true, max: 200 });
  const amount = v.amount(body.amount);
  return transaction(async () => {
    const number = await nextNumber(issued);
    const id = await db.insert(
      'INSERT INTO invoices (shop_id, number, period, description, amount_cents, issued_on, due_on) VALUES (?, ?, ?, ?, ?, ?, ?)',
      shopId, number, issued.slice(0, 7), description, amount, issued, due
    );
    await log(admin.username, 'invoice.issued', shopId, `${number} ${fmt(amount, shop.currency)} ${description}`);
    return getInvoice(id);
  });
}

async function getInvoice(id) {
  const inv = await db.get(`${INVOICE_SELECT} WHERE i.id = ?`, id);
  if (!inv) throw notFound('Invoice not found');
  const payments = await db.all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on, id', id);
  return { ...withBalance(inv), payments };
}

async function listInvoices(status) {
  const where = ['open', 'paid', 'void'].includes(status) ? `WHERE i.status = '${status}'` : '';
  return (await db.all(`${INVOICE_SELECT} ${where} ORDER BY i.issued_on DESC, i.id DESC LIMIT 500`)).map(withBalance);
}

async function changeDueDate(admin, id, body) {
  const inv = await getInvoice(id);
  if (inv.status !== 'open') throw bad('Only open invoices can get a new due date');
  const due = v.date(body.due_on, 'Due date');
  if (due < inv.issued_on) throw bad('The due date cannot be before the issue date');
  await db.run('UPDATE invoices SET due_on = ? WHERE id = ?', due, id);
  await log(admin.username, 'invoice.due_changed', inv.shop_id, `${inv.number}: ${inv.due_on} -> ${due}`);
  return getInvoice(id);
}

async function voidInvoice(admin, id, body) {
  const reason = v.str(body.reason, 'Reason', { required: true, max: 200 });
  return transaction(async () => {
    const inv = await getInvoice(id);
    if (inv.status === 'void') throw bad('This invoice is already void');
    if (inv.paid_cents > 0) throw bad('Reverse its payments first; an invoice with payments cannot be voided');
    await db.run("UPDATE invoices SET status = 'void', void_reason = ? WHERE id = ?", reason, id);
    await log(admin.username, 'invoice.voided', inv.shop_id, `${inv.number}: ${reason}`);
    return getInvoice(id);
  });
}

// ---- payments ----
async function settle(invoiceId) {
  const inv = await getInvoice(invoiceId);
  if (inv.status === 'void') return;
  const status = inv.paid_cents >= inv.amount_cents ? 'paid' : 'open';
  if (status !== inv.status) await db.run('UPDATE invoices SET status = ? WHERE id = ?', status, invoiceId);
}

async function recordPayment(admin, invoiceId, body) {
  const amount = v.amount(body.amount);
  const method = v.method(body.method);
  const reference = v.str(body.reference, 'Reference', { max: 100 });
  const paidOn = v.date(body.paid_on || today(), 'Payment date');
  if (paidOn > today()) throw bad('The payment date cannot be in the future');
  const note = v.str(body.note, 'Note', { max: 300 });
  return transaction(async () => {
    const inv = await getInvoice(invoiceId);
    if (inv.status !== 'open') throw bad(inv.status === 'paid' ? 'This invoice is already paid' : 'This invoice is void');
    if (amount > inv.balance_cents) throw bad(`That is more than is owed on this invoice (${fmt(inv.balance_cents, inv.currency)})`);
    await db.insert(
      'INSERT INTO payments (invoice_id, shop_id, amount_cents, method, reference, paid_on, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      invoiceId, inv.shop_id, amount, method, reference, paidOn, note, admin.username
    );
    await settle(invoiceId);
    await log(admin.username, 'payment.recorded', inv.shop_id, `${fmt(amount, inv.currency)} by ${method}${reference ? ` (${reference})` : ''} for ${inv.number}`);
    return getInvoice(invoiceId);
  });
}

async function reversePayment(admin, paymentId, body) {
  const reason = v.str(body.reason, 'Reason', { required: true, max: 200 });
  return transaction(async () => {
    const p = await db.get('SELECT p.*, s.currency FROM payments p JOIN shops s ON s.id = p.shop_id WHERE p.id = ?', paymentId);
    if (!p) throw notFound('Payment not found');
    if (p.reversed_at) throw bad('This payment is already reversed');
    await db.run('UPDATE payments SET reversed_at = now(), reversed_reason = ? WHERE id = ?', reason, paymentId);
    await settle(p.invoice_id);
    await log(admin.username, 'payment.reversed', p.shop_id, `${fmt(p.amount_cents, p.currency)} (${p.method}): ${reason}`);
    return getInvoice(p.invoice_id);
  });
}

const listPayments = () =>
  db.all(
    `SELECT p.*, i.number AS invoice_number, s.name AS shop_name, s.currency
     FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN shops s ON s.id = p.shop_id
     ORDER BY p.paid_on DESC, p.id DESC LIMIT 500`
  );

// ---- dashboard ----
async function dashboard() {
  const shops = await listShops();
  const month = today().slice(0, 7);
  const sumBy = (rows, f) => {
    const out = {};
    for (const r of rows) out[r.currency] = (out[r.currency] || 0) + f(r);
    return Object.entries(out).map(([currency, cents]) => ({ currency, cents })).filter((x) => x.cents);
  };
  const active = shops.filter((s) => s.status === 'active');
  const paidThisMonth = await db.all(
    `SELECT s.currency, sum(p.amount_cents) AS cents FROM payments p JOIN shops s ON s.id = p.shop_id
     WHERE p.reversed_at IS NULL AND p.paid_on LIKE ? GROUP BY s.currency`,
    `${month}-%`
  );
  return {
    shops: shops.length,
    active: active.length,
    monthly: sumBy(active, (s) => s.monthly_fee_cents),
    outstanding: sumBy(shops, (s) => s.balance_cents),
    paid_this_month: paidThisMonth.filter((r) => r.cents),
    warn: shops.filter((s) => s.portal.state === 'warn').length,
    locked: shops.filter((s) => s.portal.state === 'locked').length,
    needs_attention: shops.filter((s) => s.portal.state !== 'ok'),
    recent_payments: (await listPayments()).slice(0, 8),
  };
}

const listActivity = () =>
  db.all('SELECT a.*, s.name AS shop_name FROM activity a LEFT JOIN shops s ON s.id = a.shop_id ORDER BY a.id DESC LIMIT 300');

// ---- the licence check made by each shop portal (Authorization: Bearer <licence key>) ----
async function licence(key) {
  if (!/^wx_[A-Za-z0-9_-]{20,}$/.test(String(key))) throw new HttpError(401, 'Invalid licence key');
  const shop = await db.get('SELECT * FROM shops WHERE key_hash = ?', sha256(key));
  if (!shop) throw new HttpError(401, 'Invalid licence key');
  await db.run("UPDATE shops SET last_seen_at = now() WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')", shop.id);
  const open = (await db.all(`${INVOICE_SELECT} WHERE i.shop_id = ? AND i.status = 'open'`, shop.id)).map(withBalance);
  const p = portalState(shop, open, await getSettings());
  return { shop: shop.name, checked_at: new Date().toISOString(), ...p };
}

module.exports = {
  today, addDays, portalState, getSettings, saveSettings,
  createShop, updateShop, setStatus, regenerateKey, listShops, shopDetail,
  generateDue, createInvoice, getInvoice, listInvoices, changeDueDate, voidInvoice,
  recordPayment, reversePayment, listPayments, dashboard, listActivity, licence,
};
