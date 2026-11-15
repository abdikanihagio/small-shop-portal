// Importing many products at once from Excel (.xlsx) or CSV: analyse → preview → commit.
const { readXlsx, writeXlsx } = require('../../lib/xlsx');
const ProductModel = require('../models/product.model');
const StockModel = require('../models/stock.model');
const audit = require('./audit.service');
const visibility = require('./visibility.service');
const { transaction } = require('../config/database');
const { MAX_QTY, MAX_MONEY } = require('../config/constants');
const { parseCsv } = require('../utils/csv');
const { bad } = require('../utils/http-error');

// Header names accepted for each field (compared lowercase with spaces and symbols removed).
const IMPORT_FIELDS = {
  name: ['name', 'product', 'productname', 'item', 'itemname', 'description'],
  sku: ['sku', 'barcode', 'code', 'itemcode', 'productcode', 'skubarcode'],
  category: ['category', 'group', 'type', 'department'],
  unit: ['unit', 'uom', 'units'],
  cost: ['cost', 'costprice', 'buyingprice', 'purchaseprice', 'unitcost', 'buyprice'],
  price: ['price', 'sellingprice', 'saleprice', 'retailprice', 'unitprice', 'sellprice'],
  stock: ['stock', 'openingstock', 'quantity', 'qty', 'instock', 'onhand'],
  reorder_level: ['reorderlevel', 'reorder', 'reorderat', 'minstock', 'minimumstock', 'minqty'],
};
const IMPORT_LABELS = { name: 'Name', sku: 'SKU / barcode', category: 'Category', unit: 'Unit', cost: 'Cost price', price: 'Selling price', stock: 'Opening stock', reorder_level: 'Reorder level' };

// Accepts 12.5, "1,200.50", "$ 3.00"; returns NaN for anything else.
function importNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return s === '' ? NaN : Number(s);
}

function readRows(buf, filename) {
  const isZip = buf.subarray(0, 2).toString() === 'PK';
  if (/\.xls$/i.test(filename) && !isZip) throw bad('This is an old Excel (.xls) file. In Excel choose File → Save As → Excel Workbook (.xlsx), then import that.');
  if (/\.xlsx$/i.test(filename) && !isZip) throw bad('This file is not a valid Excel (.xlsx) file.');
  if (!isZip) return parseCsv(buf.toString('utf8'));
  try {
    return readXlsx(buf);
  } catch (err) {
    throw bad(`Could not read the Excel file: ${err.message}`);
  }
}

// Works out what would happen to each row: new, update, skip or error.
async function analyze(buf, filename, updateExisting) {
  const rows = readRows(buf, filename);
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim() !== ''));
  if (headerIdx < 0) throw bad('The file is empty');
  const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  const header = rows[headerIdx].map(norm);
  const colOf = {};
  for (const [field, names] of Object.entries(IMPORT_FIELDS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) colOf[field] = i;
  }
  if (colOf.name === undefined) throw bad('Could not find a "Name" column. Use the template, or name the first row\'s columns like it.');
  if (colOf.price === undefined) throw bad('Could not find a "Selling price" (or "Price") column.');

  const all = await ProductModel.all();
  const existing = new Map(all.map((p) => [p.sku.toLowerCase(), p]));
  // Rows without a SKU are matched to an existing product by name, so importing the same file twice doesn't duplicate.
  const byName = new Map(all.map((p) => [p.name.trim().toLowerCase(), p]));
  const seen = new Set();
  // Products without a SKU get the next free P0001-style code.
  let autoN = 0;
  const nextSku = () => {
    let s;
    do s = 'P' + String(++autoN).padStart(4, '0');
    while (existing.has(s.toLowerCase()) || seen.has(s.toLowerCase()));
    return s;
  };

  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const raw = rows[r];
    if (!raw || raw.every((c) => String(c ?? '').trim() === '')) continue;
    const get = (f) => (colOf[f] === undefined ? undefined : raw[colOf[f]]);
    const txt = (f) => String(get(f) ?? '').trim();
    const errors = [];
    const num = (f, { int: whole = false } = {}) => {
      if (colOf[f] === undefined || txt(f) === '') return undefined;
      const n = importNumber(get(f));
      if (!Number.isFinite(n) || n < 0) errors.push(`${IMPORT_LABELS[f]} is not a valid number`);
      else if (whole && !Number.isInteger(n)) errors.push(`${IMPORT_LABELS[f]} must be a whole number`);
      else if (n > (whole ? MAX_QTY : MAX_MONEY)) errors.push(`${IMPORT_LABELS[f]} is too large`);
      return n;
    };
    const item = {
      row: r + 1,
      name: txt('name').slice(0, 200),
      sku: txt('sku').slice(0, 50),
      category: txt('category').slice(0, 80),
      unit: txt('unit').slice(0, 20),
      cost: num('cost'),
      price: num('price'),
      stock: num('stock', { int: true }),
      reorder_level: num('reorder_level', { int: true }),
    };
    if (!item.name) errors.push('Name is missing');
    if (item.price === undefined) errors.push('Selling price is missing');
    let skuGenerated = false;
    if (!item.sku) {
      const sameName = item.name && byName.get(item.name.toLowerCase());
      if (sameName) item.sku = sameName.sku;
      else {
        item.sku = nextSku();
        skuGenerated = true;
      }
    }
    const key = item.sku.toLowerCase();
    const match = existing.get(key);
    if (seen.has(key)) errors.push('Same SKU appears earlier in the file');
    seen.add(key);

    let status;
    let note = skuGenerated ? 'SKU created automatically' : '';
    if (errors.length) status = 'error';
    else if (match && !updateExisting) {
      status = 'skip';
      note = 'A product with this SKU already exists';
    } else if (match) {
      status = 'update';
      item.id = match.id;
      if (item.stock !== undefined && item.stock !== match.stock) note = 'Stock not changed (use Inventory to receive or adjust stock)';
    } else status = 'new';
    out.push({ ...item, status, message: errors.join('; ') || note });
  }
  if (!out.length) throw bad('No product rows found under the header row');
  return { columns: Object.keys(colOf), rows: out };
}

