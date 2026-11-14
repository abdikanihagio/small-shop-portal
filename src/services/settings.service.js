const SettingsModel = require('../models/settings.model');
const audit = require('./audit.service');
const { checkNewPassword } = require('../validators/password.validator');

const get = () => SettingsModel.all();
const shopName = () => SettingsModel.all().shop_name;

// changes: already-validated { key: value } (see validators/admin.validator readSettings).
function update(actor, changes) {
  const before = get();
  for (const [key, value] of Object.entries(changes)) SettingsModel.set(key, value);
  const after = get();
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  if (changed.length) audit.record(actor, 'settings.updated', 'settings', '', Object.fromEntries(changed.map((k) => [k, { from: before[k], to: after[k] }])));
  return after;
}

// Password rules also refuse the shop's own name.
const checkPassword = (password, username, name = shopName()) => checkNewPassword(password, { username, shopName: name });

module.exports = { get, shopName, update, checkPassword };
