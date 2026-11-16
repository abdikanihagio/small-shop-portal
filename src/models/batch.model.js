// Stock batches with expiry dates.
const { db } = require('../config/database');

const BatchModel = {
  add: ({ productId, expiry, qty, unitCost, purchaseId = null, userId }) =>
    db.insert(
      'INSERT INTO stock_batches (product_id, expiry_date, qty_received, qty_left, unit_cost_cents, purchase_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      productId, expiry, qty, qty, unitCost, purchaseId, userId
    ),

  findById: (id) => db.get('SELECT * FROM stock_batches WHERE id = ?', id),

  // Batches still on the shelf, in the order they should be sold: not yet expired first (soonest
  // expiry first), then expired ones.
  available: (productId, today) =>
    db.all(
      `SELECT * FROM stock_batches WHERE product_id = ? AND qty_left > 0
       ORDER BY (expiry_date < ?), expiry_date, id`,
      productId, today
    ),

  take: (id, qty) => db.run('UPDATE stock_batches SET qty_left = qty_left - ? WHERE id = ?', qty, id),
  giveBack: (id, qty) => db.run('UPDATE stock_batches SET qty_left = LEAST(qty_received, qty_left + ?) WHERE id = ?', qty, id),
  empty: (id) => db.run('UPDATE stock_batches SET qty_left = 0 WHERE id = ?', id),

  // Every batch still on the shelf, soonest expiry first.
  listOpen: () =>
    db.all(
      `SELECT b.*, p.name AS product_name, p.sku, p.unit, p.active, pu.supplier, pu.invoice
       FROM stock_batches b JOIN products p ON p.id = b.product_id LEFT JOIN purchases pu ON pu.id = b.purchase_id
       WHERE b.qty_left > 0 ORDER BY b.expiry_date, p.name, b.id`
    ),

  // Batches expiring on or before a date (expired ones included).
  expiringBy: (date) =>
    db.get(
      `SELECT COUNT(*) AS batches, COALESCE(SUM(qty_left), 0) AS qty, COUNT(DISTINCT product_id) AS products,
         COUNT(*) FILTER (WHERE expiry_date < to_char(now(), 'YYYY-MM-DD')) AS expired
       FROM stock_batches WHERE qty_left > 0 AND expiry_date <= ?`,
      date
    ),
};

module.exports = BatchModel;
