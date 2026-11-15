const { db } = require('../config/database');

const ExpenseModel = {
  list: (from, to) =>
    db.all(
      `SELECT e.*, u.username FROM expenses e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`,
      from, to
    ),

  listForExport: (from, to) => db.all('SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date, id', from, to),

  create: (e, userId) =>
    db.insert(
      'INSERT INTO expenses (date, category, description, amount_cents, payment_method, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      e.date, e.category, e.description, e.amount, e.method, userId
    ),
};

module.exports = ExpenseModel;
