// The sign-in cookie: HttpOnly (scripts can't read it), SameSite=Strict (not sent by other sites),
// and Secure when visitors use HTTPS (own certificate, or a hosting proxy).
const { httpsForVisitors } = require('../config/tls');
const { SESSION_DAYS } = require('../config/constants');

const cookie = (token, maxAge) => `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${httpsForVisitors ? '; Secure' : ''}`;

const setSessionCookie = (res, token) => res.setHeader('Set-Cookie', cookie(token, SESSION_DAYS * 86400));
const clearSessionCookie = (res) => res.setHeader('Set-Cookie', cookie('', 0));

module.exports = { setSessionCookie, clearSessionCookie };
