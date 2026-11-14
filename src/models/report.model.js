// Read-only totals for the profit & loss report, cash flow, dashboard and CSV exports.
const { db } = require('../config/database');

const amount = (sql, ...args) => db.prepare(sql).get(...args).amount;

const ReportModel = {
  salesTotals: (from, to) =>
    db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(subtotal_cents),0) AS gross_sales, COALESCE(SUM(discount_cents),0) AS discounts,
                COALESCE(SUM(tax_cents),0) AS tax, COALESCE(SUM(total_cents),0) AS collected, COALESCE(SUM(cogs_cents),0) AS cogs
         FROM sales WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ?`
      )
      .get(from, to),

  expensesByCategory: (from, to) =>
    db
      .prepare(
        `SELECT category, SUM(amount_cents) AS amount FROM expenses WHERE reversed_at IS NULL AND date BETWEEN ? AND ?
         GROUP BY category ORDER BY amount DESC`
      )
      .all(from, to),

  salesByMethod: (from, to) =>
    db
      .prepare(
        `SELECT payment_method AS method, COUNT(*) AS count, SUM(total_cents) AS amount FROM sales
         WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ? GROUP BY payment_method ORDER BY amount DESC`
      )
      .all(from, to),

  // Stock paid for on delivery (older deliveries without a purchase record count as paid).
  stockPaidOnDelivery: (from, to) =>
    amount(
      `SELECT COALESCE(SUM(m.qty_change * m.unit_cost_cents),0) AS amount FROM stock_movements m
       LEFT JOIN purchases p ON p.id = m.purchase_id
       WHERE m.type = 'purchase' AND (p.id IS NULL OR p.payment_method != 'credit') AND date(m.created_at) BETWEEN ? AND ?`,
      from,
      to
    ),
  creditPurchases: (from, to) =>
    amount(`SELECT COALESCE(SUM(total_cents),0) AS amount FROM purchases WHERE payment_method = 'credit' AND date(created_at) BETWEEN ? AND ?`, from, to),
  supplierPayments: (from, to) =>
    amount('SELECT COALESCE(SUM(amount_cents),0) AS amount FROM supplier_payments WHERE reversed_at IS NULL AND date(created_at) BETWEEN ? AND ?', from, to),
  // Value of stock counted out (positive = lost) by adjustments.
  adjustmentLosses: (from, to) =>
    -amount(
      `SELECT COALESCE(SUM(qty_change * unit_cost_cents),0) AS amount FROM stock_movements
       WHERE type = 'adjustment' AND date(created_at) BETWEEN ? AND ?`,
      from,
      to
    ),
  creditSales: (from, to) =>
    amount(
      `SELECT COALESCE(SUM(total_cents),0) AS amount FROM sales
       WHERE status = 'completed' AND payment_method = 'credit' AND date(created_at) BETWEEN ? AND ?`,
      from,
      to
    ),
  customerPayments: (from, to) =>
    amount('SELECT COALESCE(SUM(amount_cents),0) AS amount FROM customer_payments WHERE reversed_at IS NULL AND date(created_at) BETWEEN ? AND ?', from, to),

  // Returns made in the period: revenue, cost of goods and tax come back out; damaged items are a loss.
  returnTotals: (from, to) =>
    db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(subtotal_cents - discount_cents),0) AS net, COALESCE(SUM(tax_cents),0) AS tax,
                COALESCE(SUM(cogs_cents),0) AS cogs, COALESCE(SUM(written_off_cents),0) AS written_off,
                COALESCE(SUM(CASE WHEN refund_method != 'credit' THEN total_cents END),0) AS refunds_paid,
                COALESCE(SUM(CASE WHEN refund_method = 'credit' THEN total_cents END),0) AS to_accounts
         FROM returns WHERE date(created_at) BETWEEN ? AND ?`
      )
      .get(from, to),

  // Dashboard
  salesOnDay: (day) =>
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_cents),0) AS total FROM sales WHERE status = 'completed' AND date(created_at) = ?`).get(day),
  refundsOnDay: (day) => db.prepare('SELECT COALESCE(SUM(total_cents),0) AS r FROM returns WHERE date(created_at) = ?').get(day).r,
  dailySales30: (day) =>
    db
      .prepare(
        `SELECT date(created_at) AS day, SUM(total_cents) AS total, COUNT(*) AS count FROM sales
         WHERE status = 'completed' AND date(created_at) >= date(?, '-29 days') GROUP BY day ORDER BY day`
      )
      .all(day),
  recentSales: () =>
    db
      .prepare(
        `SELECT s.id, s.created_at, s.customer, s.total_cents, s.status, s.payment_method, u.username
         FROM sales s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 8`
      )
      .all(),
  topProductsSince: (from) =>
    db
      .prepare(
        `SELECT i.name, SUM(i.qty) AS qty, SUM(i.qty * i.price_cents) AS revenue FROM sale_items i JOIN sales s ON s.id = i.sale_id
         WHERE s.status = 'completed' AND date(s.created_at) >= ? GROUP BY i.product_id ORDER BY revenue DESC LIMIT 5`
      )
      .all(from),

  // CSV exports
  salesForExport: (from, to) =>
    db
      .prepare(
        `SELECT s.*, u.username, (SELECT COALESCE(SUM(total_cents),0) FROM returns WHERE sale_id = s.id) AS returned_cents
         FROM sales s LEFT JOIN users u ON u.id = s.user_id
         WHERE date(s.created_at) BETWEEN ? AND ? ORDER BY s.id`
      )
      .all(from, to),
  returnsForExport: (from, to) =>
    db
      .prepare(
        `SELECT r.*, s.customer, u.username, (SELECT GROUP_CONCAT(qty || ' × ' || name || CASE WHEN restocked THEN '' ELSE ' (damaged)' END, ', ') FROM return_items WHERE return_id = r.id) AS items
         FROM returns r JOIN sales s ON s.id = r.sale_id LEFT JOIN users u ON u.id = r.user_id
         WHERE date(r.created_at) BETWEEN ? AND ? ORDER BY r.id`
      )
      .all(from, to),
};

module.exports = ReportModel;
