// Sales at the till, sale history, and voiding a whole sale.
const SaleModel = require('../models/sale.model');
const ProductModel = require('../models/product.model');
const CustomerModel = require('../models/customer.model');
const StockModel = require('../models/stock.model');
const audit = require('./audit.service');
const settings = require('./settings.service');
const visibility = require('./visibility.service');
const { transaction } = require('../config/database');
const { can } = require('../config/permissions');
const { str, safeTotal } = require('../validators/common.validator');
const { readSaleLine } = require('../validators/sale.validator');
const { cents } = require('../utils/csv');
const { bad, notFound } = require('../utils/http-error');

const list = (user, { from, to }) => SaleModel.list(from, to).map((s) => visibility.sale(user, s));

function get(user, id) {
  const sale = SaleModel.findWithCashier(id);
  if (!sale) throw notFound('Sale not found');
  sale.items = SaleModel.itemsWithReturnedOrdered(id);
  sale.returns = SaleModel.returnsWithItems(id);
  return visibility.saleDetail(user, sale);
}

function checkCreditLimit(customer, total) {
  if (customer.credit_limit_cents <= 0) return;
  const balance = CustomerModel.balance(customer.id);
  if (balance + total > customer.credit_limit_cents) {
    throw bad(
      `${customer.name} would go over their credit limit of ${cents(customer.credit_limit_cents)} ` +
        `(owes ${cents(balance)}, available ${cents(Math.max(customer.credit_limit_cents - balance, 0))})`
    );
  }
}

// sale: validated by validators/sale.validator readSale.
function create(actor, { items, allowPriceOverride, discountPercent, discountAmount, method, customerId }) {
  const shop = settings.get();
  const taxRate = Number(shop.tax_rate) || 0;
  return transaction(() => {
    let customer = null;
    if (customerId) {
      customer = CustomerModel.findActiveById(customerId);
      if (!customer) throw bad('Customer not found or disabled');
    }
    const lines = [];
    const wanted = new Map(); // product id → total quantity in this sale
    for (const item of items) {
      const it = readSaleLine(item, { allowPriceOverride });
      wanted.set(it.productId, (wanted.get(it.productId) || 0) + it.qty);
      const p = ProductModel.findActiveById(it.productId);
      if (!p) throw bad('A product in this sale no longer exists');
      if (wanted.get(it.productId) > p.stock) throw bad(`Not enough stock for ${p.name} (only ${p.stock} left)`);
      // Only users allowed unlimited discounts may override the price; everyone else sells at list price.
      lines.push({ p, qty: it.qty, price: it.readPrice() ?? p.price_cents });
    }
    const subtotal = safeTotal(lines.reduce((s, l) => s + l.qty * l.price, 0), 'Sale total');
    const discount = discountPercent === null ? discountAmount : Math.round((subtotal * discountPercent) / 100);
    if (discount > subtotal) throw bad('Discount cannot be more than the subtotal');
    // Others may only discount up to the owner's limit (whole-cent maths, no rounding loopholes).
    if (!can(actor, 'discount.unlimited') && discount > 0) {
      const maxPct = Number(shop.max_staff_discount) || 0;
      if (discount * 100 > subtotal * maxPct) throw bad(`Discount is over the ${maxPct}% limit for staff. Ask the owner to make this sale.`);
    }
    const tax = Math.round(((subtotal - discount) * taxRate) / 100);
    const total = subtotal - discount + tax;
    const cogs = safeTotal(lines.reduce((s, l) => s + l.qty * l.p.cost_cents, 0), 'Cost of goods');
    if (method === 'credit') checkCreditLimit(customer, total);

    const saleId = SaleModel.create({
      // Only registered customers are named on a sale (free text is not accepted).
      customer: customer ? customer.name : '',
      customerId,
      method,
      subtotal,
      discount,
      discountPercent: discount ? discountPercent : null,
      tax,
      total,
      cogs,
      userId: actor.id,
    });
    for (const l of lines) {
      SaleModel.addItem(saleId, l.p.id, l.p.name, l.qty, l.price, l.p.cost_cents);
      StockModel.addMovement({ productId: l.p.id, type: 'sale', qty: -l.qty, unitCost: l.p.cost_cents, saleId, userId: actor.id, note: `Sale #${saleId}` });
      ProductModel.removeStock(l.p.id, l.qty);
    }
    if (discount > 0) audit.record(actor, 'sale.discount', 'sale', saleId, { discount_cents: discount, discount_percent: discountPercent, subtotal_cents: subtotal });
    return { id: Number(saleId), total_cents: total };
  });
}

// Cancels a whole sale and puts every item back in stock.
function voidSale(actor, id, reasonInput) {
  return transaction(() => {
    const sale = SaleModel.findById(id);
    if (!sale) throw notFound('Sale not found');
    if (sale.status === 'void') throw bad('Sale is already void');
    if (SaleModel.hasReturns(id)) throw bad('This sale already has returns. Use Return items for the rest instead of voiding.');
    const reason = str(reasonInput, 'Reason');
    SaleModel.markVoid(id);
    for (const it of SaleModel.items(id)) {
      ProductModel.addStock(it.product_id, it.qty);
      StockModel.addMovement({
        productId: it.product_id,
        type: 'void',
        qty: it.qty,
        unitCost: it.cost_cents,
        saleId: id,
        userId: actor.id,
        note: `Void sale #${id}${reason ? ': ' + reason : ''}`,
      });
    }
    audit.record(actor, 'sale.voided', 'sale', id, { total_cents: sale.total_cents, reason });
    return { ok: true };
  });
}

module.exports = { list, get, create, voidSale };
