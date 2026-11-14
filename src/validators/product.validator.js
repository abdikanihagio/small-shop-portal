const { MAX_QTY } = require('../config/constants');
const { str, int, money } = require('./common.validator');

function readProduct(body) {
  return {
    sku: str(body.sku, 'SKU', { required: true, max: 50 }),
    name: str(body.name, 'Name', { required: true }),
    category: str(body.category, 'Category', { max: 80 }),
    unit: str(body.unit, 'Unit', { max: 20 }) || 'pcs',
    cost_cents: money(body.cost, 'Cost'),
    price_cents: money(body.price, 'Price'),
    reorder_level: int(body.reorder_level ?? 0, 'Reorder level', { min: 0, max: MAX_QTY }),
  };
}

const readOpeningStock = (body) => int(body.stock ?? 0, 'Opening stock', { min: 0, max: MAX_QTY });

module.exports = { readProduct, readOpeningStock };
