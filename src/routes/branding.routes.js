const c = require('../controllers/branding.controller');

module.exports = (route) => {
  route('GET', '/api/branding', 'public', c.status);
  route('GET', '/api/branding/:kind', 'public', c.image);
  route('PUT', '/api/branding/:kind', 'perm:settings.manage', c.upload, { raw: true });
  route('DELETE', '/api/branding/:kind', 'perm:settings.manage', c.remove);
};
