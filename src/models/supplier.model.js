// Suppliers (accounts payable).
const { db } = require('../config/database');

// Balance = deliveries received on credit − payments made.
const BALANCE_SQL = `
  COALESCE((SELECT SUM(total_cents) FROM purchases WHERE supplier_id = s.id AND payment_method = 'credit'), 0)
  - COALESCE((SELECT SUM(amount_cents) FROM supplier_payments WHERE supplier_id = s.id AND reversed_at IS NULL), 0)`;

const SupplierModel = {
  findWithStats: (id) =>
    db
      .prepare(
        `SELECT s.*, ${BALANCE_SQL} AS balance_cents,
           (SELECT COUNT(*) FROM purchases WHERE supplier_id = s.id) AS purchase_count,
           (SELECT COALESCE(SUM(total_cents),0) FROM purchases WHERE supplier_id = s.id) AS total_purchases_cents,
           (SELECT COALESCE(SUM(total_cents),0) FROM purchases WHERE supplier_id = s.id AND payment_method = 'credit') AS total_credit_cents,
           (SELECT COALESCE(SUM(amount_cents),0) FROM supplier_payments WHERE supplier_id = s.id AND reversed_at IS NULL) AS total_paid_cents,
           (SELECT MAX(created_at) FROM purchases WHERE supplier_id = s.id) AS last_purchase,
           (SELECT MAX(created_at) FROM supplier_payments WHERE supplier_id = s.id AND reversed_at IS NULL) AS last_payment
         FROM suppliers s WHERE s.id = ?`
      )
      .get(id),

  list: ({ includeInactive }) =>
    db
      .prepare(
        `SELECT s.*, ${BALANCE_SQL} AS balance_cents,
           (SELECT MAX(created_at) FROM purchases WHERE supplier_id = s.id) AS last_purchase
         FROM suppliers s ${includeInactive ? '' : 'WHERE s.active = 1'} ORDER BY s.name COLLATE NOCASE`
      )
      .all(),

  findActiveById: (id) => db.prepare('SELECT * FROM suppliers WHERE id = ? AND active = 1').get(id),
  nameTaken: (name, exceptId = 0) => !!db.prepare('SELECT 1 FROM suppliers WHERE name = ? COLLATE NOCASE AND id != ?').get(name, exceptId),

  create: (s) =>
    db
      .prepare('INSERT INTO suppliers (name, contact_person, phone, email, address, tax_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(s.name, s.contact_person, s.phone, s.email, s.address, s.tax_id, s.notes).lastInsertRowid,

  update(id, s, active) {
    db.prepare('UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?, address=?, tax_id=?, notes=?, active=? WHERE id=?').run(
      s.name, s.contact_person, s.phone, s.email, s.address, s.tax_id, s.notes, active, id
    );
    // Keep the name shown on past deliveries in step with the supplier record.
    db.prepare('UPDATE purchases SET supplier = ? WHERE supplier_id = ?').run(s.name, id);
    db.prepare('UPDATE stock_movements SET supplier = ? WHERE purchase_id IN (SELECT id FROM purchases WHERE supplier_id = ?)').run(s.name, id);
  },

  addPayment: ({ supplierId, amount, method, note, userId, ref }) =>
    db
      .prepare('INSERT INTO supplier_payments (supplier_id, amount_cents, method, note, user_id, ref) VALUES (?, ?, ?, ?, ?, ?)')
      .run(supplierId, amount, method, note, userId, ref).lastInsertRowid,
  findPayment: (id) => db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(id),

  // Total currently owed to all suppliers (ignores advances paid to suppliers).
  totalPayables: () =>
    db
      .prepare(`SELECT COALESCE(SUM(MAX(b, 0)), 0) AS total, COALESCE(SUM(b > 0), 0) AS suppliers FROM (SELECT ${BALANCE_SQL} AS b FROM suppliers s)`)
      .get(),

  statementRows: (id, from, to) => ({
    opening: db
      .prepare(
        `SELECT COALESCE((SELECT SUM(total_cents) FROM purchases WHERE supplier_id = ? AND payment_method = 'credit' AND date(created_at) < ?), 0)
              - COALESCE((SELECT SUM(amount_cents) FROM supplier_payments WHERE supplier_id = ? AND reversed_at IS NULL AND date(created_at) < ?), 0) AS b`
      )
      .get(id, from, id, from).b,
    purchases: db
      .prepare(
        `SELECT p.*, u.username,
           (SELECT GROUP_CONCAT(m.qty_change || ' × ' || pr.name, ', ') FROM stock_movements m JOIN products pr ON pr.id = m.product_id WHERE m.purchase_id = p.id) AS items
         FROM purchases p LEFT JOIN users u ON u.id = p.user_id
         WHERE p.supplier_id = ? AND date(p.created_at) BETWEEN ? AND ?`
      )
      .all(id, from, to),
    payments: db
      .prepare(
        `SELECT p.*, u.username FROM supplier_payments p LEFT JOIN users u ON u.id = p.user_id
         WHERE p.supplier_id = ? AND date(p.created_at) BETWEEN ? AND ?`
      )
      .all(id, from, to),
  }),
};

module.exports = SupplierModel;
