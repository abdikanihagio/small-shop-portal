// Waxool admin portal (ad.waxool.com): starts the web server and the monthly invoice schedule.
const http = require('node:http');
const config = require('./src/config');
const { initDatabase, closeDatabase } = require('./src/db');
const { createApp } = require('./src/app');
const billing = require('./src/billing');

const server = http.createServer(createApp());

// Issues monthly invoices whose billing day has come: at start, then every hour.
async function invoiceCheck() {
  try {
    const { created } = await billing.generateDue();
    if (created) console.log(`Issued ${created} monthly invoice(s)`);
  } catch (err) {
    console.error('Monthly invoice check failed:', err.message);
  }
}

initDatabase().then(
  () =>
    server.listen(config.PORT, config.HOST, () => {
      console.log(`Waxool admin portal running at http://localhost:${config.PORT}`);
      if (config.TRUST_PROXY) console.log(`Behind ${config.TRUST_PROXY} HTTPS proxy (TRUST_PROXY): visitors use https`);
      invoiceCheck();
      setInterval(invoiceCheck, config.INVOICE_CHECK_MS).unref();
    }),
  (err) => {
    console.error(err.message);
    process.exit(1);
  }
);

async function shutdown() {
  server.close();
  server.closeAllConnections();
  await closeDatabase();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
