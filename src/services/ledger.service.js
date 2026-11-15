// Customer payments, supplier payments and expenses are never deleted. A mistake is reversed:
// it stays on record, marked with who, when and why, and stops counting in balances and reports.
const LedgerModel = require('../models/ledger.model');
const audit = require('./audit.service');
const { transaction } = require('../config/database');
const { bad, notFound } = require('../utils/http-error');

const reverse = (actor, table, rowId, reason, ownerId = null) =>
  transaction(async () => {
    const row = await LedgerModel.findEntry(table, rowId, ownerId);
    if (!row) throw notFound('Record not found');
    if (row.reversed_at) throw bad('This has already been reversed');
    await LedgerModel.markReversed(table, rowId, actor.id, reason);
    await audit.record(actor, `${table.replace(/s$/, '')}.reversed`, table, rowId, { ref: row.ref, amount_cents: row.amount_cents, reason });
    return { ok: true };
  });

module.exports = { reverse };
