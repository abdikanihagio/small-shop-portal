const c = require('../controllers/party.controller');

module.exports = (route) => {
  route('GET', '/api/customers', 'perm:sell|customers.manage', c.listCustomers);
  route('GET', '/api/customers/:id', 'perm:customers.manage', c.getCustomer);
  route('POST', '/api/customers', 'perm:customers.manage', c.createCustomer);
  route('PUT', '/api/customers/:id', 'perm:customers.manage', c.updateCustomer);
  route('POST', '/api/customers/:id/payments', 'perm:customers.manage', c.customerPayment);
  route('POST', '/api/customers/:id/payments/:pid/reverse', 'perm:customers.manage', c.reverseCustomerPayment);
  route('GET', '/api/customers/:id/statement', 'perm:customers.manage', c.customerStatement);
  route('GET', '/api/customers/:id/statement.csv', 'perm:customers.manage', c.customerStatementCsv);

  route('GET', '/api/suppliers', 'perm:suppliers.manage|inventory.manage', c.listSuppliers);
  route('GET', '/api/suppliers/:id', 'perm:suppliers.manage', c.getSupplier);
  route('POST', '/api/suppliers', 'perm:suppliers.manage', c.createSupplier);
  route('PUT', '/api/suppliers/:id', 'perm:suppliers.manage', c.updateSupplier);
  route('POST', '/api/suppliers/:id/payments', 'perm:suppliers.manage', c.supplierPayment);
  route('POST', '/api/suppliers/:id/payments/:pid/reverse', 'perm:suppliers.manage', c.reverseSupplierPayment);
  route('GET', '/api/suppliers/:id/statement', 'perm:suppliers.manage', c.supplierStatement);
  route('GET', '/api/suppliers/:id/statement.csv', 'perm:suppliers.manage', c.supplierStatementCsv);
};
