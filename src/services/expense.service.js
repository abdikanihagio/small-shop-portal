const ExpenseModel = require('../models/expense.model');
const audit = require('./audit.service');
const ledger = require('./ledger.service');
const { transaction } = require('../config/database');
const { EXPENSE_CATEGORIES } = require('../config/constants');

const list = async ({ from, to }) => ({ categories: EXPENSE_CATEGORIES, expenses: await ExpenseModel.list(from, to) });

const create = (actor, expense) =>
  transaction(async () => {
    const id = await ExpenseModel.create(expense, actor.id);
    await audit.record(actor, 'expense.recorded', 'expenses', id, { date: expense.date, category: expense.category, amount_cents: expense.amount });
    return { ok: true };
  });

const reverse = (actor, id, reason) => ledger.reverse(actor, 'expenses', id, reason);

module.exports = { list, create, reverse };
