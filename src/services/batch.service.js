// Expiry dates. Stock received with an expiry date becomes a batch. Whenever stock leaves (a sale, a
// count going down) it is taken from the batch that expires first, still-good batches before expired
// ones; voids and returns put it back. Stock received without a date is simply not tracked by expiry.
const BatchModel = require('../models/batch.model');
const ProductModel = require('../models/product.model');
const StockModel = require('../models/stock.model');
const SettingsModel = require('../models/settings.model');
const audit = require('./audit.service');
const visibility = require('./visibility.service');
const { transaction } = require('../config/database');
const { today } = require('../utils/dates');
const { bad, notFound } = require('../utils/http-error');

const addDays = (date, days) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const warningDays = async () => Number((await SettingsModel.all()).expiry_warning_days) || 30;

// Takes qty units of a product out of its batches. Returns where they came from: [{ id, qty }]
// (fewer than qty when part of the stock has no expiry date). Call inside a transaction.
async function take(productId, qty) {
  const used = [];
  let left = qty;
  for (const b of await BatchModel.available(productId, today())) {
    if (left <= 0) break;
    const n = Math.min(left, b.qty_left);
    await BatchModel.take(b.id, n);
    used.push({ id: b.id, qty: n });
    left -= n;
  }
  return used;
}

// Puts qty units back into the batches they were taken from. alreadyBack: units of this line that
// came back before (earlier returns), which are skipped. Call inside a transaction.
async function giveBack(allocations, qty, alreadyBack = 0) {
  let skip = alreadyBack;
  let left = qty;
  for (const a of [...(allocations || [])].reverse()) {
    if (left <= 0) break;
    const skipped = Math.min(skip, a.qty);
    skip -= skipped;
    const n = Math.min(left, a.qty - skipped);
    if (n > 0) {
      await BatchModel.giveBack(a.id, n);
      left -= n;
    }
  }
}

const parseAllocations = (json) => {
  try {
    return JSON.parse(json || '[]');
  } catch {
    return [];
  }
};

// Every batch still on the shelf, with how many days are left.
async function list(user) {
  const warn = await warningDays();
  const t = today();
  const rows = await BatchModel.listOpen();
  return {
    warning_days: warn,
    today: t,
    batches: rows.map((b) => {
      const days = Math.round((new Date(`${b.expiry_date}T12:00:00`) - new Date(`${t}T12:00:00`)) / 86400000);
      const row = { ...b, days_left: days, state: days < 0 ? 'expired' : days <= warn ? 'soon' : 'ok' };
      // Like stock movements: no costs or supplier details for roles that can't see costs.
      return visibility.seesCosts(user) ? row : (({ unit_cost_cents, supplier, invoice, ...rest }) => rest)(row);
    }),
  };
}

// For the dashboard: batches expired or expiring within the warning period.
async function expiringSummary() {
  const warn = await warningDays();
  return { ...(await BatchModel.expiringBy(addDays(today(), warn))), warning_days: warn };
}

// Removes what is left of a batch from stock (expired or spoiled), as a stock adjustment.
const writeOff = (actor, batchId, reason) =>
  transaction(async () => {
    const b = await BatchModel.findById(batchId);
    if (!b) throw notFound('Batch not found');
    if (!b.qty_left) throw bad('Nothing left in this batch');
    const p = await ProductModel.findById(b.product_id);
    const qty = Math.min(b.qty_left, Math.max(p.stock, 0));
    await BatchModel.empty(b.id);
    if (qty > 0) {
      await ProductModel.setStock(p.id, p.stock - qty);
      await StockModel.addMovement({
        productId: p.id,
        type: 'adjustment',
        qty: -qty,
        unitCost: p.cost_cents,
        note: `${reason} (batch expiring ${b.expiry_date})`,
        userId: actor.id,
      });
    }
    await audit.record(actor, 'stock.written_off', 'product', p.id, { name: p.name, qty, expiry_date: b.expiry_date, reason });
    return { ok: true, product: p.name, qty };
  });

module.exports = { take, giveBack, parseAllocations, list, expiringSummary, writeOff, addDays };
