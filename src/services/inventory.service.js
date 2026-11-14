// Stock: receiving deliveries, count corrections, movement history.
const ProductModel = require('../models/product.model');
const StockModel = require('../models/stock.model');
const SupplierModel = require('../models/supplier.model');
const audit = require('./audit.service');
const visibility = require('./visibility.service');
const { transaction } = require('../config/database');
const { MAX_QTY } = require('../config/constants');
const { safeTotal } = require('../validators/common.validator');
const { weightedCost } = require('../utils/objects');
const { bad, notFound } = require('../utils/http-error');

const movements = (user, { productId, limit }) => StockModel.listMovements({ productId, limit }).map((m) => visibility.movement(user, m));

// Puts units back on the shelf at a unit cost, updating the product's weighted average cost.
function addStockAtCost(product, qty, unitCost) {
  ProductModel.addStockAtCost(product.id, qty, weightedCost(product.stock, product.cost_cents, qty, unitCost));
}

// One delivery from a supplier can hold many products.
function receive(actor, { items, note, method, supplierId, supplierName }) {
  return transaction(() => {
    let supplier = supplierName;
    if (supplierId) {
      const s = SupplierModel.findActiveById(supplierId);
      if (!s) throw bad('Supplier not found or disabled');
      supplier = s.name;
    }
    const total = safeTotal(items.reduce((a, i) => a + i.qty * i.unitCost, 0), 'Purchase total');
    const purchaseId = StockModel.createPurchase({ supplierId, supplier, invoice: note, method, total, userId: actor.id });
    const updated = [];
    for (const { productId, qty, unitCost } of items) {
      const p = ProductModel.findById(productId);
      if (!p) throw notFound('Product not found');
      if (Math.max(p.stock, 0) + qty > MAX_QTY) throw bad(`${p.name}: stock would be over ${MAX_QTY.toLocaleString('en')}`);
      addStockAtCost(p, qty, unitCost);
      StockModel.addMovement({ productId, type: 'purchase', qty, unitCost, supplier, note, userId: actor.id, purchaseId });
      updated.push(ProductModel.findById(productId));
    }
    audit.record(actor, 'stock.received', 'purchase', purchaseId, { supplier, payment_method: method, total_cents: total, lines: items.length });
    return { id: Number(purchaseId), products: updated, total_cents: total };
  });
}

// Stock count correction (damage, loss, recount).
function adjust(actor, { productId, newCount, note }) {
  return transaction(() => {
    const p = ProductModel.findById(productId);
    if (!p) throw notFound('Product not found');
    const change = newCount - p.stock;
    if (change === 0) throw bad('New count is the same as current stock');
    ProductModel.setStock(productId, newCount);
    StockModel.addMovement({ productId, type: 'adjustment', qty: change, unitCost: p.cost_cents, note, userId: actor.id });
    audit.record(actor, 'stock.adjusted', 'product', productId, { name: p.name, from: p.stock, to: newCount, reason: note });
    return ProductModel.findById(productId);
  });
}

// A delivery with its product lines.
function purchase(id) {
  const p = StockModel.findPurchase(id);
  if (!p) throw notFound('Delivery not found');
  p.items = StockModel.purchaseLines(id);
  return p;
}

module.exports = { movements, addStockAtCost, receive, adjust, purchase };
