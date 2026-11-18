const { MAX_QTY } = require('../config/constants');
const { bad } = require('../utils/http-error');
const { str, int, money } = require('./common.validator');
const { readBatchDate } = require('./inventory.validator');
const { today } = require('../utils/dates');

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

// Optional production and expiry dates of the opening stock (it then becomes an expiry batch).
function readOpeningDates(body, openingStock) {
  const production = readBatchDate(body.production_date, 'Production date');
  const expiry = readBatchDate(body.expiry_date, 'Expiry date');
  if (!production && !expiry) return { production: null, expiry: null };
  if (!openingStock) throw bad('Enter the opening stock that these dates belong to, or leave the dates empty');
  if (!expiry) throw bad('Enter the expiry date too (the production date is kept with it)');
  if (production && production > today()) throw bad('Production date cannot be in the future');
  if (production && expiry <= production) throw bad('Expiry date must be after the production date');
  return { production, expiry };
}

module.exports = { readProduct, readOpeningStock, readOpeningDates };
