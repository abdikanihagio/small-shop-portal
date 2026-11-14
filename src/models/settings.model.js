const { db } = require('../config/database');
const { PAYMENT_REFS } = require('../config/constants');
const { formatRef } = require('../utils/refs');

const SettingsModel = {
  // Keys starting seq_ / sys_ are internal counters and flags; they are never sent to the browser.
  all() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.filter((r) => !/^(seq|sys)_/.test(r.key)).map((r) => [r.key, r.value]));
  },

  set(key, value) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
  },

  // Takes the next reference number (CUST004, RET012…); call inside a transaction.
  nextRef(table) {
    const { counter, prefix } = PAYMENT_REFS.find((r) => r.table === table);
    db.prepare('UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = ?').run(counter);
    return formatRef(prefix, Number(db.prepare('SELECT value FROM settings WHERE key = ?').get(counter).value));
  },
};

module.exports = SettingsModel;
