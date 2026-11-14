// What a role can be allowed to do. Admins always have all of these; managing user accounts and
// roles stays admin-only and is not part of any role.
const PERMISSIONS = Object.freeze([
  { key: 'sell', label: 'Make sales at the till', group: 'Sales' },
  { key: 'discount.unlimited', label: 'Give discounts above the staff limit', group: 'Sales' },
  { key: 'sales.view', label: 'See sales history', group: 'Sales' },
  { key: 'sales.refund', label: 'Void sales and return items', group: 'Sales' },
  { key: 'products.view', label: 'See products', group: 'Products & stock' },
  { key: 'products.manage', label: 'Add and edit products, prices and imports', group: 'Products & stock' },
  { key: 'costs.view', label: 'See cost prices, margins and stock value', group: 'Products & stock' },
  { key: 'inventory.view', label: 'See stock levels and stock movements', group: 'Products & stock' },
  { key: 'inventory.manage', label: 'Receive stock and adjust counts', group: 'Products & stock' },
  { key: 'customers.manage', label: 'Customers: accounts, payments, statements', group: 'Customers & suppliers' },
  { key: 'suppliers.manage', label: 'Suppliers: accounts, payments, statements', group: 'Customers & suppliers' },
  { key: 'accounting', label: 'Accounting: profit & loss, cash flow, expenses, exports', group: 'Money & admin' },
  { key: 'activity.view', label: 'See the Activity log', group: 'Money & admin' },
  { key: 'settings.manage', label: 'Change shop settings (name, tax, discount limit)', group: 'Money & admin' },
]);

const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

// The permissions a user actually has: everything for admins, otherwise their role's known permissions.
function permissionsFor(role, rolePermissionsJson) {
  if (role === 'admin') return PERMISSIONS.map((p) => p.key);
  return JSON.parse(rolePermissionsJson || '[]').filter((k) => PERMISSION_KEYS.has(k));
}

const can = (user, perm) => !!user && (user.role === 'admin' || (user.permissions || []).includes(perm));

module.exports = { PERMISSIONS, PERMISSION_KEYS, permissionsFor, can };
