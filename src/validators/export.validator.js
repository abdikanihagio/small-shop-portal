const { bad } = require('../utils/http-error');

// The page sends what it shows: { title, subtitle, sections: [{ title, columns: [{label, align}],
// rows: [[{ text, v?, dp? }]], bold?: [rowIndex] }] }. Numbers (v) stay numbers in Excel.
// Everything is clipped so one request can't build an enormous file.
function readExportDoc(body) {
  if (!body || !Array.isArray(body.sections)) throw bad('Nothing to export');
  const clip = (s, n) => String(s ?? '').slice(0, n);
  return {
    title: clip(body.title, 120) || 'Report',
    subtitle: clip(body.subtitle, 200),
    sections: body.sections.slice(0, 20).map((s) => ({
      title: clip(s.title, 120),
      columns: (s.columns || []).slice(0, 20).map((c) => ({ label: clip(c.label, 80), align: c.align === 'right' ? 'right' : 'left' })),
      rows: (s.rows || []).slice(0, 20000).map((r) => (r || []).slice(0, 20).map((c) => (c && typeof c === 'object' ? c : { text: c }))),
      bold: Array.isArray(s.bold) ? s.bold : [],
    })),
  };
}

module.exports = { readExportDoc };
