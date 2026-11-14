// The activity log. "actor" is who did it: { id, username, ip } (any of them may be missing,
// e.g. a failed sign-in has only an ip).
const AuditModel = require('../models/audit.model');

function record(actor, action, entity = '', entityId = '', details = '') {
  AuditModel.insert({
    userId: actor?.id ?? null,
    username: actor?.username ?? '',
    action,
    entity,
    entityId: String(entityId ?? ''),
    details: typeof details === 'string' ? details : JSON.stringify(details),
    ip: actor?.ip ?? '',
  });
}

const list = ({ from, to, action }) => AuditModel.list(from, to, action);

module.exports = { record, list };
