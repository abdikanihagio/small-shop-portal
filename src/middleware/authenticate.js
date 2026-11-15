// Who is making the request: the signed-in user from the session cookie, or null.
const sessions = require('../services/session.service');
const { parseCookies } = require('../utils/http');

const sessionToken = (req) => parseCookies(req).sid || null;

const authenticate = (req) => sessions.userForToken(sessionToken(req)); // a Promise

module.exports = { authenticate, sessionToken };
