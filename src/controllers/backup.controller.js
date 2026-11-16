// Backups (admins). Restoring is the owner's alone and must be confirmed by typing RESTORE.
const backups = require('../services/backup.service');
const { sendDownload } = require('../utils/http');
const { bad } = require('../utils/http-error');

module.exports = {
  status: () => backups.status(),
  create: ({ actor }) => backups.create('manual', actor),
  async download({ actor, params, res }) {
    const { data, filename } = await backups.download(actor, params.name);
    sendDownload(res, data, 'application/gzip', filename);
  },
  upload: ({ actor, body }) => backups.upload(actor, body),
  restore({ actor, params, body }) {
    if (body.confirm !== 'RESTORE') throw bad('Type RESTORE to confirm');
    return backups.restore(actor, params.name);
  },
};
