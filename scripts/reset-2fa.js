// Last resort if someone lost both their phone and their recovery codes.
// Run ON THE SHOP COMPUTER, from the "Small shop" folder (PostgreSQL must be running):
//     node scripts\reset-2fa.js <username>
// It switches off two-step login for that account and signs it out everywhere.
// Anyone who can run this already has the shop computer and its database settings (.env), so it adds no new risk.
// The reset is recorded in the Activity log.
const { initDatabase, closeDatabase, transaction } = require('../src/config/database');
const UserModel = require('../src/models/user.model');
const sessions = require('../src/services/session.service');
const audit = require('../src/services/audit.service');

async function main(username) {
  if (!username) {
    console.log('Usage: node scripts\\reset-2fa.js <username>');
    const rows = await UserModel.listWithTwoStep();
    console.log(rows.length ? 'Accounts with two-step login: ' + rows.map((r) => `${r.username} (${r.role})`).join(', ') : 'No accounts have two-step login on.');
    return 1;
  }
  const user = await UserModel.findByUsername(username);
  if (!user) {
    console.error(`No user called "${username}".`);
    return 1;
  }
  if (!user.totp_enabled) {
    console.log(`Two-step login is already off for ${user.username}.`);
    return 0;
  }
  await transaction(async () => {
    await UserModel.clearTwoStep(user.id);
    const signedOut = await sessions.revokeAll(user.id);
    await audit.record({ username: '(shop computer)', ip: 'local' }, '2fa.reset_on_computer', 'user', user.id, {
      username: user.username,
      sessions_signed_out: signedOut,
    });
  });
  console.log(`Two-step login switched off for ${user.username}. They can sign in with their password and set it up again in Settings.`);
  return 0;
}

initDatabase()
  .then(() => main(process.argv[2]))
  .then(
    async (code) => {
      await closeDatabase();
      process.exit(code);
    },
    async (err) => {
      console.error(err.message);
      await closeDatabase();
      process.exit(1);
    }
  );
