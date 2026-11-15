// Sign-in sessions. The browser holds a random token; the database holds only its hash.
const SessionModel = require('../models/session.model');
const { permissionsFor } = require('../config/permissions');
const { SESSION_DAYS, IDLE_MS, SEEN_EVERY_MS } = require('../config/constants');
const { randomToken, tokenHash } = require('../utils/crypto');

// The signed-in user for a cookie token, with their role's permissions, or null.
async function userForToken(token) {
  if (!token) return null;
  const now = Date.now();
  const hash = tokenHash(token);
  const row = await SessionModel.findUser(hash, now, now - IDLE_MS);
  if (!row) return null;
  if (now - row.last_seen > SEEN_EVERY_MS) await SessionModel.touch(hash, now);
  const { last_seen, role_permissions, ...user } = row;
  user.permissions = permissionsFor(user.role, role_permissions);
  if (user.role === 'admin') user.role_name = 'Admin';
  return user;
}

// Starts a session and returns the token for the cookie.
async function start(userId) {
  const token = randomToken(32);
  const now = Date.now();
  await SessionModel.create(tokenHash(token), userId, now + SESSION_DAYS * 86400000, now);
  return token;
}

const end = async (token) => token && SessionModel.remove(tokenHash(token));
const removeStale = () => SessionModel.removeStale(Date.now(), Date.now() - IDLE_MS);

// Signs a user out everywhere, optionally keeping one session (the one making the request).
const revokeAll = (userId, keepToken = null) => SessionModel.removeForUser(userId, keepToken ? tokenHash(keepToken) : null);

module.exports = { userForToken, start, end, removeStale, revokeAll };
