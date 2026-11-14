// What each user may see. Screens for roles without "costs.view" never show costs, profit or
// supplier details, so the API removes them before sending (hiding them in the page is not enough).
const { can } = require('../config/permissions');
const { omit, maskPhone } = require('../utils/objects');

const HIDDEN = {
  product: ['cost_cents'],
  sale: ['cogs_cents'],
  saleItem: ['cost_cents'],
  movement: ['unit_cost_cents', 'supplier'],
  return: ['cogs_cents', 'written_off_cents'],
  returnItem: ['cost_cents'],
};

const seesCosts = (user) => can(user, 'costs.view');
const seesCustomers = (user) => can(user, 'customers.manage');

const hide = (kind) => (user, row) => (seesCosts(user) ? row : omit(row, HIDDEN[kind]));
const product = hide('product');
const movement = hide('movement');
const sale = hide('sale');

function saleDetail(user, s) {
  if (seesCosts(user)) return s;
  return {
    ...omit(s, HIDDEN.sale),
    items: s.items.map((i) => omit(i, HIDDEN.saleItem)),
    returns: s.returns.map((r) => ({ ...omit(r, HIDDEN.return), items: r.items.map((i) => omit(i, HIDDEN.returnItem)) })),
  };
}

// The till only needs to pick a customer and check their credit.
function customerListItem(user, c) {
  if (seesCustomers(user)) return c;
  return { id: c.id, name: c.name, phone: maskPhone(c.phone), balance_cents: c.balance_cents, credit_limit_cents: c.credit_limit_cents, active: c.active };
}

module.exports = { seesCosts, seesCustomers, product, movement, sale, saleDetail, customerListItem };