// Returns the analysis; when commit is true, also saves new and updated products.
async function importProducts(actor, buf, { filename, updateExisting, commit }) {
  if (!buf.length) throw bad('Choose a file to import');
  const run = async () => {
    const result = await analyze(buf, filename, updateExisting);
    const summary = { new: 0, update: 0, skip: 0, error: 0 };
    for (const r of result.rows) summary[r.status]++;
    return { result, summary };
  };
  if (!commit) {
    const { result, summary } = await run();
    return { ...result, summary };
  }

  const cents100 = (n) => Math.round(n * 100);
  // Analysed again inside the transaction, so it matches the products as they are when saving.
  return transaction(async () => {
    const { result, summary } = await run();
    for (const r of result.rows) {
      if (r.status === 'new') {
        const cost = cents100(r.cost ?? 0);
        const p = { sku: r.sku, name: r.name, category: r.category, unit: r.unit || 'pcs', cost_cents: cost, price_cents: cents100(r.price), reorder_level: r.reorder_level ?? 0 };
        const id = await ProductModel.create(p, r.stock ?? 0);
        if (r.stock > 0) await StockModel.addMovement({ productId: id, type: 'opening', qty: r.stock, unitCost: cost, note: 'Opening stock (import)', userId: actor.id });
      } else if (r.status === 'update') {
        // Only overwrite fields the file actually has values for; stock is left alone.
        const p = await ProductModel.findById(r.id);
        await ProductModel.updateDetails(r.id, {
          name: r.name || p.name,
          category: result.columns.includes('category') && r.category ? r.category : p.category,
          unit: r.unit || p.unit,
          cost_cents: r.cost !== undefined && visibility.seesCosts(actor) ? cents100(r.cost) : p.cost_cents,
          price_cents: r.price !== undefined ? cents100(r.price) : p.price_cents,
          reorder_level: r.reorder_level !== undefined ? r.reorder_level : p.reorder_level,
        });
      }
    }
    await audit.record(actor, 'products.imported', 'product', '', { file: filename, update_existing: updateExisting, ...summary });
    return { ...result, summary, committed: true };
  });
}

function templateXlsx() {
  const h = (v) => ({ v, s: 'header' });
  return writeXlsx([
    {
      name: 'Products',
      widths: [28, 16, 16, 10, 12, 13, 14, 14],
      rows: [
        [h('Name'), h('SKU / Barcode'), h('Category'), h('Unit'), h('Cost price'), h('Selling price'), h('Opening stock'), h('Reorder level')],
        ['Rice 5kg', '6001234567890', 'Food', 'bag', { v: 4.2, s: 'money' }, { v: 6.5, s: 'money' }, 20, 5],
        ['Bath soap', 'SOAP-01', 'Household', 'pcs', { v: 0.5, s: 'money' }, { v: 1.25, s: 'money' }, 48, 12],
      ],
    },
    {
      name: 'How to fill',
      widths: [20, 90],
      rows: [
        [h('Column'), h('What to enter')],
        ['Name', 'Required. Product name as it should appear at the till.'],
        ['SKU / Barcode', 'Optional. Leave empty and a code like P0001 is created. Rows with an existing SKU can update that product.'],
        ['Category', 'Optional, e.g. Food, Drinks, Household.'],
        ['Unit', 'Optional, e.g. pcs, kg, box. Defaults to pcs.'],
        ['Cost price', 'Optional. What you pay the supplier per unit.'],
        ['Selling price', 'Required. Price per unit at the till.'],
        ['Opening stock', 'Optional whole number. Only used for new products.'],
        ['Reorder level', 'Optional whole number. Low-stock alert when stock falls to this.'],
        [''],
        ['Tip', 'Delete the two example rows before importing. Keep the first row (the column names).'],
      ],
    },
  ]);
}

module.exports = { importProducts, templateXlsx };
