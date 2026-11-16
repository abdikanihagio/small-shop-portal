// Backups from the command line, on the shop computer (PostgreSQL must be running):
//     node scripts\backup.js                 make a backup now
//     node scripts\backup.js list            show the backups
//     node scripts\backup.js restore <file>  replace ALL shop data with a backup file
//                                            (for example one copied back from a USB stick)
// The portal makes a backup every day by itself; this is for emergencies and for moving to a new
// computer. A restore first saves a safety backup of the current data, and is recorded in the
// Activity log.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { initDatabase, closeDatabase } = require('../src/config/database');
const backups = require('../src/services/backup.service');

const SHOP_COMPUTER = { username: '(shop computer)', ip: 'local', is_owner: 1 };
const kb = (n) => `${Math.ceil(n / 1024)} KB`;

async function main([command, file]) {
  if (!command) {
    const b = await backups.create('manual', SHOP_COMPUTER);
    console.log(`Backup saved: ${b.name} (${kb(b.size)})`);
    return 0;
  }
  if (command === 'list') {
    const s = await backups.status();
    console.log(`Backups in ${s.folder}:`);
    for (const b of s.backups) console.log(`  ${b.created_at}  ${b.kind.padEnd(14)} ${kb(b.size).padStart(9)}  ${b.name}`);
    if (!s.backups.length) console.log('  (none yet)');
    return 0;
  }
  if (command === 'restore' && file) {
    const source = path.resolve(file);
    if (!fs.existsSync(source)) throw new Error(`No file at ${source}`);
    const buffer = fs.readFileSync(source);
    const doc = await backups.read(buffer); // checks it is a real backup before asking
    console.log(`Backup of "${doc.shop}" made ${new Date(doc.created_at).toLocaleString()}: ${doc.counts?.sales ?? '?'} sales, ${doc.counts?.products ?? '?'} products.`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('This REPLACES ALL current shop data. Type RESTORE to continue: ');
    rl.close();
    if (answer.trim() !== 'RESTORE') {
      console.log('Nothing was changed.');
      return 1;
    }
    const uploaded = await backups.upload(SHOP_COMPUTER, buffer);
    const r = await backups.restore(SHOP_COMPUTER, uploaded.name);
    console.log(`Restored. The data from before was saved first as ${r.safety_backup}.`);
    return 0;
  }
  console.log('Usage: node scripts\\backup.js [list | restore <file>]');
  return 1;
}

initDatabase()
  .then(() => main(process.argv.slice(2)))
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
