// Cash closing: shifts at the till and the cash that moved during them.
const { db } = require('../config/database');
const { NOW } = require('./schema');

const WITH_NAMES = `SELECT s.*, u.username, u.name AS user_name, c.username AS closed_by_username
  FROM cash_shifts s JOIN users u ON u.id = s.user_id LEFT JOIN users c ON c.id = s.closed_by`;

const sum = async (sql, ...params) => (await db.get(sql, ...params)).v;

// Tables whose records can move cash.
const CASH_TABLES = ['sales', 'returns', 'customer_payments', 'supplier_payments', 'purchases', 'expenses'];

const ShiftModel = {
  now: async () => (await db.get(`SELECT ${NOW} AS now`)).now,

  findOpenForUser: (userId) => db.get(`${WITH_NAMES} WHERE s.user_id = ? AND s.status = 'open'`, userId),
  findById: (id) => db.get(`${WITH_NAMES} WHERE s.id = ?`, id),

  // Shifts opened between two dates, plus every shift still open (whenever it was opened); newest first.
  list: ({ from, to, userId = null }) =>
    db.all(
      `${WITH_NAMES} WHERE (left(s.opened_at, 10) BETWEEN ? AND ? OR s.status = 'open') ${userId ? 'AND s.user_id = ?' : ''} ORDER BY s.id DESC LIMIT 500`,
      ...[from, to, ...(userId ? [userId] : [])]
    ),

  // { sales: 41, returns: 3, … }: the newest record of each kind right now. Call inside a transaction.
  async lastIds() {
    const row = await db.get(`SELECT ${CASH_TABLES.map((t) => `(SELECT COALESCE(MAX(id), 0) FROM ${t}) AS ${t}`).join(', ')}`);
    return Object.fromEntries(CASH_TABLES.map((t) => [t, Number(row[t])]));
  },

  open: (userId, floatCents, startIds) =>
    db.insert('INSERT INTO cash_shifts (user_id, opening_float_cents, start_ids) VALUES (?, ?, ?)', userId, floatCents, JSON.stringify(startIds)),

  close: (id, { closedAt, closedBy, endIds, expected, counted, difference, summary, note }) =>
    db.run(
      `UPDATE cash_shifts SET status = 'closed', closed_at = ?, closed_by = ?, end_ids = ?, expected_cents = ?, counted_cents = ?,
         difference_cents = ?, summary = ?, note = ? WHERE id = ? AND status = 'open'`,
      closedAt, closedBy, JSON.stringify(endIds), expected, counted, difference, JSON.stringify(summary), note, id
    ),

  // Everything one user did that moved money, among the records after startIds and up to endIds.
  // Cash sales count when made, even if voided later; the void is cash going back out in the shift
  // it happened in (shiftId), so a void in the same shift cancels out and a later one is counted there.
  async movements(userId, startIds, endIds, shiftId) {
    const range = 'user_id = ? AND id > ? AND id <= ?';
    const ids = (t) => [userId, startIds[t] || 0, endIds[t]];
    const byMethod = await db.all(
      `SELECT payment_method AS method, COUNT(*) AS count, SUM(total_cents) AS amount FROM sales
       WHERE status = 'completed' AND ${range} GROUP BY payment_method ORDER BY amount DESC`,
      ...ids('sales')
    );
    return {
      sales_by_method: byMethod,
      sales_count: byMethod.reduce((a, m) => a + m.count, 0),
      sales_total: byMethod.reduce((a, m) => a + m.amount, 0),
      cash_sales: await sum(`SELECT COALESCE(SUM(total_cents), 0) AS v FROM sales WHERE payment_method = 'cash' AND ${range}`, ...ids('sales')),
      cash_voids: await sum("SELECT COALESCE(SUM(total_cents), 0) AS v FROM sales WHERE payment_method = 'cash' AND status = 'void' AND voided_in_shift = ?", shiftId),
      cash_refunds: await sum(`SELECT COALESCE(SUM(total_cents), 0) AS v FROM returns WHERE refund_method = 'cash' AND ${range}`, ...ids('returns')),
      customer_payments_cash: await sum(`SELECT COALESCE(SUM(amount_cents), 0) AS v FROM customer_payments WHERE method = 'cash' AND reversed_at IS NULL AND ${range}`, ...ids('customer_payments')),
      supplier_payments_cash: await sum(`SELECT COALESCE(SUM(amount_cents), 0) AS v FROM supplier_payments WHERE method = 'cash' AND reversed_at IS NULL AND ${range}`, ...ids('supplier_payments')),
      deliveries_paid_cash: await sum(`SELECT COALESCE(SUM(total_cents), 0) AS v FROM purchases WHERE payment_method = 'cash' AND ${range}`, ...ids('purchases')),
      expenses_cash: await sum(`SELECT COALESCE(SUM(amount_cents), 0) AS v FROM expenses WHERE payment_method = 'cash' AND reversed_at IS NULL AND ${range}`, ...ids('expenses')),
    };
  },
};

module.exports = ShiftModel;
