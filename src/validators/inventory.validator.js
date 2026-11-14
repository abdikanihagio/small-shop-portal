const { MAX_QTY, PURCHASE_PAYMENT_METHODS } = require('../config/constants');
const { bad } = require('../utils/http-error');
const { str, int, money } = require('./common.validator');

// One delivery from a supplier, with one or more product lines.
function readRestock(body) {
  const rawItems = Array.isArray(body.items) ? body.items : [body];
  if (!rawItems.length) throw bad('Add at least one product');
  const items = rawItems.map((it) => ({
    productId: int(it.product_id, 'Product'),
    qty: int(it.qty, 'Quantity', { min: 1, max: MAX_QTY }),
    unitCost: money(it.unit_cost, 'Unit cost'),
  }));
  const method = PURCHASE_PAYMENT_METHODS.includes(body.payment_method) ? body.payment_method : 'cash';
  const supplierId = body.supplier_id ? int(body.supplier_id, 'Supplier') : null;
  if (method === 'credit' && !supplierId) throw bad('Choose a registered supplier to receive stock on credit');
  return { items, note: str(body.note, 'Note'), method, supplierId, supplierName: str(body.supplier, 'Supplier') };
}

function readAdjustment(body) {
  return {
    productId: int(body.product_id, 'Product'),
    newCount: int(body.new_count, 'New count', { min: 0, max: MAX_QTY }),
    note: str(body.note, 'Reason', { required: true }),
  };
}

module.exports = { readRestock, readAdjustment };
