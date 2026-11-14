const ExpenseModel = require('../models/expense.model');
const audit = require('./audit.service');
const ledger = require('./ledger.service');
const { EXPENSE_CATEGORIES } = require('../config/constants');

const list = ({ from, to }) => ({ categories: EXPENSE_CATEGORIES, expenses: ExpenseModel.list(from, to) });

function create(actor, expense) {
  const id = ExpenseModel.create(expense, actor.id);
  audit.record(actor, 'expense.recorded', 'expenses', id, { date: expense.date, category: expense.category, amount_cents: expense.amount });
  return { ok: true };
}

const reverse = (actor, id, reason) => ledger.reverse(actor, 'expenses', id, reason);

module.exports = { list, create, reverse };
