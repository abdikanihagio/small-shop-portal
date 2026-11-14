const ProductModel = require('../models/product.model');
const StockModel = require('../models/stock.model');
const audit = require('./audit.service');
const visibility = require('./visibility.service');
const { transaction } = require('../config/database');
const { bad, notFound } = require('../utils/http-error');

const list = (user, { includeInactive }) => ProductModel.list({ includeInactive }).map((p) => visibility.product(user, p));

function create(actor, p, openingStock) {
  if (ProductModel.skuTaken(p.sku)) throw bad('A product with this SKU already exists');
  return transaction(() => {
    const id = ProductModel.create(p, openingStock);
    if (openingStock > 0) {
      StockModel.addMovement({ productId: id, type: 'opening', qty: openingStock, unitCost: p.cost_cents, note: 'Opening stock', userId: actor.id });
    }
    audit.record(actor, 'product.created', 'product', id, { sku: p.sku, name: p.name, cost_cents: p.cost_cents, price_cents: p.price_cents, stock: openingStock });
    return visibility.product(actor, ProductModel.findById(id));
  });
}

function update(actor, id, p, active) {
  const old = ProductModel.findById(id);
  if (!old) throw notFound('Product not found');
  if (!visibility.seesCosts(actor)) p.cost_cents = old.cost_cents; // a role that can't see costs can't change them either
  if (ProductModel.skuTaken(p.sku, id)) throw bad('Another product already uses this SKU');
  const activeFlag = active ? 1 : 0;
  ProductModel.update(id, p, activeFlag);
  const changes = {};
  for (const [k, v] of Object.entries({ ...p, active: activeFlag })) if (old[k] !== v) changes[k] = { from: old[k], to: v };
  if (Object.keys(changes).length) audit.record(actor, 'product.updated', 'product', id, { name: old.name, ...changes });
  return visibility.product(actor, ProductModel.findById(id));
}

module.exports = { list, create, update };
