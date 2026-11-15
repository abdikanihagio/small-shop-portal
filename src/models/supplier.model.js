// Suppliers (accounts payable).
const { db } = require('../config/database');

// Balance = deliveries received on credit − payments made.
const BALANCE_SQL = `
  COALESCE((SELECT SUM(total_cents) FROM purchases WHERE supplier_id = s.id AND payment_method = 'credit'), 0)
  - COALESCE((SELECT SUM(amount_cents) FROM supplier_payments WHERE supplier_id = s.id AND reversed_at IS NULL), 0)`;

const SupplierModel = {
  findWithStats: (id) =>
    db.get(
      `SELECT s.*, ${BALANCE_SQL} AS balance_cents,
         (SELECT COUNT(*) FROM purchases WHERE supplier_id = s.id) AS purchase_count,
         (SELECT COALESCE(SUM(total_cents), 0) FROM purchases WHERE supplier_id = s.id) AS total_purchases_cents,
         (SELECT COALESCE(SUM(total_cents), 0) FROM purchases WHERE supplier_id = s.id AND payment_method = 'credit') AS total_credit_cents,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM supplier_payments WHERE supplier_id = s.id AND reversed_at IS NULL) AS total_paid_cents,
         (SELECT MAX(created_at) FROM purchases WHERE supplier_id = s.id) AS last_purchase,
         (SELECT MAX(created_at) FROM supplier_payments WHERE supplier_id = s.id AND reversed_at IS NULL) AS last_payment
       FROM suppliers s WHERE s.id = ?`,
      id
    ),

  list: ({ includeInactive }) =>
    db.all(
      `SELECT s.*, ${BALANCE_SQL} AS balance_cents,
         (SELECT MAX(created_at) FROM purchases WHERE supplier_id = s.id) AS last_purchase
       FROM suppliers s ${includeInactive ? '' : 'WHERE s.active = 1'} ORDER BY lower(s.name), s.id`
    ),

  findActiveById: (id) => db.get('SELECT * FROM suppliers WHERE id = ? AND active = 1', id),
  nameTaken: async (name, exceptId = 0) => !!(await db.get('SELECT 1 FROM suppliers WHERE lower(name) = lower(?) AND id != ?', name, exceptId)),

  create: (s) =>
    db.insert(
      'INSERT INTO suppliers (name, contact_person, phone, email, address, tax_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      s.name, s.contact_person, s.phone, s.email, s.address, s.tax_id, s.notes
    ),

  async update(id, s, active) {
    await db.run(
      'UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?, address=?, tax_id=?, notes=?, active=? WHERE id=?',
      s.name, s.contact_person, s.phone, s.email, s.address, s.tax_id, s.notes, active, id
    );
    // Keep the name shown on past deliveries in step with the supplier record.
    await db.run('UPDATE purchases SET supplier = ? WHERE supplier_id = ?', s.name, id);
    await db.run('UPDATE stock_movements SET supplier = ? WHERE purchase_id IN (SELECT id FROM purchases WHERE supplier_id = ?)', s.name, id);
  },

  addPayment: ({ supplierId, amount, method, note, userId, ref }) =>
    db.insert(
      'INSERT INTO supplier_payments (supplier_id, amount_cents, method, note, user_id, ref) VALUES (?, ?, ?, ?, ?, ?)',
      supplierId, amount, method, note, userId, ref
    ),
  findPayment: (id) => db.get('SELECT * FROM supplier_payments WHERE id = ?', id),

  // Total currently owed to all suppliers (ignores advances paid to suppliers).
  totalPayables: () =>
    db.get(
      `SELECT COALESCE(SUM(GREATEST(b, 0)), 0) AS total, COUNT(*) FILTER (WHERE b > 0) AS suppliers
       FROM (SELECT ${BALANCE_SQL} AS b FROM suppliers s) t`
    ),

  statementRows: async (id, from, to) => ({
    opening: (
      await db.get(
        `SELECT COALESCE((SELECT SUM(total_cents) FROM purchases WHERE supplier_id = ? AND payment_method = 'credit' AND left(created_at, 10) < ?), 0)
              - COALESCE((SELECT SUM(amount_cents) FROM supplier_payments WHERE supplier_id = ? AND reversed_at IS NULL AND left(created_at, 10) < ?), 0) AS b`,
        id, from, id, from
      )
    ).b,
    purchases: await db.all(
      `SELECT p.*, u.username,
         (SELECT string_agg(m.qty_change || ' × ' || pr.name, ', ' ORDER BY m.id) FROM stock_movements m JOIN products pr ON pr.id = m.product_id WHERE m.purchase_id = p.id) AS items
       FROM purchases p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.supplier_id = ? AND left(p.created_at, 10) BETWEEN ? AND ?`,
      id, from, to
    ),
    payments: await db.all(
      `SELECT p.*, u.username FROM supplier_payments p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.supplier_id = ? AND left(p.created_at, 10) BETWEEN ? AND ?`,
      id, from, to
    ),
  }),
};

module.exports = SupplierModel;
