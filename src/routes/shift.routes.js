const c = require('../controllers/shift.controller');

module.exports = (route) => {
  route('GET', '/api/shifts/current', 'perm:sell', c.current);
  route('POST', '/api/shifts/open', 'perm:sell', c.open);
  route('POST', '/api/shifts/close', 'perm:sell', c.close);
  route('GET', '/api/shifts', 'perm:sell|accounting|shifts.close', c.list);
  route('GET', '/api/shifts/:id', 'perm:sell|accounting|shifts.close', c.report);
  route('POST', '/api/shifts/:id/close', 'perm:shifts.close', c.closeFor); // close anyone's open shift (admins always can)
};
