// Last resort if someone lost both their phone and their recovery codes.
// Run ON THE SHOP COMPUTER, from the "Small shop" folder:
//     node scripts\reset-2fa.js <username>
// It switches off two-step login for that account and signs it out everywhere.
// Anyone who can run this already has the shop computer and its data folder, so it adds no new risk.
// The reset is recorded in the Activity log.
const UserModel = require('../src/models/user.model');
const sessions = require('../src/services/session.service');
const audit = require('../src/services/audit.service');

const username = process.argv[2];
if (!username) {
  console.log('Usage: node scripts\\reset-2fa.js <username>');
  const rows = UserModel.listWithTwoStep();
  console.log(rows.length ? 'Accounts with two-step login: ' + rows.map((r) => `${r.username} (${r.role})`).join(', ') : 'No accounts have two-step login on.');
  process.exit(1);
}

const user = UserModel.findByUsername(username);
if (!user) {
  console.error(`No user called "${username}".`);
  process.exit(1);
}
if (!user.totp_enabled) {
  console.log(`Two-step login is already off for ${user.username}.`);
  process.exit(0);
}

UserModel.clearTwoStep(user.id);
const signedOut = sessions.revokeAll(user.id);
audit.record({ username: '(shop computer)', ip: 'local' }, '2fa.reset_on_computer', 'user', user.id, {
  username: user.username,
  sessions_signed_out: signedOut,
});
console.log(`Two-step login switched off for ${user.username}. They can sign in with their password and set it up again in Settings.`);
