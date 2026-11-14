// Stock movements (every change to stock, with its cost) and supplier deliveries (purchases).
const { db } = require('../config/database');

const StockModel = {
  // type: opening | purchase | adjustment | sale | void | return
  addMovement: ({ productId, type, qty, unitCost, supplier = '', note = '', saleId = null, userId, purchaseId = null, returnId = null }) =>
    db
      .prepare(
        `INSERT INTO stock_movements (product_id, type, qty_change, unit_cost_cents, supplier, note, sale_id, user_id, purchase_id, return_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(productId, type, qty, unitCost, supplier, note, saleId, userId, purchaseId, returnId),

  listMovements: ({ productId, limit }) =>
    db
      .prepare(
        `SELECT m.*, p.name AS product_name, p.sku, u.username
         FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
         ${productId ? 'WHERE m.product_id = ?' : ''} ORDER BY m.id DESC LIMIT ${Number(limit)}`
      )
      .all(...(productId ? [productId] : [])),

  createPurchase: ({ supplierId, supplier, invoice, method, total, userId }) =>
    db
      .prepare('INSERT INTO purchases (supplier_id, supplier, invoice, payment_method, total_cents, user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(supplierId, supplier, invoice, method, total, userId).lastInsertRowid,

  findPurchase: (id) => db.prepare('SELECT p.*, u.username FROM purchases p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?').get(id),
  purchaseLines: (id) =>
    db
      .prepare(
        `SELECT m.qty_change AS qty, m.unit_cost_cents, pr.name, pr.sku, pr.unit FROM stock_movements m
         JOIN products pr ON pr.id = m.product_id WHERE m.purchase_id = ? ORDER BY m.id`
      )
      .all(id),
};

module.exports = StockModel;
