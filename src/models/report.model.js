// Read-only totals for the profit & loss report, cash flow, dashboard and CSV exports.
// Dates are compared on the "YYYY-MM-DD" part of the stored local time.
const { db } = require('../config/database');

const amount = async (sql, ...args) => (await db.get(sql, ...args)).amount;

const ReportModel = {
  salesTotals: (from, to) =>
    db.get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(subtotal_cents), 0) AS gross_sales, COALESCE(SUM(discount_cents), 0) AS discounts,
              COALESCE(SUM(tax_cents), 0) AS tax, COALESCE(SUM(total_cents), 0) AS collected, COALESCE(SUM(cogs_cents), 0) AS cogs
       FROM sales WHERE status = 'completed' AND left(created_at, 10) BETWEEN ? AND ?`,
      from, to
    ),

  expensesByCategory: (from, to) =>
    db.all(
      `SELECT category, SUM(amount_cents) AS amount FROM expenses WHERE reversed_at IS NULL AND date BETWEEN ? AND ?
       GROUP BY category ORDER BY amount DESC, category`,
      from, to
    ),

  salesByMethod: (from, to) =>
    db.all(
      `SELECT payment_method AS method, COUNT(*) AS count, SUM(total_cents) AS amount FROM sales
       WHERE status = 'completed' AND left(created_at, 10) BETWEEN ? AND ? GROUP BY payment_method ORDER BY amount DESC, method`,
      from, to
    ),

  // Stock paid for on delivery (older deliveries without a purchase record count as paid).
  stockPaidOnDelivery: (from, to) =>
    amount(
      `SELECT COALESCE(SUM(m.qty_change * m.unit_cost_cents), 0) AS amount FROM stock_movements m
       LEFT JOIN purchases p ON p.id = m.purchase_id
       WHERE m.type = 'purchase' AND (p.id IS NULL OR p.payment_method != 'credit') AND left(m.created_at, 10) BETWEEN ? AND ?`,
      from, to
    ),
  creditPurchases: (from, to) =>
    amount(`SELECT COALESCE(SUM(total_cents), 0) AS amount FROM purchases WHERE payment_method = 'credit' AND left(created_at, 10) BETWEEN ? AND ?`, from, to),
  supplierPayments: (from, to) =>
    amount('SELECT COALESCE(SUM(amount_cents), 0) AS amount FROM supplier_payments WHERE reversed_at IS NULL AND left(created_at, 10) BETWEEN ? AND ?', from, to),
  // Value of stock counted out (positive = lost) by adjustments.
  adjustmentLosses: async (from, to) =>
    -(await amount(
      `SELECT COALESCE(SUM(qty_change * unit_cost_cents), 0) AS amount FROM stock_movements
       WHERE type = 'adjustment' AND left(created_at, 10) BETWEEN ? AND ?`,
      from, to
    )),
  creditSales: (from, to) =>
    amount(
      `SELECT COALESCE(SUM(total_cents), 0) AS amount FROM sales
       WHERE status = 'completed' AND payment_method = 'credit' AND left(created_at, 10) BETWEEN ? AND ?`,
      from, to
    ),
  customerPayments: (from, to) =>
    amount('SELECT COALESCE(SUM(amount_cents), 0) AS amount FROM customer_payments WHERE reversed_at IS NULL AND left(created_at, 10) BETWEEN ? AND ?', from, to),

  // Returns made in the period: revenue, cost of goods and tax come back out; damaged items are a loss.
  returnTotals: (from, to) =>
    db.get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(subtotal_cents - discount_cents), 0) AS net, COALESCE(SUM(tax_cents), 0) AS tax,
              COALESCE(SUM(cogs_cents), 0) AS cogs, COALESCE(SUM(written_off_cents), 0) AS written_off,
              COALESCE(SUM(CASE WHEN refund_method != 'credit' THEN total_cents END), 0) AS refunds_paid,
              COALESCE(SUM(CASE WHEN refund_method = 'credit' THEN total_cents END), 0) AS to_accounts
       FROM returns WHERE left(created_at, 10) BETWEEN ? AND ?`,
      from, to
    ),

  // Dashboard
  salesOnDay: (day) =>
    db.get(`SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total FROM sales WHERE status = 'completed' AND left(created_at, 10) = ?`, day),
  refundsOnDay: async (day) => (await db.get('SELECT COALESCE(SUM(total_cents), 0) AS r FROM returns WHERE left(created_at, 10) = ?', day)).r,
  dailySales30: (day) =>
    db.all(
      `SELECT left(created_at, 10) AS day, SUM(total_cents) AS total, COUNT(*) AS count FROM sales
       WHERE status = 'completed' AND left(created_at, 10) >= to_char(?::date - 29, 'YYYY-MM-DD') GROUP BY day ORDER BY day`,
      day
    ),
  recentSales: () =>
    db.all(
      `SELECT s.id, s.created_at, s.customer, s.total_cents, s.status, s.payment_method, u.username
       FROM sales s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 8`
    ),
  topProductsSince: (from) =>
    db.all(
      `SELECT MAX(i.name) AS name, SUM(i.qty) AS qty, SUM(i.qty * i.price_cents) AS revenue FROM sale_items i JOIN sales s ON s.id = i.sale_id
       WHERE s.status = 'completed' AND left(s.created_at, 10) >= ? GROUP BY i.product_id ORDER BY revenue DESC, i.product_id LIMIT 5`,
      from
    ),

  // CSV exports
  salesForExport: (from, to) =>
    db.all(
      `SELECT s.*, u.username, (SELECT COALESCE(SUM(total_cents), 0) FROM returns WHERE sale_id = s.id) AS returned_cents
       FROM sales s LEFT JOIN users u ON u.id = s.user_id
       WHERE left(s.created_at, 10) BETWEEN ? AND ? ORDER BY s.id`,
      from, to
    ),
  returnsForExport: (from, to) =>
    db.all(
      `SELECT r.*, s.customer, u.username,
         (SELECT string_agg(qty || ' × ' || name || CASE WHEN restocked = 1 THEN '' ELSE ' (damaged)' END, ', ' ORDER BY id) FROM return_items WHERE return_id = r.id) AS items
       FROM returns r JOIN sales s ON s.id = r.sale_id LEFT JOIN users u ON u.id = r.user_id
       WHERE left(r.created_at, 10) BETWEEN ? AND ? ORDER BY r.id`,
      from, to
    ),
};

module.exports = ReportModel;
