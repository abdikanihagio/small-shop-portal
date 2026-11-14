// Password hashing and sign-in tokens.
const crypto = require('node:crypto');
const { MAX_PASSWORD } = require('../config/constants');

// Hashing runs on Node's thread pool so a burst of logins never freezes the till.
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve({ hash: key.toString('hex'), salt })))
  );
}

async function verifyPassword(password, user) {
  if (password.length > MAX_PASSWORD) return false;
  const { hash } = await hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.password_hash, 'hex'));
}

// Used when a username doesn't exist, so a failed login takes the same time either way
// and response timing doesn't reveal which usernames are real.
const DUMMY_USER = (() => {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, password_hash: crypto.scryptSync(crypto.randomBytes(16), salt, 64).toString('hex') };
})();

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

// The database only ever stores this hash of the token held in the browser cookie.
const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { hashPassword, verifyPassword, DUMMY_USER, randomToken, tokenHash };
