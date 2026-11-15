// Sales, their items, and returns against them.
const { db } = require('../config/database');

const SaleModel = {
  list: (from, to) =>
    db.all(
      `SELECT s.*, u.username, (SELECT SUM(qty) FROM sale_items WHERE sale_id = s.id) AS item_count,
         (SELECT COALESCE(SUM(total_cents), 0) FROM returns WHERE sale_id = s.id) AS returned_cents
       FROM sales s LEFT JOIN users u ON u.id = s.user_id
       WHERE left(s.created_at, 10) BETWEEN ? AND ? ORDER BY s.id DESC`,
      from, to
    ),

  findById: (id) => db.get('SELECT * FROM sales WHERE id = ?', id),
  findWithCashier: (id) => db.get('SELECT s.*, u.username FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?', id),
  items: (saleId) => db.all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', saleId),
  // Each item with how many of it have already been returned.
  itemsWithReturned: (saleId) =>
    db.all(
      `SELECT i.*, COALESCE((SELECT SUM(ri.qty) FROM return_items ri WHERE ri.sale_item_id = i.id), 0) AS returned_qty
       FROM sale_items i WHERE i.sale_id = ? ORDER BY i.id`,
      saleId
    ),

  create: (s) =>
    db.insert(
      `INSERT INTO sales (customer, customer_id, payment_method, subtotal_cents, discount_cents, discount_percent, tax_cents, total_cents, cogs_cents, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      s.customer, s.customerId, s.method, s.subtotal, s.discount, s.discountPercent, s.tax, s.total, s.cogs, s.userId
    ),

  addItem: (saleId, productId, name, qty, price, cost) =>
    db.run('INSERT INTO sale_items (sale_id, product_id, name, qty, price_cents, cost_cents) VALUES (?, ?, ?, ?, ?, ?)', saleId, productId, name, qty, price, cost),

  markVoid: (id) => db.run("UPDATE sales SET status = 'void' WHERE id = ?", id),

  // Returns
  hasReturns: async (saleId) => !!(await db.get('SELECT 1 FROM returns WHERE sale_id = ?', saleId)),
  async returnsWithItems(saleId) {
    const returns = await db.all('SELECT r.*, u.username FROM returns r LEFT JOIN users u ON u.id = r.user_id WHERE r.sale_id = ? ORDER BY r.id', saleId);
    for (const r of returns) r.items = await db.all('SELECT * FROM return_items WHERE return_id = ? ORDER BY id', r.id);
    return returns;
  },

  createReturn: (r) =>
    db.insert(
      `INSERT INTO returns (ref, sale_id, customer_id, refund_method, subtotal_cents, discount_cents, tax_cents, total_cents, cogs_cents, written_off_cents, reason, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.ref, r.saleId, r.customerId, r.method, r.subtotal, r.discount, r.tax, r.total, r.cogs, r.writtenOff, r.reason, r.userId
    ),

  addReturnItem: (returnId, si, qty, restocked) =>
    db.run(
      'INSERT INTO return_items (return_id, sale_item_id, product_id, name, qty, price_cents, cost_cents, restocked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      returnId, si.id, si.product_id, si.name, qty, si.price_cents, si.cost_cents, restocked
    ),
};

module.exports = SaleModel;
