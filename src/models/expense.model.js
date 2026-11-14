const { db } = require('../config/database');

const ExpenseModel = {
  list: (from, to) =>
    db
      .prepare(
        `SELECT e.*, u.username FROM expenses e LEFT JOIN users u ON u.id = e.user_id
         WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`
      )
      .all(from, to),

  listForExport: (from, to) => db.prepare('SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date, id').all(from, to),

  create: (e, userId) =>
    db
      .prepare('INSERT INTO expenses (date, category, description, amount_cents, payment_method, user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(e.date, e.category, e.description, e.amount, e.method, userId).lastInsertRowid,
};

module.exports = ExpenseModel;
