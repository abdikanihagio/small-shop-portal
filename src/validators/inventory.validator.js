const { MAX_QTY, PURCHASE_PAYMENT_METHODS } = require('../config/constants');
const { bad } = require('../utils/http-error');
const { str, int, money } = require('./common.validator');

// An optional date ("YYYY-MM-DD", a real calendar date), e.g. an expiry or production date.
function readBatchDate(v, field = 'Expiry date') {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  const d = new Date(`${s}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw bad(`${field} must be a real date (YYYY-MM-DD)`);
  if (s < '2000-01-01' || s > '2100-12-31') throw bad(`${field} is out of range`);
  return s;
}
const readExpiry = (v) => readBatchDate(v, 'Expiry date');

// One delivery from a supplier, with one or more product lines.
function readRestock(body) {
  const rawItems = Array.isArray(body.items) ? body.items : [body];
  if (!rawItems.length) throw bad('Add at least one product');
  const items = rawItems.map((it) => ({
    productId: int(it.product_id, 'Product'),
    qty: int(it.qty, 'Quantity', { min: 1, max: MAX_QTY }),
    unitCost: money(it.unit_cost, 'Unit cost'),
    expiry: readExpiry(it.expiry),
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

module.exports = { readRestock, readAdjustment, readBatchDate };
