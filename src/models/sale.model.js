// Sales, their items, and returns against them.
const { db } = require('../config/database');

const ITEMS_WITH_RETURNED = `SELECT i.*, COALESCE((SELECT SUM(ri.qty) FROM return_items ri WHERE ri.sale_item_id = i.id), 0) AS returned_qty
  FROM sale_items i WHERE i.sale_id = ?`;

const SaleModel = {
  list: (from, to) =>
    db
      .prepare(
        `SELECT s.*, u.username, (SELECT SUM(qty) FROM sale_items WHERE sale_id = s.id) AS item_count,
           (SELECT COALESCE(SUM(total_cents),0) FROM returns WHERE sale_id = s.id) AS returned_cents
         FROM sales s LEFT JOIN users u ON u.id = s.user_id
         WHERE date(s.created_at) BETWEEN ? AND ? ORDER BY s.id DESC`
      )
      .all(from, to),

  findById: (id) => db.prepare('SELECT * FROM sales WHERE id = ?').get(id),
  findWithCashier: (id) => db.prepare('SELECT s.*, u.username FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(id),
  items: (saleId) => db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId),
  itemsWithReturned: (saleId) => db.prepare(ITEMS_WITH_RETURNED).all(saleId),
  itemsWithReturnedOrdered: (saleId) => db.prepare(ITEMS_WITH_RETURNED + ' ORDER BY i.id').all(saleId),

  create: (s) =>
    db
      .prepare(
        `INSERT INTO sales (customer, customer_id, payment_method, subtotal_cents, discount_cents, discount_percent, tax_cents, total_cents, cogs_cents, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(s.customer, s.customerId, s.method, s.subtotal, s.discount, s.discountPercent, s.tax, s.total, s.cogs, s.userId).lastInsertRowid,

  addItem: (saleId, productId, name, qty, price, cost) =>
    db.prepare('INSERT INTO sale_items (sale_id, product_id, name, qty, price_cents, cost_cents) VALUES (?, ?, ?, ?, ?, ?)').run(saleId, productId, name, qty, price, cost),

  markVoid: (id) => db.prepare("UPDATE sales SET status = 'void' WHERE id = ?").run(id),

  // Returns
  hasReturns: (saleId) => !!db.prepare('SELECT 1 FROM returns WHERE sale_id = ?').get(saleId),
  returnsWithItems: (saleId) =>
    db
      .prepare('SELECT r.*, u.username FROM returns r LEFT JOIN users u ON u.id = r.user_id WHERE r.sale_id = ? ORDER BY r.id')
      .all(saleId)
      .map((r) => ({ ...r, items: db.prepare('SELECT * FROM return_items WHERE return_id = ? ORDER BY id').all(r.id) })),

  createReturn: (r) =>
    db
      .prepare(
        `INSERT INTO returns (ref, sale_id, customer_id, refund_method, subtotal_cents, discount_cents, tax_cents, total_cents, cogs_cents, written_off_cents, reason, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(r.ref, r.saleId, r.customerId, r.method, r.subtotal, r.discount, r.tax, r.total, r.cogs, r.writtenOff, r.reason, r.userId).lastInsertRowid,

  addReturnItem: (returnId, si, qty, restocked) =>
    db
      .prepare('INSERT INTO return_items (return_id, sale_item_id, product_id, name, qty, price_cents, cost_cents, restocked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(returnId, si.id, si.product_id, si.name, qty, si.price_cents, si.cost_cents, restocked ? 1 : 0),
};

module.exports = SaleModel;
