const c = require('../controllers/sale.controller');

module.exports = (route) => {
  route('GET', '/api/sales', 'perm:sales.view', c.list);
  route('GET', '/api/sales/:id', 'perm:sales.view|sell|customers.manage|inventory.view', c.get);
  route('POST', '/api/sales', 'perm:sell', c.create);
  route('POST', '/api/sales/:id/void', 'perm:sales.refund', c.void);
  route('POST', '/api/sales/:id/returns', 'perm:sales.refund', c.createReturn);
};
