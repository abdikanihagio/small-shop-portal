// Suppliers (accounts payable): details, payments and statements.
const SupplierModel = require('../models/supplier.model');
const SettingsModel = require('../models/settings.model');
const audit = require('./audit.service');
const ledger = require('./ledger.service');
const { withRunningBalance, byDateThen, paymentEntry } = require('./statement.service');
const { transaction } = require('../config/database');
const { diff } = require('../utils/objects');
const { bad, notFound } = require('../utils/http-error');

async function get(id) {
  const s = await SupplierModel.findWithStats(id);
  if (!s) throw notFound('Supplier not found');
  return s;
}

const list = ({ includeInactive }) => SupplierModel.list({ includeInactive });

const create = (actor, s) =>
  transaction(async () => {
    if (await SupplierModel.nameTaken(s.name)) throw bad('A supplier with this name already exists');
    const id = await SupplierModel.create(s);
    await audit.record(actor, 'supplier.created', 'supplier', id, { name: s.name });
    return get(id);
  });

const update = (actor, id, s, active) =>
  transaction(async () => {
    const old = await get(id);
    if (await SupplierModel.nameTaken(s.name, id)) throw bad('Another supplier already has this name');
    await SupplierModel.update(id, s, active);
    await audit.record(actor, 'supplier.updated', 'supplier', id, diff(old, { ...s, active }));
    return get(id);
  });

const recordPayment = (actor, id, { amount, method, note }) =>
  transaction(async () => {
    await get(id);
    const ref = await SettingsModel.nextRef('supplier_payments');
    const payment = await SupplierModel.findPayment(await SupplierModel.addPayment({ supplierId: id, amount, method, note, userId: actor.id, ref }));
    await audit.record(actor, 'supplier_payment.recorded', 'supplier', id, { ref: payment.ref, amount_cents: amount, method });
    return { ...(await get(id)), payment };
  });

const reversePayment = (actor, supplierId, paymentId, reason) => ledger.reverse(actor, 'supplier_payments', paymentId, reason, supplierId);

// Every delivery and payment with a running balance owed to the supplier. Deliveries paid on the
// spot are listed with their payment, so the balance is unchanged.
async function statement(id, from, to) {
  const supplier = await get(id);
  const rows = await SupplierModel.statementRows(id, from, to);
  const entries = [
    ...rows.purchases.map((p) => ({
      kind: 'purchase',
      id: p.id,
      date: p.created_at,
      description: [p.invoice ? `Inv. ${p.invoice}` : '', p.items || ''].filter(Boolean).join(' · '),
      method: p.payment_method,
      by: p.username,
      charge_cents: p.total_cents,
      paid_cents: p.payment_method === 'credit' ? 0 : p.total_cents,
    })),
    ...rows.payments.map((p) => paymentEntry(p, 'Payment made')),
  ].sort(byDateThen(['purchase', 'payment']));
  return { supplier, from, to, ...withRunningBalance(rows.opening, entries) };
}

module.exports = { get, list, create, update, recordPayment, reversePayment, statement };
