const c = require('../controllers/product.controller');

module.exports = (route) => {
  route('GET', '/api/products', 'user', c.list);
  route('POST', '/api/products', 'perm:products.manage', c.create);
  route('PUT', '/api/products/:id', 'perm:products.manage', c.update);
  route('POST', '/api/products/import', 'perm:products.manage', c.importFile, { raw: true });
  route('GET', '/api/products/import-template.xlsx', 'perm:products.manage', c.importTemplate);

  route('GET', '/api/inventory/movements', 'perm:inventory.view|inventory.manage', c.movements);
  route('POST', '/api/inventory/restock', 'perm:inventory.manage', c.restock);
  route('POST', '/api/inventory/adjust', 'perm:inventory.manage', c.adjust);
  route('GET', '/api/purchases/:id', 'perm:suppliers.manage|inventory.manage', c.purchase);
};
