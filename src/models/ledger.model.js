// Payments and expenses are never deleted: they are marked reversed and stop counting.
const { db } = require('../config/database');

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
      ? db.prepare(`SELECT * FROM ${table} WHERE id = ? AND ${ownerCol} = ?`).get(rowId, ownerId)
      : db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId);
  },

  markReversed(table, rowId, userId, reason) {
    assertReversible(table);
    db.prepare(`UPDATE ${table} SET reversed_at = datetime('now','localtime'), reversed_by = ?, reverse_reason = ? WHERE id = ?`).run(userId, reason, rowId);
  },
};

module.exports = LedgerModel;
