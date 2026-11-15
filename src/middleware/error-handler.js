// The one place errors become responses. Expected errors (HttpError) send their message; anything
// else is logged here and the browser only sees "Something went wrong".
const { HttpError } = require('../utils/http-error');
const { sendJson } = require('../utils/http');

// PostgreSQL error codes that mean the request itself was the problem.
const DB_ERRORS = { 23505: 'This already exists', 23503: 'This is still in use or refers to something that does not exist' };

function handleError(err, req, res) {
  if (!(err instanceof HttpError) && DB_ERRORS[err.code]) err = new HttpError(400, DB_ERRORS[err.code]);
  if (!(err instanceof HttpError)) console.error(err);
  if (res.headersSent) return;
  sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong' }, err.headers);
}

module.exports = { handleError };
