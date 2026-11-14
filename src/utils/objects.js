const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

const maskPhone = (p) => (p ? (p.length > 4 ? '•••• ' + p.slice(-4) : '••••') : '');

// Field-by-field changes between a stored row and the new values (for the audit log).
function diff(old, next) {
  const out = { name: old.name };
  for (const [k, v] of Object.entries(next)) if (k in old && old[k] !== v) out[k] = { from: old[k], to: v };
  return out;
}

// New average cost per unit after adding stock at a given unit cost.
function weightedCost(stock, cost, qty, unitCost) {
  const existing = Math.max(stock, 0);
  return existing + qty > 0 ? Math.round((existing * cost + qty * unitCost) / (existing + qty)) : unitCost;
}

module.exports = { omit, maskPhone, diff, weightedCost };
