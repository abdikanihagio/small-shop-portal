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
  const items = body.items.map((it) => ({
    productId: int(it.product_id, 'Product'),
    qty: int(it.qty, 'Quantity', { min: 1, max: MAX_QTY }),
    price: allowPriceOverride && it.price != null ? money(it.price, 'Price') : null,
  }));
  return { items, discountPercent, discountAmount, method, customerId };
}

// Items coming back from a sale: [{ sale_item_id, qty, damaged }] plus how the refund is paid.
function readReturn(body) {
  const reason = str(body.reason, 'Reason', { max: 200 });
  if (!Array.isArray(body.items)) throw bad('Choose the items being returned');
  const items = [];
  for (const it of body.items) {
    const qty = int(it.qty ?? 0, 'Quantity', { min: 0, max: MAX_QTY });
    if (qty) items.push({ saleItemId: Number(it.sale_item_id), qty, damaged: !!it.damaged });
  }
  if (!items.length) throw bad('Choose at least one item to return');
  const refundMethod = String(body.refund_method || '');
  if (refundMethod && !['cash', 'card', 'mobile', 'credit'].includes(refundMethod)) throw bad('Refund method must be cash, card, mobile or credit');
  return { reason, items, refundMethod, preview: !!body.preview };
}

module.exports = { readSale, readReturn };
