// Returning some or all items of a sale, with an exact refund.
const SaleModel = require('../models/sale.model');
const ProductModel = require('../models/product.model');
const SettingsModel = require('../models/settings.model');
const StockModel = require('../models/stock.model');
const audit = require('./audit.service');
const inventory = require('./inventory.service');
const { transaction } = require('../config/database');
const { bad, notFound } = require('../utils/http-error');

// Works out a return's refund as its exact share of what the customer paid. Shares are computed on a
// running total, so however many partial returns are made, together they add up to the sale exactly.
async function computeReturn(sale, { items, refundMethod }) {
  if (sale.status !== 'completed') throw bad('Only completed sales can have items returned');
  const saleItems = await SaleModel.itemsWithReturned(sale.id);
  const lines = [];
  for (const it of items) {
    const si = saleItems.find((x) => x.id === it.saleItemId);
    if (!si) throw bad('An item is not part of this sale');
    if (lines.some((l) => l.si.id === si.id)) throw bad('The same item is listed twice');
    const left = si.qty - si.returned_qty;
    if (it.qty > left) throw bad(`Only ${left} of ${si.name} can still be returned`);
    lines.push({ si, qty: it.qty, damaged: it.damaged });
  }

  const before = saleItems.reduce((a, i) => a + i.returned_qty * i.price_cents, 0);
  const gross = lines.reduce((a, l) => a + l.qty * l.si.price_cents, 0);
  const after = before + gross;
  const share = (amount) => (sale.subtotal_cents ? Math.round((amount * after) / sale.subtotal_cents) - Math.round((amount * before) / sale.subtotal_cents) : 0);
  const discount = share(sale.discount_cents);
  const tax = share(sale.tax_cents);

  let method = refundMethod;
  if (sale.payment_method === 'credit') method = 'credit'; // a credit sale is refunded by reducing what the customer owes
  else if (!method) method = sale.payment_method;
  if (method === 'credit' && !sale.customer_id) throw bad('Store credit needs a registered customer on the sale');

  return {
    lines,
    method,
    subtotal_cents: gross,
    discount_cents: discount,
    tax_cents: tax,
    total_cents: gross - discount + tax,
    cogs_cents: lines.reduce((a, l) => a + l.qty * l.si.cost_cents, 0),
    written_off_cents: lines.filter((l) => l.damaged).reduce((a, l) => a + l.qty * l.si.cost_cents, 0),
  };
}

// request: validated by validators/sale.validator readReturn. With preview, nothing is saved.
function createReturn(actor, saleId, request) {
  const { reason } = request;
  return transaction(async () => {
    const sale = await SaleModel.findById(saleId);
    if (!sale) throw notFound('Sale not found');
    const r = await computeReturn(sale, request);
    const summary = {
      refund_method: r.method,
      subtotal_cents: r.subtotal_cents,
      discount_cents: r.discount_cents,
      tax_cents: r.tax_cents,
      total_cents: r.total_cents,
    };
    if (request.preview) return summary;
    if (!reason) throw bad('Reason is required');

    const ref = await SettingsModel.nextRef('returns');
    const returnId = await SaleModel.createReturn({
      ref,
      saleId,
      customerId: sale.customer_id,
      method: r.method,
      subtotal: r.subtotal_cents,
      discount: r.discount_cents,
      tax: r.tax_cents,
      total: r.total_cents,
      cogs: r.cogs_cents,
      writtenOff: r.written_off_cents,
      reason,
      userId: actor.id,
    });
    for (const l of r.lines) {
      await SaleModel.addReturnItem(returnId, l.si, l.qty, !l.damaged);
      if (l.damaged) continue; // written off, not restocked
      // Back on the shelf at the cost it was sold at (keeps the average cost honest).
      await inventory.addStockAtCost(await ProductModel.findById(l.si.product_id), l.qty, l.si.cost_cents);
      await StockModel.addMovement({
        productId: l.si.product_id,
        type: 'return',
        qty: l.qty,
        unitCost: l.si.cost_cents,
        saleId,
        returnId,
        userId: actor.id,
        note: `${ref} from sale #${saleId}${reason ? ': ' + reason : ''}`,
      });
    }
    await audit.record(actor, 'sale.returned', 'sale', saleId, {
      ref,
      ...summary,
      items: r.lines.map((l) => `${l.qty} × ${l.si.name}${l.damaged ? ' (damaged)' : ''}`).join(', '),
      reason,
    });
    return { ...summary, id: Number(returnId), ref };
  });
}

module.exports = { createReturn };
