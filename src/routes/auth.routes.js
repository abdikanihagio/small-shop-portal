const c = require('../controllers/auth.controller');

module.exports = (route) => {
  route('GET', '/api/setup', 'public', c.setupStatus);
  route('POST', '/api/setup', 'public', c.setup);
  route('POST', '/api/login', 'public', c.login);
  route('POST', '/api/login/verify', 'public', c.verifyLogin);
  route('POST', '/api/logout', 'public', c.logout);

  route('GET', '/api/me', 'user', c.me);
  route('GET', '/api/billing', 'user', c.billing);
  route('POST', '/api/password', 'user', c.changePassword);
  route('POST', '/api/sessions/revoke-others', 'user', c.signOutOtherDevices);

  route('GET', '/api/2fa', 'user', c.twoStepStatus);
  route('POST', '/api/2fa/setup', 'user', c.twoStepSetup);
  route('POST', '/api/2fa/enable', 'user', c.twoStepEnable);
  route('POST', '/api/2fa/disable', 'user', c.twoStepDisable);
  route('POST', '/api/2fa/recovery-codes', 'user', c.twoStepNewCodes);
};
