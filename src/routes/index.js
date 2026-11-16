// Every API endpoint, registered on one router.
const { Router } = require('./router');

const ROUTE_FILES = [
  require('./auth.routes'),
  require('./admin.routes'),
  require('./product.routes'),
  require('./sale.routes'),
  require('./party.routes'),
  require('./report.routes'),
  require('./branding.routes'),
  require('./backup.routes'),
  require('./shift.routes'),
];

function buildRouter() {
  const router = new Router();
  for (const register of ROUTE_FILES) register(router.route);
  return router;
}

module.exports = { buildRouter };
