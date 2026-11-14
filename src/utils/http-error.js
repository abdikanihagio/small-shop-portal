// An error that maps directly to an HTTP response. Anything else that is thrown becomes a
// generic 500 and is logged, so internal details never reach the browser.
class HttpError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    if (headers) this.headers = headers;
  }
}

const bad = (message) => new HttpError(400, message);
const notFound = (message = 'Not found') => new HttpError(404, message);
const forbidden = (message) => new HttpError(403, message);

module.exports = { HttpError, bad, notFound, forbidden };
