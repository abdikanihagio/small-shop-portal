// Small Shop Portal — starts the web server. The application itself lives in src/ (see src/app.js).
const http = require('node:http');
const https = require('node:https');
const { PORT, HOST } = require('./src/config/environment');
const { tlsOptions, useTls } = require('./src/config/tls');
const { initDatabase, closeDatabase } = require('./src/config/database');
const { createApp } = require('./src/app');

const app = createApp();
const server = useTls ? https.createServer(tlsOptions, app) : http.createServer(app);

// Connect to PostgreSQL (and create or update the tables) before accepting requests.
initDatabase().then(
  () =>
    server.listen(PORT, HOST, () => {
      console.log(`Small Shop Portal running at ${useTls ? 'https' : 'http'}://localhost:${PORT}`);
      if (!useTls) console.log('Note: not using HTTPS. Run scripts\\create-https-cert.ps1 to encrypt connections from other devices.');
      if (HOST) console.log(`Only accepting connections on ${HOST}`);
    }),
  (err) => {
    console.error(err.message);
    process.exit(1);
  }
);

// Stop cleanly (Ctrl+C or a service manager): finish with the database before exiting.
async function shutdown() {
  server.close();
  server.closeAllConnections();
  await closeDatabase();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
