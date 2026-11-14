const { db } = require('../config/database');

const ProductModel = {
  list: ({ includeInactive = false } = {}) =>
    db.prepare(`SELECT * FROM products ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name COLLATE NOCASE`).all(),
  all: () => db.prepare('SELECT * FROM products ORDER BY name').all(),
  findById: (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id),
  findActiveById: (id) => db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id),
  skuTaken: (sku, exceptId = 0) => !!db.prepare('SELECT 1 FROM products WHERE sku = ? AND id != ?').get(sku, exceptId),

  create: (p, stock) =>
    db
      .prepare(
        `INSERT INTO products (sku, name, category, unit, cost_cents, price_cents, stock, reorder_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(p.sku, p.name, p.category, p.unit, p.cost_cents, p.price_cents, stock, p.reorder_level).lastInsertRowid,

  update: (id, p, active) =>
    db
      .prepare('UPDATE products SET sku=?, name=?, category=?, unit=?, cost_cents=?, price_cents=?, reorder_level=?, active=? WHERE id=?')
      .run(p.sku, p.name, p.category, p.unit, p.cost_cents, p.price_cents, p.reorder_level, active, id),

  // Import: change details but never stock.
  updateDetails: (id, p) =>
    db
      .prepare('UPDATE products SET name=?, category=?, unit=?, cost_cents=?, price_cents=?, reorder_level=? WHERE id=?')
      .run(p.name, p.category, p.unit, p.cost_cents, p.price_cents, p.reorder_level, id),

  // Stock levels
  addStockAtCost: (id, qty, newCost) => db.prepare('UPDATE products SET stock = stock + ?, cost_cents = ? WHERE id = ?').run(qty, newCost, id),
  addStock: (id, qty) => db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(qty, id),
  removeStock: (id, qty) => db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, id),
  setStock: (id, count) => db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(count, id),

  lowStock: () =>
    db.prepare('SELECT id, sku, name, stock, reorder_level, unit FROM products WHERE active = 1 AND stock <= reorder_level ORDER BY stock').all(),
  stockSummary: () =>
    db.prepare('SELECT COUNT(*) AS products, COALESCE(SUM(MAX(stock,0) * cost_cents),0) AS value FROM products WHERE active = 1').get(),
};

module.exports = ProductModel;
