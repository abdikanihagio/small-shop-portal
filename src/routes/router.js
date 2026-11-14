// A small router: method + path pattern (with :params) + access rule + controller.
const { isValidAccess } = require('../middleware/authorize');
const { HttpError, bad } = require('../utils/http-error');

class Router {
  constructor() {
    this.routes = [];
    this.route = this.route.bind(this);
  }

  // opts.raw: the controller gets the request body as a Buffer (file uploads) instead of parsed JSON.
  route(method, pattern, access, handler, opts = {}) {
    if (!isValidAccess(access)) throw new Error(`Bad access rule "${access}" on ${method} ${pattern}`);
    if (typeof handler !== 'function') throw new Error(`No controller for ${method} ${pattern}`);
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    this.routes.push({ method, pattern, re, keys, access, handler, raw: !!opts.raw });
  }

  // The matching route and its decoded :params, or a 404.
  match(method, pathname) {
    const route = this.routes.find((r) => r.method === method && r.re.test(pathname));
    if (!route) throw new HttpError(404, 'Not found');
    const m = pathname.match(route.re);
    try {
      return { route, params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    } catch {
      throw bad('Invalid address');
    }
  }
}

module.exports = { Router };
