// Files for download: page exports (PDF / Excel), CSV exports for the accountant, statement CSVs.
// Each function returns { data, filename } (plus the content type for page exports).
const { buildPdf } = require('../../lib/pdf');
const { writeXlsx } = require('../../lib/xlsx');
const ReportModel = require('../models/report.model');
const ExpenseModel = require('../models/expense.model');
const ProductModel = require('../models/product.model');
const settings = require('./settings.service');
const { toCsv, cents, fileSafe } = require('../utils/csv');
const { today, nowStamp } = require('../utils/dates');
const { notFound } = require('../utils/http-error');

const exportFilename = (title, ext) => `${title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'report'}-${today()}.${ext}`;

// doc: validated by validators/export.validator readExportDoc.
async function pagePdf(doc) {
  const data = buildPdf({
    title: doc.title,
    subtitle: doc.subtitle,
    shop: await settings.shopName(),
    generated: nowStamp(),
    sections: doc.sections.map((s) => ({ ...s, rows: s.rows.map((r) => r.map((c) => String(c.text ?? ''))) })),
  });
  return { data, filename: exportFilename(doc.title, 'pdf') };
}

async function pageXlsx(doc) {
  const rows = [
    [{ v: doc.title, s: 'title' }],
    [{ v: [await settings.shopName(), doc.subtitle].filter(Boolean).join('  ·  '), s: 'muted' }],
    [{ v: `Generated ${nowStamp()}`, s: 'muted' }],
    [],
  ];
  const widths = [];
  const fit = (i, text) => (widths[i] = Math.min(Math.max(widths[i] || 8, String(text).length + 2), 60));
  for (const sec of doc.sections) {
    if (!sec.rows.length) continue;
    if (sec.title) rows.push([{ v: sec.title, s: 'bold' }]);
    if (sec.columns.some((c) => c.label)) rows.push(sec.columns.map((c, i) => (fit(i, c.label), { v: c.label, s: 'header' })));
    sec.rows.forEach((r, ri) => {
      const bold = sec.bold.includes(ri);
      rows.push(
        r.map((c, i) => {
          // Numbers stay numbers so the accountant can add them up.
          if (typeof c.v === 'number' && Number.isFinite(c.v)) {
            fit(i, c.text ?? c.v);
            return { v: c.v, s: c.dp ? (bold ? 'boldmoney' : 'money') : bold ? 'bold' : 'int' };
          }
          fit(i, c.text ?? '');
          return { v: String(c.text ?? ''), s: bold ? 'bold' : undefined };
        })
      );
    });
    rows.push([]);
  }
  return { data: writeXlsx([{ name: doc.title, rows, widths }]), filename: exportFilename(doc.title, 'xlsx') };
}

// ---- CSV exports for the accountant (Accounting → Export) ----

