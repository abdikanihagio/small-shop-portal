const SettingsModel = require('../models/settings.model');
const audit = require('./audit.service');
const { transaction } = require('../config/database');
const { checkNewPassword } = require('../validators/password.validator');

const get = () => SettingsModel.all();
const shopName = async () => (await SettingsModel.all()).shop_name;

// changes: already-validated { key: value } (see validators/admin.validator readSettings).
const update = (actor, changes) =>
  transaction(async () => {
    const before = await get();
    for (const [key, value] of Object.entries(changes)) await SettingsModel.set(key, value);
    const after = await get();
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    if (changed.length) await audit.record(actor, 'settings.updated', 'settings', '', Object.fromEntries(changed.map((k) => [k, { from: before[k], to: after[k] }])));
    return after;
  });

// Password rules also refuse the shop's own name. Returns the password.
const checkPassword = async (password, username, name) => checkNewPassword(password, { username, shopName: name ?? (await shopName()) });

module.exports = { get, shopName, update, checkPassword };
