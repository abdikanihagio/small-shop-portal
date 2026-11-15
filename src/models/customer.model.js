// Customers with credit accounts.
const { db } = require('../config/database');

// Balance = completed credit sales − payments received − returns refunded to the account.
const BALANCE_SQL = `
  COALESCE((SELECT SUM(total_cents) FROM sales WHERE customer_id = c.id AND status = 'completed' AND payment_method = 'credit'), 0)
  - COALESCE((SELECT SUM(amount_cents) FROM customer_payments WHERE customer_id = c.id AND reversed_at IS NULL), 0)
  - COALESCE((SELECT SUM(total_cents) FROM returns WHERE customer_id = c.id AND refund_method = 'credit'), 0)`;

const CustomerModel = {
  balance: async (id) => (await db.get(`SELECT ${BALANCE_SQL} AS b FROM customers c WHERE c.id = ?`, id)).b,

  findWithStats: (id) =>
    db.get(
      `SELECT c.*, ${BALANCE_SQL} AS balance_cents,
         (SELECT COUNT(*) FROM sales WHERE customer_id = c.id AND status = 'completed') AS sale_count,
         (SELECT COALESCE(SUM(total_cents), 0) FROM sales WHERE customer_id = c.id AND status = 'completed') AS total_purchases_cents,
         (SELECT COALESCE(SUM(total_cents), 0) FROM sales WHERE customer_id = c.id AND status = 'completed' AND payment_method = 'credit') AS total_credit_cents,
         (SELECT COALESCE(SUM(total_cents), 0) FROM returns WHERE customer_id = c.id) AS total_returned_cents,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM customer_payments WHERE customer_id = c.id AND reversed_at IS NULL) AS total_paid_cents,
         (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id) AS last_purchase,
         (SELECT MAX(created_at) FROM customer_payments WHERE customer_id = c.id AND reversed_at IS NULL) AS last_payment
       FROM customers c WHERE c.id = ?`,
      id
    ),

  list: ({ includeInactive }) =>
    db.all(
      `SELECT c.*, ${BALANCE_SQL} AS balance_cents,
         (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id) AS last_purchase
       FROM customers c ${includeInactive ? '' : 'WHERE c.active = 1'} ORDER BY lower(c.name), c.id`
    ),

  findActiveById: (id) => db.get('SELECT * FROM customers WHERE id = ? AND active = 1', id),
  phoneTaken: async (phone, exceptId = 0) => !!(await db.get('SELECT 1 FROM customers WHERE phone = ? AND id != ?', phone, exceptId)),

  create: (c) =>
    db.insert(
      'INSERT INTO customers (name, phone, email, address, id_number, credit_limit_cents, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      c.name, c.phone, c.email, c.address, c.id_number, c.credit_limit_cents, c.notes
    ),

  async update(id, c, active) {
    await db.run(
      'UPDATE customers SET name=?, phone=?, email=?, address=?, id_number=?, credit_limit_cents=?, notes=?, active=? WHERE id=?',
      c.name, c.phone, c.email, c.address, c.id_number, c.credit_limit_cents, c.notes, active, id
    );
    // Keep the name shown on past sales in step with the customer record.
    await db.run('UPDATE sales SET customer = ? WHERE customer_id = ?', c.name, id);
  },

  addPayment: ({ customerId, amount, method, note, userId, ref }) =>
    db.insert(
      'INSERT INTO customer_payments (customer_id, amount_cents, method, note, user_id, ref) VALUES (?, ?, ?, ?, ?, ?)',
      customerId, amount, method, note, userId, ref
    ),
  findPayment: (id) => db.get('SELECT * FROM customer_payments WHERE id = ?', id),

  // Total currently owed by all customers (ignores customers who have paid in advance).
  totalReceivables: () =>
    db.get(
      `SELECT COALESCE(SUM(GREATEST(b, 0)), 0) AS total, COUNT(*) FILTER (WHERE b > 0) AS customers
       FROM (SELECT ${BALANCE_SQL} AS b FROM customers c) t`
    ),

  // Raw rows for a statement between two dates.
  statementRows: async (id, from, to) => ({
    opening: (
      await db.get(
        `SELECT COALESCE((SELECT SUM(total_cents) FROM sales WHERE customer_id = ? AND status = 'completed' AND payment_method = 'credit' AND left(created_at, 10) < ?), 0)
              - COALESCE((SELECT SUM(amount_cents) FROM customer_payments WHERE customer_id = ? AND reversed_at IS NULL AND left(created_at, 10) < ?), 0)
              - COALESCE((SELECT SUM(total_cents) FROM returns WHERE customer_id = ? AND refund_method = 'credit' AND left(created_at, 10) < ?), 0) AS b`,
        id, from, id, from, id, from
      )
    ).b,
    returns: await db.all(
      `SELECT r.*, u.username, (SELECT string_agg(qty || ' × ' || name, ', ' ORDER BY id) FROM return_items WHERE return_id = r.id) AS items
       FROM returns r LEFT JOIN users u ON u.id = r.user_id
       WHERE r.customer_id = ? AND left(r.created_at, 10) BETWEEN ? AND ?`,
      id, from, to
    ),
    sales: await db.all(
      `SELECT s.*, u.username, (SELECT string_agg(qty || ' × ' || name, ', ' ORDER BY id) FROM sale_items WHERE sale_id = s.id) AS items
       FROM sales s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.customer_id = ? AND left(s.created_at, 10) BETWEEN ? AND ?`,
      id, from, to
    ),
    payments: await db.all(
      `SELECT p.*, u.username FROM customer_payments p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.customer_id = ? AND left(p.created_at, 10) BETWEEN ? AND ?`,
      id, from, to
    ),
  }),
};

module.exports = CustomerModel;
