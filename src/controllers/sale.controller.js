const sales = require('../services/sale.service');
const returns = require('../services/return.service');
const { can } = require('../config/permissions');
const { id, dateRange } = require('../validators/common.validator');
const { readSale, readReturn } = require('../validators/sale.validator');

module.exports = {
  list: ({ user, query }) => sales.list(user, dateRange(query)),
  get: ({ user, params }) => sales.get(user, id(params.id)),
  create: ({ actor, body }) => sales.create(actor, readSale(body, { allowPriceOverride: can(actor, 'discount.unlimited') })),
  void: ({ actor, params, body }) => sales.voidSale(actor, id(params.id), body.reason),
  createReturn: ({ actor, params, body }) => returns.createReturn(actor, id(params.id), readReturn(body)),
};
