// Setup, sign-in, sign-out, the current user, own password and two-step login settings.
const auth = require('../services/auth.service');
const twoStep = require('../services/two-step.service');
const settings = require('../services/settings.service');
const sessions = require('../services/session.service');
const { sessionToken } = require('../middleware/authenticate');
const { str } = require('../validators/common.validator');
const { readUsername } = require('../validators/admin.validator');
const { isLocalRequest } = require('../utils/http');
const { setSessionCookie, clearSessionCookie } = require('../utils/session-cookie');

module.exports = {
  setupStatus: async ({ req }) => ({
    needsSetup: await auth.needsSetup(),
    // The owner account can only be created from the shop computer itself.
    setupAllowed: isLocalRequest(req),
  }),

  async setup({ req, res, actor, body }) {
    await auth.assertCanSetUp(isLocalRequest(req));
    const username = readUsername(body.username);
    const password = await settings.checkPassword(body.password, username, body.shop_name || (await settings.shopName()));
    const name = str(body.name, 'Name');
    const shopName = body.shop_name ? str(body.shop_name, 'Shop name') : '';
    const token = await auth.createOwner(actor.ip, { username, name, password, shopName });
    setSessionCookie(res, token);
    return { ok: true };
  },

  async login({ res, actor, body }) {
    const result = await auth.login(actor.ip, str(body.username, 'Username', { max: 50 }), String(body.password ?? ''));
    if (result.ticket) return { two_step: true, ticket: result.ticket };
    setSessionCookie(res, result.token);
    return { ok: true };
  },

  async verifyLogin({ res, actor, body }) {
    const { token, recoveryCodesLeft } = await auth.verifyLogin(actor.ip, String(body.ticket || ''), body.code);
    setSessionCookie(res, token);
    return { ok: true, recovery_codes_left: recoveryCodesLeft };
  },

  async logout({ req, res }) {
    await sessions.end(sessionToken(req));
    clearSessionCookie(res);
    return { ok: true };
  },

  me: async ({ user }) => ({ user, settings: await settings.get() }),

  changePassword: ({ req, actor, body }) => auth.changePassword(actor, String(body.current ?? ''), body.password, sessionToken(req)),
  signOutOtherDevices: ({ req, actor }) => auth.signOutOtherDevices(actor, sessionToken(req)),

  // Two-step login
  twoStepStatus: ({ user }) => twoStep.status(user.id),
  twoStepSetup: ({ actor, body }) => twoStep.beginSetup(actor, body.password),
  twoStepEnable: ({ req, actor, body }) => twoStep.enable(actor, body.code, sessionToken(req)),
  twoStepDisable: ({ actor, body }) => twoStep.disable(actor, body.password, body.code),
  twoStepNewCodes: ({ actor, body }) => twoStep.replaceRecoveryCodes(actor, body.password),
};
