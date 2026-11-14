// Writing CSV files for exports and reading CSV files for product import.

const cents = (c) => (c / 100).toFixed(2);

// columns: [{ label, get: (row) => value }]
function toCsv(rows, columns) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    // Spreadsheets run cells starting with = + - @ (or tab / CR) as formulas, even inside quotes.
    // Prefix them with ' so they show as text; plain numbers such as -5.00 are left alone.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(c.get(r))).join(','))].join('\r\n');
}

// Reads comma, semicolon or tab separated text (whichever the first line uses most).
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = [',', ';', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

// A name that is safe inside a download file name.
const fileSafe = (name, max = 40) => String(name).replace(/[^\w-]+/g, '_').slice(0, max);

module.exports = { cents, toCsv, parseCsv, fileSafe };
