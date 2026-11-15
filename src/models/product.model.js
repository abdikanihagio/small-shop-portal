const { db } = require('../config/database');

// SKUs are unique ignoring upper/lower case.
const ProductModel = {
  list: ({ includeInactive = false } = {}) =>
    db.all(`SELECT * FROM products ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY lower(name), id`),
  all: () => db.all('SELECT * FROM products ORDER BY name, id'),
  findById: (id) => db.get('SELECT * FROM products WHERE id = ?', id),
  findActiveById: (id) => db.get('SELECT * FROM products WHERE id = ? AND active = 1', id),
  skuTaken: async (sku, exceptId = 0) => !!(await db.get('SELECT 1 FROM products WHERE lower(sku) = lower(?) AND id != ?', sku, exceptId)),

  create: (p, stock) =>
    db.insert(
      `INSERT INTO products (sku, name, category, unit, cost_cents, price_cents, stock, reorder_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      p.sku, p.name, p.category, p.unit, p.cost_cents, p.price_cents, stock, p.reorder_level
    ),

  update: (id, p, active) =>
    db.run(
      'UPDATE products SET sku=?, name=?, category=?, unit=?, cost_cents=?, price_cents=?, reorder_level=?, active=? WHERE id=?',
      p.sku, p.name, p.category, p.unit, p.cost_cents, p.price_cents, p.reorder_level, active, id
    ),

  // Import: change details but never stock.
  updateDetails: (id, p) =>
    db.run(
      'UPDATE products SET name=?, category=?, unit=?, cost_cents=?, price_cents=?, reorder_level=? WHERE id=?',
      p.name, p.category, p.unit, p.cost_cents, p.price_cents, p.reorder_level, id
    ),

  // Stock levels
  addStockAtCost: (id, qty, newCost) => db.run('UPDATE products SET stock = stock + ?, cost_cents = ? WHERE id = ?', qty, newCost, id),
  addStock: (id, qty) => db.run('UPDATE products SET stock = stock + ? WHERE id = ?', qty, id),
  removeStock: (id, qty) => db.run('UPDATE products SET stock = stock - ? WHERE id = ?', qty, id),
  setStock: (id, count) => db.run('UPDATE products SET stock = ? WHERE id = ?', count, id),

  lowStock: () => db.all('SELECT id, sku, name, stock, reorder_level, unit FROM products WHERE active = 1 AND stock <= reorder_level ORDER BY stock, id'),
  stockSummary: () =>
    db.get('SELECT COUNT(*) AS products, COALESCE(SUM(GREATEST(stock, 0) * cost_cents), 0) AS value FROM products WHERE active = 1'),
};

module.exports = ProductModel;
