// Products, product import, and stock (inventory).
const products = require('../services/product.service');
const productImport = require('../services/product-import.service');
const inventory = require('../services/inventory.service');
const batches = require('../services/batch.service');
const { id, int, str } = require('../validators/common.validator');
const { readProduct, readOpeningStock } = require('../validators/product.validator');
const { readRestock, readAdjustment } = require('../validators/inventory.validator');
const { sendDownload, XLSX_TYPE } = require('../utils/http');

module.exports = {
  list: ({ user, query }) => products.list(user, { includeInactive: query.get('all') === '1' }),
  create: ({ actor, body }) => products.create(actor, readProduct(body), readOpeningStock(body)),
  update: ({ actor, params, body }) => products.update(actor, id(params.id), readProduct(body), body.active !== false),

  // The file arrives as the raw request body (application/octet-stream).
  importFile: ({ actor, body, query }) =>
    productImport.importProducts(actor, body, {
      filename: query.get('filename') || '',
      updateExisting: query.get('update') === '1',
      commit: query.get('commit') === '1',
    }),
  importTemplate: ({ res }) => sendDownload(res, productImport.templateXlsx(), XLSX_TYPE, 'product-import-template.xlsx'),

  movements: ({ user, query }) =>
    inventory.movements(user, {
      limit: query.get('limit') ? int(query.get('limit'), 'limit', { min: 1, max: 1000 }) : 200,
      productId: query.get('product_id') ? int(query.get('product_id'), 'product_id') : null,
    }),
  restock: ({ actor, body }) => inventory.receive(actor, readRestock(body)),
  adjust: ({ actor, body }) => inventory.adjust(actor, readAdjustment(body)),
  purchase: ({ params }) => inventory.purchase(id(params.id)),
  batches: ({ user }) => batches.list(user),
  writeOffBatch: ({ actor, params, body }) => batches.writeOff(actor, id(params.id), str(body.reason, 'Reason', { max: 120 }) || 'Expired'),
};
