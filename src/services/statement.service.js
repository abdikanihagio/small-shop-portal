// Account statements: every transaction in a date range with a running balance.
// Shared by customers (what they owe the shop) and suppliers (what the shop owes them).

// entries: [{ kind, id, date, charge_cents, paid_cents, … }] sorted by the caller's order.
function withRunningBalance(opening, entries) {
  let balance = opening;
  for (const e of entries) {
    balance += e.charge_cents - e.paid_cents;
    e.balance_cents = balance;
  }
  return {
    opening_balance: opening,
    closing_balance: balance,
    total_charges: entries.reduce((a, e) => a + e.charge_cents, 0),
    total_paid: entries.reduce((a, e) => a + e.paid_cents, 0),
    entries,
  };
}

// Sorts by date, then by kind (in the given order), then by id.
const byDateThen = (kindOrder) => (a, b) => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
  return a.id - b.id;
};

// A payment row; reversed payments stay listed but no longer count.
const paymentEntry = (p, fallbackDescription) => ({
  kind: 'payment',
  id: p.id,
  date: p.created_at,
  ref: p.ref,
  description: p.note || fallbackDescription,
  method: p.method,
  status: p.reversed_at ? 'reversed' : 'completed',
  reverse_reason: p.reverse_reason || '',
  by: p.username,
  charge_cents: 0,
  paid_cents: p.reversed_at ? 0 : p.amount_cents,
  amount_cents: p.amount_cents,
});

module.exports = { withRunningBalance, byDateThen, paymentEntry };
