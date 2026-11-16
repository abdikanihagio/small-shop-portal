const c = require('../controllers/backup.controller');

module.exports = (route) => {
  route('GET', '/api/backups', 'admin', c.status);
  route('POST', '/api/backups', 'admin', c.create);
  route('POST', '/api/backups/upload', 'admin', c.upload, { raw: true, maxBody: 300 * 1024 * 1024 });
  route('GET', '/api/backups/:name/download', 'admin', c.download);
  route('POST', '/api/backups/:name/restore', 'admin', c.restore);
};
