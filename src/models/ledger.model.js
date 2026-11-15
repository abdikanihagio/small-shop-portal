// Payments and expenses are never deleted: they are marked reversed and stop counting.
const { db } = require('../config/database');
const { NOW } = require('./schema');

// The only tables that can be reversed, and the account column each belongs to.
const REVERSIBLE = Object.freeze({ customer_payments: 'customer_id', supplier_payments: 'supplier_id', expenses: null });

function assertReversible(table) {
  if (!(table in REVERSIBLE)) throw new Error(`Not a reversible table: ${table}`);
}

const LedgerModel = {
  // ownerId limits the lookup to one customer's or supplier's account.
  findEntry(table, rowId, ownerId = null) {
    assertReversible(table);
    const ownerCol = REVERSIBLE[table];
    return ownerCol
      ? db.get(`SELECT * FROM ${table} WHERE id = ? AND ${ownerCol} = ?`, rowId, ownerId)
      : db.get(`SELECT * FROM ${table} WHERE id = ?`, rowId);
  },

  markReversed(table, rowId, userId, reason) {
    assertReversible(table);
    return db.run(`UPDATE ${table} SET reversed_at = ${NOW}, reversed_by = ?, reverse_reason = ? WHERE id = ?`, userId, reason, rowId);
  },
};

module.exports = LedgerModel;
