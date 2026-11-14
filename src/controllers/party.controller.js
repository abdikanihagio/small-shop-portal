// Customers and suppliers: accounts, payments, statements.
const customers = require('../services/customer.service');
const suppliers = require('../services/supplier.service');
const exportService = require('../services/export.service');
const { id, dateRange, reason } = require('../validators/common.validator');
const { readCustomer, readSupplier, readActive, readPayment } = require('../validators/party.validator');
const { sendCsv } = require('../utils/http');

const includeInactive = (query) => query.get('all') === '1';

module.exports = {
  // Customers
  listCustomers: ({ user, query }) => customers.list(user, { includeInactive: includeInactive(query) }),
  getCustomer: ({ params }) => customers.get(id(params.id)),
  createCustomer: ({ actor, body }) => customers.create(actor, readCustomer(body)),
  updateCustomer: ({ actor, params, body }) => customers.update(actor, id(params.id), readCustomer(body), readActive(body)),
  customerPayment: ({ actor, params, body }) => customers.recordPayment(actor, id(params.id), readPayment(body)),
  reverseCustomerPayment: ({ actor, params, body }) => customers.reversePayment(actor, id(params.id), id(params.pid, 'pid'), reason(body.reason)),
  customerStatement: ({ params, query }) => {
    const { from, to } = dateRange(query, { allTime: true });
    return customers.statement(id(params.id), from, to);
  },
  customerStatementCsv: ({ params, query, res }) => {
    const { from, to } = dateRange(query, { allTime: true });
    const { data, filename } = exportService.customerStatementCsv(customers.statement(id(params.id), from, to));
    sendCsv(res, data, filename);
  },

  // Suppliers
  listSuppliers: ({ query }) => suppliers.list({ includeInactive: includeInactive(query) }),
  getSupplier: ({ params }) => suppliers.get(id(params.id)),
  createSupplier: ({ actor, body }) => suppliers.create(actor, readSupplier(body)),
  updateSupplier: ({ actor, params, body }) => suppliers.update(actor, id(params.id), readSupplier(body), readActive(body)),
  supplierPayment: ({ actor, params, body }) => suppliers.recordPayment(actor, id(params.id), readPayment(body)),
  reverseSupplierPayment: ({ actor, params, body }) => suppliers.reversePayment(actor, id(params.id), id(params.pid, 'pid'), reason(body.reason)),
  supplierStatement: ({ params, query }) => {
    const { from, to } = dateRange(query, { allTime: true });
    return suppliers.statement(id(params.id), from, to);
  },
  supplierStatementCsv: ({ params, query, res }) => {
    const { from, to } = dateRange(query, { allTime: true });
    const { data, filename } = exportService.supplierStatementCsv(suppliers.statement(id(params.id), from, to));
    sendCsv(res, data, filename);
  },
};
