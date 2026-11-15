// Fixed limits and timings used across the application.

// CUST001, SUPP012, RET120 … (at least three digits).
const formatRef = (prefix, n) => prefix + String(n).padStart(3, '0');

module.exports = Object.freeze({
  formatRef,

  // Sign-in sessions
  SESSION_DAYS: 7,
  IDLE_MS: 12 * 3600e3, // signed out after 12 hours without using the portal
  SEEN_EVERY_MS: 60e3, // refresh "last used" at most once a minute
  LOGIN_TICKET_MS: 5 * 60e3, // time allowed to enter the two-step code after the password
  LOGIN_TICKET_TRIES: 5,

  // Request and input limits
  MAX_BODY: 5 * 1024 * 1024,
  MAX_PASSWORD: 256,
  // Upper limits keep every total far inside the range where whole-cent arithmetic is exact.
  MAX_MONEY: 1_000_000_000, // per amount, in the shop's currency
  MAX_QTY: 1_000_000, // per quantity / stock count

  // Shop settings created on first run. max_staff_discount: highest discount (% of subtotal)
  // a user without the "discount.unlimited" permission may give.
  // primary_color / sidebar_color: the shop's own colours (Settings → Appearance); empty = built-in.
  DEFAULT_SETTINGS: Object.freeze({ shop_name: 'My Shop', currency: 'USD', tax_rate: '0', max_staff_discount: '10', primary_color: '', sidebar_color: '' }),

  // Reference numbers (CUST001, SUPP001, RET001, …). Counters live in settings and only go up.
  PAYMENT_REFS: Object.freeze([
    { table: 'customer_payments', counter: 'seq_customer_payment', prefix: 'CUST' },
    { table: 'supplier_payments', counter: 'seq_supplier_payment', prefix: 'SUPP' },
    { table: 'returns', counter: 'seq_return', prefix: 'RET' },
  ]),

  EXPENSE_CATEGORIES: Object.freeze(['Rent', 'Salaries', 'Utilities', 'Transport', 'Marketing', 'Supplies', 'Repairs', 'Fees & Taxes', 'Other']),
  SALE_PAYMENT_METHODS: Object.freeze(['cash', 'card', 'mobile', 'credit']),
  PURCHASE_PAYMENT_METHODS: Object.freeze(['cash', 'bank', 'mobile', 'card', 'credit']),
});
