// Profit & loss, cash flow and the dashboard.
const ReportModel = require('../models/report.model');
const ProductModel = require('../models/product.model');
const CustomerModel = require('../models/customer.model');
const SupplierModel = require('../models/supplier.model');
const batches = require('./batch.service');
const { can } = require('../config/permissions');
const { today, monthStart } = require('../utils/dates');

// Net sales exclude tax; credit sales count as revenue when made but as cash only when paid;
// buying stock is not an expense (it becomes cost of goods when sold).
async function profitAndLoss(from, to) {
  const [s, expenses, purchases, creditSales, customerPayments, supplierPayments, shrinkage, ret, byMethod, creditPurchases, receivables, payables] =
    await Promise.all([
      ReportModel.salesTotals(from, to),
      ReportModel.expensesByCategory(from, to),
      ReportModel.stockPaidOnDelivery(from, to),
      ReportModel.creditSales(from, to),
      ReportModel.customerPayments(from, to),
      ReportModel.supplierPayments(from, to),
      ReportModel.adjustmentLosses(from, to),
      ReportModel.returnTotals(from, to),
      ReportModel.salesByMethod(from, to),
      ReportModel.creditPurchases(from, to),
      CustomerModel.totalReceivables(),
      SupplierModel.totalPayables(),
    ]);

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
      by_method: byMethod,
      inventory_purchases: purchases,
      credit_purchases: creditPurchases,
      supplier_payments: supplierPayments,
      expenses_paid: totalExpenses,
      net: salesCash - ret.refunds_paid + customerPayments - purchases - supplierPayments - totalExpenses,
    },
    receivables,
    payables,
  };
}

// Month figures need "accounting"; stock value needs "costs.view".
async function dashboard(user) {
  const t = today();
  const [todayStats, refunds, inv, daily, lowStock, recent, topProducts, month, expiring] = await Promise.all([
    ReportModel.salesOnDay(t),
    ReportModel.refundsOnDay(t),
    ProductModel.stockSummary(),
    ReportModel.dailySales30(t),
    ProductModel.lowStock(),
    ReportModel.recentSales(),
    ReportModel.topProductsSince(monthStart()),
    can(user, 'accounting') ? profitAndLoss(monthStart(), t) : null,
    batches.expiringSummary(),
  ]);
  const out = {
    today: { ...todayStats, refunds },
    daily,
    low_stock: lowStock,
    recent,
    top_products: topProducts,
    product_count: inv.products,
    expiring,
  };
  if (month) out.month = month;
  if (can(user, 'costs.view')) out.inventory_value = inv.value;
  return out;
}

module.exports = { profitAndLoss, dashboard };
