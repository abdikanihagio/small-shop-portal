const { db } = require('../config/database');
const { PAYMENT_REFS, formatRef } = require('../config/constants');

const SettingsModel = {
  // Keys starting seq_ / sys_ are internal counters and flags; they are never sent to the browser.
  async all() {
    const rows = await db.all('SELECT key, value FROM settings');
    return Object.fromEntries(rows.filter((r) => !/^(seq|sys)_/.test(r.key)).map((r) => [r.key, r.value]));
  },

  set: (key, value) => db.run('UPDATE settings SET value = ? WHERE key = ?', value, key),

  // Takes the next reference number (CUST004, RET012…); call inside a transaction.
  async nextRef(table) {
    const { counter, prefix } = PAYMENT_REFS.find((r) => r.table === table);
    const row = await db.get("UPDATE settings SET value = (value::bigint + 1)::text WHERE key = ? RETURNING value", counter);
    return formatRef(prefix, Number(row.value));
  },
};

module.exports = SettingsModel;
