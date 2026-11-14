const c = require('../controllers/report.controller');

module.exports = (route) => {
  route('GET', '/api/reports/dashboard', 'user', c.dashboard);
  route('GET', '/api/reports/pl', 'perm:accounting', c.profitAndLoss);

  route('GET', '/api/expenses', 'perm:accounting', c.listExpenses);
  route('POST', '/api/expenses', 'perm:accounting', c.createExpense);
  route('POST', '/api/expenses/:id/reverse', 'perm:accounting', c.reverseExpense);

  // Any page as PDF / Excel (the page sends what it shows), and CSV files for the accountant.
  route('POST', '/api/export/pdf', 'user', c.exportPdf);
  route('POST', '/api/export/xlsx', 'user', c.exportXlsx);
  route('GET', '/api/export/:name', 'perm:accounting', c.exportCsv);
};
