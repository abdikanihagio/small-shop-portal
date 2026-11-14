// Profit & loss, cash flow and the dashboard.
const ReportModel = require('../models/report.model');
const ProductModel = require('../models/product.model');
const CustomerModel = require('../models/customer.model');
const SupplierModel = require('../models/supplier.model');
const { can } = require('../config/permissions');
const { today, monthStart } = require('../utils/dates');

// Net sales exclude tax; credit sales count as revenue when made but as cash only when paid;
// buying stock is not an expense (it becomes cost of goods when sold).
function profitAndLoss(from, to) {
  const s = ReportModel.salesTotals(from, to);
  const expenses = ReportModel.expensesByCategory(from, to);
  const purchases = ReportModel.stockPaidOnDelivery(from, to);
  const creditSales = ReportModel.creditSales(from, to);
  const customerPayments = ReportModel.customerPayments(from, to);
  const supplierPayments = ReportModel.supplierPayments(from, to);
  const shrinkage = ReportModel.adjustmentLosses(from, to);
  const ret = ReportModel.returnTotals(from, to);

  const salesCash = s.collected - creditSales;
  const netSales = s.gross_sales - s.discounts - ret.net;
  const cogs = s.cogs - ret.cogs;
  const grossProfit = netSales - cogs;
  const losses = shrinkage + ret.written_off;
  const totalExpenses = expenses.reduce((a, e) => a + e.amount, 0);
  return {
    from,
    to,
    sales_count: s.count,
    gross_sales: s.gross_sales,
    discounts: s.discounts,
    returns: ret.net,
    returns_count: ret.count,
    net_sales: netSales,
    cogs,
    gross_profit: grossProfit,
    gross_margin: netSales ? grossProfit / netSales : 0,
    inventory_adjustments: shrinkage,
    returns_written_off: ret.written_off,
    expenses,
    total_expenses: totalExpenses,
    net_profit: grossProfit - losses - totalExpenses,
    tax_collected: s.tax - ret.tax,
    cash: {
      sales_collected: salesCash,
      refunds_paid: ret.refunds_paid,
      credit_sales: creditSales,
      returns_to_accounts: ret.to_accounts,
      customer_payments: customerPayments,
      by_method: ReportModel.salesByMethod(from, to),
      inventory_purchases: purchases,
      credit_purchases: ReportModel.creditPurchases(from, to),
      supplier_payments: supplierPayments,
      expenses_paid: totalExpenses,
      net: salesCash - ret.refunds_paid + customerPayments - purchases - supplierPayments - totalExpenses,
    },
    receivables: CustomerModel.totalReceivables(),
    payables: SupplierModel.totalPayables(),
  };
}

// Month figures need "accounting"; stock value needs "costs.view".
function dashboard(user) {
  const t = today();
  const todayStats = ReportModel.salesOnDay(t);
  todayStats.refunds = ReportModel.refundsOnDay(t);
  const inv = ProductModel.stockSummary();
  const out = {
    today: todayStats,
    daily: ReportModel.dailySales30(t),
    low_stock: ProductModel.lowStock(),
    recent: ReportModel.recentSales(),
    top_products: ReportModel.topProductsSince(monthStart()),
    product_count: inv.products,
  };
  if (can(user, 'accounting')) out.month = profitAndLoss(monthStart(), t);
  if (can(user, 'costs.view')) out.inventory_value = inv.value;
  return out;
}

module.exports = { profitAndLoss, dashboard };
