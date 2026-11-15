const ProductModel = require('../models/product.model');
const StockModel = require('../models/stock.model');
const audit = require('./audit.service');
const visibility = require('./visibility.service');
const { transaction } = require('../config/database');
const { bad, notFound } = require('../utils/http-error');

const list = async (user, { includeInactive }) => (await ProductModel.list({ includeInactive })).map((p) => visibility.product(user, p));

const create = (actor, p, openingStock) =>
  transaction(async () => {
    if (await ProductModel.skuTaken(p.sku)) throw bad('A product with this SKU already exists');
    const id = await ProductModel.create(p, openingStock);
    if (openingStock > 0) {
      await StockModel.addMovement({ productId: id, type: 'opening', qty: openingStock, unitCost: p.cost_cents, note: 'Opening stock', userId: actor.id });
    }
    await audit.record(actor, 'product.created', 'product', id, { sku: p.sku, name: p.name, cost_cents: p.cost_cents, price_cents: p.price_cents, stock: openingStock });
    return visibility.product(actor, await ProductModel.findById(id));
  });

const update = (actor, id, p, active) =>
  transaction(async () => {
    const old = await ProductModel.findById(id);
    if (!old) throw notFound('Product not found');
    if (!visibility.seesCosts(actor)) p.cost_cents = old.cost_cents; // a role that can't see costs can't change them either
    if (await ProductModel.skuTaken(p.sku, id)) throw bad('Another product already uses this SKU');
    const activeFlag = active ? 1 : 0;
    await ProductModel.update(id, p, activeFlag);
    const changes = {};
    for (const [k, v] of Object.entries({ ...p, active: activeFlag })) if (old[k] !== v) changes[k] = { from: old[k], to: v };
    if (Object.keys(changes).length) await audit.record(actor, 'product.updated', 'product', id, { name: old.name, ...changes });
    return visibility.product(actor, await ProductModel.findById(id));
  });

module.exports = { list, create, update };
