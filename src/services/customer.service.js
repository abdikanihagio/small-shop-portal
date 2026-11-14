// Customers with credit accounts: details, payments and statements.
const CustomerModel = require('../models/customer.model');
const SettingsModel = require('../models/settings.model');
const audit = require('./audit.service');
const ledger = require('./ledger.service');
const visibility = require('./visibility.service');
const { withRunningBalance, byDateThen, paymentEntry } = require('./statement.service');
const { transaction } = require('../config/database');
const { diff } = require('../utils/objects');
const { bad, notFound } = require('../utils/http-error');

function get(id) {
  const c = CustomerModel.findWithStats(id);
  if (!c) throw notFound('Customer not found');
  return c;
}

// The full list for customer managers; the till gets just enough to pick a customer.
function list(user, { includeInactive }) {
  const rows = CustomerModel.list({ includeInactive: includeInactive && visibility.seesCustomers(user) });
  return rows.map((c) => visibility.customerListItem(user, c));
}

function create(actor, c) {
  if (c.phone && CustomerModel.phoneTaken(c.phone)) throw bad('A customer with this phone number already exists');
  const id = CustomerModel.create(c);
  audit.record(actor, 'customer.created', 'customer', id, { name: c.name, credit_limit_cents: c.credit_limit_cents });
  return get(id);
}

function update(actor, id, c, active) {
  const old = get(id);
  if (c.phone && CustomerModel.phoneTaken(c.phone, id)) throw bad('Another customer already uses this phone number');
  CustomerModel.update(id, c, active);
  audit.record(actor, 'customer.updated', 'customer', id, diff(old, { ...c, active }));
  return get(id);
}

function recordPayment(actor, id, { amount, method, note }) {
  get(id);
  const paymentId = transaction(() =>
    CustomerModel.addPayment({ customerId: id, amount, method, note, userId: actor.id, ref: SettingsModel.nextRef('customer_payments') })
  );
  const payment = CustomerModel.findPayment(paymentId);
  audit.record(actor, 'customer_payment.recorded', 'customer', id, { ref: payment.ref, amount_cents: amount, method });
  return { ...get(id), payment };
}

const reversePayment = (actor, customerId, paymentId, reason) => ledger.reverse(actor, 'customer_payments', paymentId, reason, customerId);

// Credit sales add to the balance, payments reduce it; sales paid at the till are listed with their
// payment so the balance is unchanged. A return takes the refund off the charges: refunded to the
// account, what they owe goes down; refunded in cash/card/mobile, it also shows as money paid back.
function statement(id, from, to) {
  const customer = get(id);
  const rows = CustomerModel.statementRows(id, from, to);
  const entries = [
    ...rows.sales.map((s) => {
      const counts = s.status === 'completed';
      const credit = s.payment_method === 'credit';
      return {
        kind: 'sale',
        id: s.id,
        date: s.created_at,
        description: s.items || '',
        method: s.payment_method,
        status: s.status,
        by: s.username,
        charge_cents: counts ? s.total_cents : 0,
        paid_cents: counts && !credit ? s.total_cents : 0,
        amount_cents: s.total_cents,
      };
    }),
    ...rows.payments.map((p) => paymentEntry(p, 'Payment received')),
    ...rows.returns.map((r) => ({
      kind: 'return',
      id: r.id,
      date: r.created_at,
      ref: r.ref,
      sale_id: r.sale_id,
      description: `${r.items || ''} (from sale #${r.sale_id})`,
      method: r.refund_method,
      status: 'completed',
      by: r.username,
      charge_cents: -r.total_cents,
      paid_cents: r.refund_method === 'credit' ? 0 : -r.total_cents,
      amount_cents: r.total_cents,
    })),
  ].sort(byDateThen(['sale', 'return', 'payment']));
  return { customer, from, to, ...withRunningBalance(rows.opening, entries) };
}

module.exports = { get, list, create, update, recordPayment, reversePayment, statement };
