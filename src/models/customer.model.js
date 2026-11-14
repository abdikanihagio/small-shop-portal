// Customers with credit accounts.
const { db } = require('../config/database');

// Balance = completed credit sales − payments received − returns refunded to the account.
const BALANCE_SQL = `
  COALESCE((SELECT SUM(total_cents) FROM sales WHERE customer_id = c.id AND status = 'completed' AND payment_method = 'credit'), 0)
  - COALESCE((SELECT SUM(amount_cents) FROM customer_payments WHERE customer_id = c.id AND reversed_at IS NULL), 0)
  - COALESCE((SELECT SUM(total_cents) FROM returns WHERE customer_id = c.id AND refund_method = 'credit'), 0)`;

const CustomerModel = {
  balance: (id) => db.prepare(`SELECT ${BALANCE_SQL} AS b FROM customers c WHERE c.id = ?`).get(id).b,

  findWithStats: (id) =>
    db
      .prepare(
        `SELECT c.*, ${BALANCE_SQL} AS balance_cents,
           (SELECT COUNT(*) FROM sales WHERE customer_id = c.id AND status = 'completed') AS sale_count,
           (SELECT COALESCE(SUM(total_cents),0) FROM sales WHERE customer_id = c.id AND status = 'completed') AS total_purchases_cents,
           (SELECT COALESCE(SUM(total_cents),0) FROM sales WHERE customer_id = c.id AND status = 'completed' AND payment_method = 'credit') AS total_credit_cents,
           (SELECT COALESCE(SUM(total_cents),0) FROM returns WHERE customer_id = c.id) AS total_returned_cents,
           (SELECT COALESCE(SUM(amount_cents),0) FROM customer_payments WHERE customer_id = c.id AND reversed_at IS NULL) AS total_paid_cents,
           (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id) AS last_purchase,
           (SELECT MAX(created_at) FROM customer_payments WHERE customer_id = c.id AND reversed_at IS NULL) AS last_payment
         FROM customers c WHERE c.id = ?`
      )
      .get(id),

  list: ({ includeInactive }) =>
    db
      .prepare(
        `SELECT c.*, ${BALANCE_SQL} AS balance_cents,
           (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id) AS last_purchase
         FROM customers c ${includeInactive ? '' : 'WHERE c.active = 1'} ORDER BY c.name COLLATE NOCASE`
      )
      .all(),

  findActiveById: (id) => db.prepare('SELECT * FROM customers WHERE id = ? AND active = 1').get(id),
  phoneTaken: (phone, exceptId = 0) => !!db.prepare('SELECT 1 FROM customers WHERE phone = ? AND id != ?').get(phone, exceptId),

  create: (c) =>
    db
      .prepare('INSERT INTO customers (name, phone, email, address, id_number, credit_limit_cents, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.name, c.phone, c.email, c.address, c.id_number, c.credit_limit_cents, c.notes).lastInsertRowid,

  update(id, c, active) {
    db.prepare('UPDATE customers SET name=?, phone=?, email=?, address=?, id_number=?, credit_limit_cents=?, notes=?, active=? WHERE id=?').run(
      c.name, c.phone, c.email, c.address, c.id_number, c.credit_limit_cents, c.notes, active, id
    );
    // Keep the name shown on past sales in step with the customer record.
    db.prepare('UPDATE sales SET customer = ? WHERE customer_id = ?').run(c.name, id);
  },

  addPayment: ({ customerId, amount, method, note, userId, ref }) =>
    db
      .prepare('INSERT INTO customer_payments (customer_id, amount_cents, method, note, user_id, ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(customerId, amount, method, note, userId, ref).lastInsertRowid,
  findPayment: (id) => db.prepare('SELECT * FROM customer_payments WHERE id = ?').get(id),

  // Total currently owed by all customers (ignores customers who have paid in advance).
  totalReceivables: () =>
    db
      .prepare(`SELECT COALESCE(SUM(MAX(b, 0)), 0) AS total, COALESCE(SUM(b > 0), 0) AS customers FROM (SELECT ${BALANCE_SQL} AS b FROM customers c)`)
      .get(),

  // Raw rows for a statement between two dates.
  statementRows: (id, from, to) => ({
    opening: db
      .prepare(
        `SELECT COALESCE((SELECT SUM(total_cents) FROM sales WHERE customer_id = ? AND status = 'completed' AND payment_method = 'credit' AND date(created_at) < ?), 0)
              - COALESCE((SELECT SUM(amount_cents) FROM customer_payments WHERE customer_id = ? AND reversed_at IS NULL AND date(created_at) < ?), 0)
              - COALESCE((SELECT SUM(total_cents) FROM returns WHERE customer_id = ? AND refund_method = 'credit' AND date(created_at) < ?), 0) AS b`
      )
      .get(id, from, id, from, id, from).b,
    returns: db
      .prepare(
        `SELECT r.*, u.username, (SELECT GROUP_CONCAT(qty || ' × ' || name, ', ') FROM return_items WHERE return_id = r.id) AS items
         FROM returns r LEFT JOIN users u ON u.id = r.user_id
         WHERE r.customer_id = ? AND date(r.created_at) BETWEEN ? AND ?`
      )
      .all(id, from, to),
    sales: db
      .prepare(
        `SELECT s.*, u.username, (SELECT GROUP_CONCAT(qty || ' × ' || name, ', ') FROM sale_items WHERE sale_id = s.id) AS items
         FROM sales s LEFT JOIN users u ON u.id = s.user_id
         WHERE s.customer_id = ? AND date(s.created_at) BETWEEN ? AND ?`
      )
      .all(id, from, to),
    payments: db
      .prepare(
        `SELECT p.*, u.username FROM customer_payments p LEFT JOIN users u ON u.id = p.user_id
         WHERE p.customer_id = ? AND date(p.created_at) BETWEEN ? AND ?`
      )
      .all(id, from, to),
  }),
};

module.exports = CustomerModel;
