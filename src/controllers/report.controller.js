// Accounting: reports, expenses, the dashboard and file exports.
const reports = require('../services/report.service');
const expenses = require('../services/expense.service');
const exportService = require('../services/export.service');
const { id, dateRange, reason } = require('../validators/common.validator');
const { readExpense } = require('../validators/admin.validator');
const { readExportDoc } = require('../validators/export.validator');
const { sendDownload, sendCsv, XLSX_TYPE } = require('../utils/http');

module.exports = {
  dashboard: ({ user }) => reports.dashboard(user),
  profitAndLoss: ({ query }) => {
    const { from, to } = dateRange(query);
    return reports.profitAndLoss(from, to);
  },

  listExpenses: ({ query }) => expenses.list(dateRange(query)),
  createExpense: ({ actor, body }) => expenses.create(actor, readExpense(body)),
  reverseExpense: ({ actor, params, body }) => expenses.reverse(actor, id(params.id), reason(body.reason)),

  // Whatever page the user is looking at, as a file.
  exportPdf: async ({ body, res }) => {
    const { data, filename } = await exportService.pagePdf(readExportDoc(body));
    sendDownload(res, data, 'application/pdf', filename);
  },
  exportXlsx: async ({ body, res }) => {
    const { data, filename } = await exportService.pageXlsx(readExportDoc(body));
    sendDownload(res, data, XLSX_TYPE, filename);
  },
  exportCsv: async ({ params, query, res }) => {
    const { from, to } = dateRange(query);
    const { data, filename } = await exportService.accountingCsv(params.name, from, to);
    sendCsv(res, data, filename);
  },
};