const CSV_EXPORTS = {
  'sales.csv': async (from, to) =>
    toCsv(await ReportModel.salesForExport(from, to), [
      { label: 'Sale #', get: (r) => r.id },
      { label: 'Date', get: (r) => r.created_at },
      { label: 'Status', get: (r) => r.status },
      { label: 'Customer', get: (r) => r.customer },
      { label: 'Payment', get: (r) => r.payment_method },
      { label: 'Subtotal', get: (r) => cents(r.subtotal_cents) },
      { label: 'Discount', get: (r) => cents(r.discount_cents) },
      { label: 'Discount %', get: (r) => (r.discount_percent == null ? '' : r.discount_percent) },
      { label: 'Tax', get: (r) => cents(r.tax_cents) },
      { label: 'Total', get: (r) => cents(r.total_cents) },
      { label: 'Cost of goods', get: (r) => cents(r.cogs_cents) },
      { label: 'Cashier', get: (r) => r.username },
      { label: 'Refunded (returns)', get: (r) => cents(r.returned_cents || 0) },
    ]),
  'expenses.csv': async (from, to) =>
    toCsv(await ExpenseModel.listForExport(from, to), [
      { label: 'Date', get: (r) => r.date },
      { label: 'Category', get: (r) => r.category },
      { label: 'Description', get: (r) => r.description },
      { label: 'Payment', get: (r) => r.payment_method },
      { label: 'Amount', get: (r) => cents(r.amount_cents) },
      { label: 'Status', get: (r) => (r.reversed_at ? `reversed ${r.reversed_at}: ${r.reverse_reason}` : 'ok') },
    ]),
  'returns.csv': async (from, to) =>
    toCsv(await ReportModel.returnsForExport(from, to), [
      { label: 'Return', get: (r) => r.ref },
      { label: 'Date', get: (r) => r.created_at },
      { label: 'Sale #', get: (r) => r.sale_id },
      { label: 'Customer', get: (r) => r.customer },
      { label: 'Items', get: (r) => r.items },
      { label: 'Refunded by', get: (r) => (r.refund_method === 'credit' ? 'customer account' : r.refund_method) },
      { label: 'Items value', get: (r) => cents(r.subtotal_cents) },
      { label: 'Discount', get: (r) => cents(r.discount_cents) },
      { label: 'Tax', get: (r) => cents(r.tax_cents) },
      { label: 'Refund', get: (r) => cents(r.total_cents) },
      { label: 'Reason', get: (r) => r.reason },
      { label: 'By', get: (r) => r.username },
    ]),
  'products.csv': async () =>
    toCsv(await ProductModel.all(), [
      { label: 'SKU', get: (r) => r.sku },
      { label: 'Name', get: (r) => r.name },
      { label: 'Category', get: (r) => r.category },
      { label: 'Unit', get: (r) => r.unit },
      { label: 'Cost', get: (r) => cents(r.cost_cents) },
      { label: 'Price', get: (r) => cents(r.price_cents) },
      { label: 'Stock', get: (r) => r.stock },
      { label: 'Stock value', get: (r) => cents(Math.max(r.stock, 0) * r.cost_cents) },
      { label: 'Reorder level', get: (r) => r.reorder_level },
      { label: 'Active', get: (r) => (r.active ? 'yes' : 'no') },
    ]),
};

async function accountingCsv(name, from, to) {
  const build = Object.hasOwn(CSV_EXPORTS, name) ? CSV_EXPORTS[name] : null;
  if (!build) throw notFound('Unknown export');
  return { data: await build(from, to), filename: `${name.replace('.csv', '')}-${from}-to-${to}.csv` };
}

// ---- statements ----

function customerStatementCsv(st) {
  const rows = [
    { date: st.from, kind: 'Opening balance', ref: '', description: '', method: '', status: '', charge_cents: 0, paid_cents: 0, balance_cents: st.opening_balance },
    ...st.entries.map((e) => ({ ...e, kind: { sale: 'Sale', payment: 'Payment', return: 'Return' }[e.kind], ref: e.kind === 'sale' ? `Sale #${e.id}` : e.ref })),
  ];
  const data = toCsv(rows, [
    { label: 'Date', get: (r) => r.date },
    { label: 'Type', get: (r) => r.kind },
    { label: 'Reference', get: (r) => r.ref },
    { label: 'Details', get: (r) => r.description },
    { label: 'Payment method', get: (r) => r.method },
    { label: 'Status', get: (r) => r.status },
    { label: 'Charged', get: (r) => cents(r.charge_cents) },
    { label: 'Paid', get: (r) => cents(r.paid_cents) },
    { label: 'Balance owed', get: (r) => cents(r.balance_cents) },
  ]);
  return { data, filename: `statement-${fileSafe(st.customer.name)}-${st.from}-to-${st.to}.csv` };
}

function supplierStatementCsv(st) {
  const rows = [
    { date: st.from, kind: 'Opening balance', ref: '', description: '', method: '', charge_cents: 0, paid_cents: 0, balance_cents: st.opening_balance },
    ...st.entries.map((e) => ({ ...e, kind: e.kind === 'purchase' ? 'Delivery' : 'Payment', ref: e.kind === 'purchase' ? `Delivery #${e.id}` : e.ref })),
  ];
  const data = toCsv(rows, [
    { label: 'Date', get: (r) => r.date },
    { label: 'Type', get: (r) => r.kind },
    { label: 'Reference', get: (r) => r.ref },
    { label: 'Details', get: (r) => r.description },
    { label: 'Payment method', get: (r) => r.method },
    { label: 'Received (value)', get: (r) => cents(r.charge_cents) },
    { label: 'Paid', get: (r) => cents(r.paid_cents) },
    { label: 'Balance owed', get: (r) => cents(r.balance_cents) },
  ]);
  return { data, filename: `supplier-${fileSafe(st.supplier.name)}-${st.from}-to-${st.to}.csv` };
}

module.exports = { pagePdf, pageXlsx, accountingCsv, customerStatementCsv, supplierStatementCsv };
