const { MAX_QTY, SALE_PAYMENT_METHODS } = require('../config/constants');
const { bad } = require('../utils/http-error');
const { str, int, money } = require('./common.validator');

// A new sale from the till. Prices are only read when the user may override them.
function readSale(body, { allowPriceOverride }) {
  if (!Array.isArray(body.items) || body.items.length === 0) throw bad('Add at least one item');
  // Discount is either a money amount or a percentage of the subtotal.
  let discountPercent = null;
  if (body.discount_type === 'percent') {
    discountPercent = Number(body.discount ?? 0);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw bad('Discount must be between 0 and 100%');
  }
  const discountAmount = discountPercent === null ? money(body.discount ?? 0, 'Discount') : 0;
  const method = SALE_PAYMENT_METHODS.includes(body.payment_method) ? body.payment_method : 'cash';
  const customerId = body.customer_id ? int(body.customer_id, 'Customer') : null;
  if (method === 'credit' && !customerId) throw bad('Choose a registered customer for a credit sale');
  return { items: body.items, allowPriceOverride, discountPercent, discountAmount, method, customerId };
}

// One sale line, checked when the sale is made (after the customer, before the next line).
function readSaleLine(it, { allowPriceOverride }) {
  return {
    productId: int(it.product_id, 'Product'),
    qty: int(it.qty, 'Quantity', { min: 1, max: MAX_QTY }),
    readPrice: () => (allowPriceOverride && it.price != null ? money(it.price, 'Price') : null),
  };
}

// A return request: [{ sale_item_id, qty, damaged }] plus how the refund is paid. The items are
// checked against the sale (readReturnItems) after the sale itself has been found.
function readReturn(body) {
  return { reason: str(body.reason, 'Reason', { max: 200 }), items: body.items, refundMethod: String(body.refund_method || ''), preview: !!body.preview };
}

function readReturnItems(items) {
  if (!Array.isArray(items)) throw bad('Choose the items being returned');
  const out = [];
  for (const it of items) {
    const qty = int(it.qty ?? 0, 'Quantity', { min: 0, max: MAX_QTY });
    if (qty) out.push({ saleItemId: Number(it.sale_item_id), qty, damaged: !!it.damaged });
  }
  return out;
}

const REFUND_METHODS = ['cash', 'card', 'mobile', 'credit'];
function checkRefundMethod(method) {
  if (method && !REFUND_METHODS.includes(method)) throw bad('Refund method must be cash, card, mobile or credit');
}

module.exports = { readSale, readSaleLine, readReturn, readReturnItems, checkRefundMethod };
