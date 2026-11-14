// CUST001, SUPP012, RET120 … (at least three digits).
const formatRef = (prefix, n) => prefix + String(n).padStart(3, '0');

module.exports = { formatRef };
