// Cash closing. A cashier opens a shift with the float in the drawer, and closes it by counting the
// cash. The count is "blind": the expected amount is only shown after the count is entered.
// Expected cash = float + cash sales − voided cash sales − cash refunds + cash from customers
//                 − cash paid to suppliers − deliveries paid in cash − cash expenses
// (everything that user did in cash during the shift). The figures are frozen in the Z-report at closing.
const ShiftModel = require('../models/shift.model');
const audit = require('./audit.service');
const { transaction } = require('../config/database');
const { can } = require('../config/permissions');
const { bad, notFound, forbidden } = require('../utils/http-error');

function expectedCash(floatCents, m) {
  return floatCents + m.cash_sales - (m.cash_voids || 0) - m.cash_refunds + m.customer_payments_cash - m.supplier_payments_cash - m.deliveries_paid_cash - m.expenses_cash;
}

// A shift as the screens show it. Open shifts: live figures, but the expected cash only for
// Accounting (the cashier counts blind).
async function view(actor, shift) {
  const { start_ids, end_ids, ...rest } = shift;
  shift = rest;
  if (shift.status === 'closed') return { ...shift, summary: JSON.parse(shift.summary || '{}') };
  const m = await ShiftModel.movements(shift.user_id, JSON.parse(start_ids), await ShiftModel.lastIds(), shift.id);
  const out = { ...shift, summary: { sales_count: m.sales_count, sales_total: m.sales_total, sales_by_method: m.sales_by_method } };
  if (can(actor, 'accounting')) out.summary = { ...m, expected_cash: expectedCash(shift.opening_float_cents, m) };
  return out;
}

async function current(actor) {
  const shift = await ShiftModel.findOpenForUser(actor.id);
  return { shift: shift ? await view(actor, shift) : null };
}

const open = (actor, floatCents) =>
  transaction(async () => {
    if (await ShiftModel.findOpenForUser(actor.id)) throw bad('You already have an open shift. Close it first.');
    const id = await ShiftModel.open(actor.id, floatCents, await ShiftModel.lastIds());
    await audit.record(actor, 'shift.opened', 'shift', id, { float_cents: floatCents });
    return view(actor, await ShiftModel.findById(id));
  });

// Closes an open shift with the cash counted in its drawer; returns the Z-report.
async function closeOpenShift(actor, shift, { counted, note }) {
  const closedAt = await ShiftModel.now();
  const endIds = await ShiftModel.lastIds();
  const m = await ShiftModel.movements(shift.user_id, JSON.parse(shift.start_ids), endIds, shift.id);
  const expected = expectedCash(shift.opening_float_cents, m);
  const difference = counted - expected;
  await ShiftModel.close(shift.id, { closedAt, closedBy: actor.id, endIds, expected, counted, difference, summary: { ...m, expected_cash: expected }, note });
  await audit.record(actor, 'shift.closed', 'shift', shift.id, {
    ...(shift.user_id !== actor.id ? { cashier: shift.username } : {}),
    expected_cents: expected,
    counted_cents: counted,
    difference_cents: difference,
    note,
  });
  return view(actor, await ShiftModel.findById(shift.id));
}

// Your own shift.
const close = (actor, input) =>
  transaction(async () => {
    const shift = await ShiftModel.findOpenForUser(actor.id);
    if (!shift) throw bad('You have no open shift');
    return closeOpenShift(actor, shift, input);
  });

// Admins: anyone's open shift (e.g. a cashier who left without closing). The admin counts that drawer.
const closeFor = (actor, id, input) =>
  transaction(async () => {
    const shift = await ShiftModel.findById(id);
    if (!shift) throw notFound('Shift not found');
    if (shift.status !== 'open') throw bad('This shift is already closed');
    return closeOpenShift(actor, shift, input);
  });

// Accounting sees every shift; anyone else only their own.
async function report(actor, id) {
  const shift = await ShiftModel.findById(id);
  if (!shift) throw notFound('Shift not found');
  if (shift.user_id !== actor.id && !can(actor, 'accounting')) throw forbidden('You can only see your own shifts');
  return view(actor, shift);
}

// Shifts in a period. Each row has its sales; open shifts show their figures so far (the expected
// cash only for Accounting, as on the shift itself).
async function list(actor, { from, to }) {
  const all = can(actor, 'accounting');
  const rows = await ShiftModel.list({ from, to, userId: all ? null : actor.id });
  const now = rows.some((r) => r.status === 'open') ? await ShiftModel.lastIds() : null;
  const out = [];
  for (const { summary, start_ids, end_ids, ...s } of rows) {
    if (s.status === 'closed') {
      const m = JSON.parse(summary || '{}');
      out.push({ ...s, sales_count: m.sales_count || 0, sales_total: m.sales_total || 0 });
      continue;
    }
    const m = await ShiftModel.movements(s.user_id, JSON.parse(start_ids), now, s.id);
    out.push({ ...s, sales_count: m.sales_count, sales_total: m.sales_total, ...(all ? { expected_so_far: expectedCash(s.opening_float_cents, m) } : {}) });
  }
  return out;
}

module.exports = { current, open, close, closeFor, report, list, expectedCash };
