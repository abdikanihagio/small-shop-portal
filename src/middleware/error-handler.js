// The one place errors become responses. Expected errors (HttpError) send their message; anything
// else is logged here and the browser only sees "Something went wrong".
const { HttpError } = require('../utils/http-error');
const { sendJson } = require('../utils/http');

function handleError(err, req, res) {
  if (!(err instanceof HttpError)) console.error(err);
  if (res.headersSent) return;
  sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong' }, err.headers);
}

module.exports = { handleError };
