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

const KEY = 'sys_billing_status';
let current = null;
let lastError = '';

const enabled = () => !!(env.BILLING_URL && env.BILLING_KEY);

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
    const res = await fetch(`${env.BILLING_URL}/api/licence`, {
      headers: { Authorization: `Bearer ${env.BILLING_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10e3),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (!STATES.has(data.state)) throw new Error('Unexpected answer');
    current = {
      state: data.state,
      message: String(data.message || '').slice(0, 600),
      amount_due_cents: Number(data.amount_due_cents) || 0,
      currency: String(data.currency || ''),
      lock_on: String(data.lock_on || ''),
      checked_at: new Date().toISOString(),
    };
    lastError = '';
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', KEY, JSON.stringify(current));
  } catch (err) {
    if (err.message !== lastError) console.error(`Subscription check with ${env.BILLING_URL} failed: ${err.message} (keeping the last known status)`);
    lastError = err.message;
  }
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

module.exports = { status, isLocked, check, startSchedule, enabled };
