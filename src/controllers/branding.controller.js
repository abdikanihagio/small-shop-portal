// Logo and icon: anyone may view them (the sign-in page shows them); changing needs "settings.manage".
const branding = require('../services/branding.service');
const { readKind, readImage } = require('../validators/branding.validator');

module.exports = {
  status: () => branding.status(),

  // The browser keeps a copy and asks again each time; unchanged pictures answer 304 (no download).
  image({ req, res, params }) {
    const row = branding.image(readKind(params.kind));
    const etag = `"${row.updated_at.replace(/\D/g, '')}"`;
    const headers = { 'Cache-Control': 'no-cache', ETag: etag };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, { ...headers, 'Content-Type': row.mime, 'Content-Length': row.data.length });
    res.end(Buffer.from(row.data));
  },

  upload: ({ actor, params, body }) => branding.save(actor, readKind(params.kind), readImage(body)),
  remove: ({ actor, params }) => branding.remove(actor, readKind(params.kind)),
};
