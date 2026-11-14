// HTTPS is used when a certificate is found: TLS_PFX (+ TLS_PASSPHRASE) or TLS_CERT + TLS_KEY,
// or the files created by scripts\create-https-cert.ps1 in data\tls\.
const fs = require('node:fs');
const path = require('node:path');
const env = require('./environment');

function loadTls() {
  const tlsDir = path.join(env.DATA_DIR, 'tls');
  const pfx = env.TLS_PFX || path.join(tlsDir, 'portal.pfx');
  if (fs.existsSync(pfx)) {
    const passFile = path.join(path.dirname(pfx), 'portal-pass.txt');
    const passphrase = env.TLS_PASSPHRASE ?? (fs.existsSync(passFile) ? fs.readFileSync(passFile, 'utf8').trim() : undefined);
    return { pfx: fs.readFileSync(pfx), passphrase };
  }
  const cert = env.TLS_CERT || path.join(tlsDir, 'cert.pem');
  const key = env.TLS_KEY || path.join(tlsDir, 'key.pem');
  if (fs.existsSync(cert) && fs.existsSync(key)) return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
  return null;
}

const tlsOptions = loadTls();

module.exports = { tlsOptions, useTls: !!tlsOptions };
