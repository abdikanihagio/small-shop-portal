// Cash closing: open and close your shift, Z-reports, and (Accounting) every shift.
const shifts = require('../services/shift.service');
const { id, str, dateRange, money } = require('../validators/common.validator');

const readCount = (body) => ({ counted: money(body.counted, 'Counted cash'), note: str(body.note, 'Note') });

module.exports = {
  current: ({ actor }) => shifts.current(actor),
  open: ({ actor, body }) => shifts.open(actor, money(body.float ?? 0, 'Opening float')),
  close: ({ actor, body }) => shifts.close(actor, readCount(body)),
  closeFor: ({ actor, params, body }) => shifts.closeFor(actor, id(params.id), readCount(body)),
  list: ({ actor, query }) => shifts.list(actor, dateRange(query)),
  report: ({ actor, params }) => shifts.report(actor, id(params.id)),
};
