// The shop's subscription status, from the Waxool admin portal (BILLING_URL, with this shop's
// licence key BILLING_KEY). Checked at start and every 15 minutes:
//   ok      nothing owed
//   warn    a payment is due: every screen shows a reminder
//   locked  the payment is overdue (or the shop is suspended): the portal is read-only - people can
//           still sign in, look at everything and download backups, but nothing can be changed
// The last answer is remembered (also across restarts). If the admin portal cannot be reached, the
// shop keeps its last known status; a shop that has never been checked works normally.
const { db } = require('../config/database');
const env = require('../config/environment');
const { HttpError } = require('../utils/http-error');

const KEY = 'sys_billing_status';
let current = null;
let lastError = '';

// The licence key is only ever sent over HTTPS (or to this computer, for testing).
function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}
const configured = !!(env.BILLING_URL && env.BILLING_KEY);
if (configured && !safeUrl(env.BILLING_URL)) {
  console.error('BILLING_URL must start with https:// - the subscription check is switched off so the licence key is never sent unencrypted.');
}
const enabled = () => configured && safeUrl(env.BILLING_URL);
// Never follow a redirect: the key must only reach BILLING_URL itself.
const request = (path) =>
  fetch(`${env.BILLING_URL}${path}`, {
    headers: { Authorization: `Bearer ${env.BILLING_KEY}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10e3),
  });

const remember = (data) => {
  current = {
    state: data.state,
    message: String(data.message || '').slice(0, 600),
    amount_due_cents: Number(data.amount_due_cents) || 0,
    currency: String(data.currency || ''),
    lock_on: String(data.lock_on || ''),
    checked_at: new Date().toISOString(),
  };
  return db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', KEY, JSON.stringify(current));
};

async function load() {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', KEY);
  try {
    current = row ? JSON.parse(row.value) : null;
  } catch {
    current = null;
  }
}

const STATES = new Set(['ok', 'warn', 'locked']);

async function check() {
  if (!enabled()) return;
  try {
    const res = await request('/api/licence');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (!STATES.has(data.state)) throw new Error('Unexpected answer');
    lastError = '';
    await remember(data);
  } catch (err) {
    if (err.message !== lastError) console.error(`Subscription check with ${env.BILLING_URL} failed: ${err.message} (keeping the last known status)`);
    lastError = err.message;
  }
}

// The Subscription page (owners and admins): plan, balance, invoices and payments, fetched live
// from the admin portal. Also refreshes the remembered status.
async function account() {
  if (!enabled()) return { enabled: false };
  let res, data;
  try {
    res = await request('/api/licence/account');
    data = await res.json().catch(() => ({}));
  } catch {
    throw new HttpError(502, "Can't reach the billing service right now. Please try again in a few minutes.");
  }
  if (!res.ok || !STATES.has(data.state)) throw new HttpError(502, 'The billing service could not show your account right now. Please try again later.');
  await remember(data);
  return { enabled: true, ...data };
}

// What the screens show. Never includes the licence key.
const status = () => (enabled() && current ? { ...current, enabled: true } : { state: 'ok', enabled: enabled() });
const isLocked = () => enabled() && current?.state === 'locked';

async function startSchedule() {
  if (!enabled()) return;
  await load().catch(() => {});
  await check();
  setInterval(check, env.BILLING_CHECK_MS).unref();
}

module.exports = { status, isLocked, check, startSchedule, enabled, account };
