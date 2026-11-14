// Small PDF generator for report pages: a title block followed by tables.
// Uses the built-in Helvetica fonts, so no font files are embedded.
//
// doc = { title, subtitle, shop, generated,
//         sections: [{ title, columns: [{ label, align: 'left'|'right' }], rows: [[text]], bold?: [rowIndex] }] }

// Helvetica / Helvetica-Bold character widths (per 1000 units) for ASCII 32..126.
// prettier-ignore
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// prettier-ignore
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

// Unicode → WinAnsiEncoding byte for characters outside Latin-1.
const WIN_ANSI = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‹': 0x8b, '›': 0x9b, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };
const SUBSTITUTE = { '−': '-', '›': '>', '‹': '<', ' ': ' ', ' ': ' ' };

function toCodes(text) {
  const out = [];
  for (let ch of String(text ?? '')) {
    ch = SUBSTITUTE[ch] ?? ch;
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp <= 126) out.push(cp);
    else if (WIN_ANSI[ch]) out.push(WIN_ANSI[ch]);
    else if (cp >= 0xa0 && cp <= 0xff) out.push(cp);
    else if (cp === 9 || cp === 10) out.push(32);
    else out.push(63); // '?'
  }
  return out;
}

function widthOf(text, size, bold) {
  const table = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const c of toCodes(text)) w += c >= 32 && c <= 126 ? table[c - 32] : c === 0x85 ? 1000 : 556;
  return (w * size) / 1000;
}

function pdfString(text) {
  let s = '(';
  for (const c of toCodes(text)) {
    if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
    else if (c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

// Splits text into lines that fit `width`; long words are broken. At most `max` lines.
function wrap(text, width, size, bold, max = 4) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';
  const push = (l) => lines.push(l);
  for (let word of words) {
    const tryLine = line ? `${line} ${word}` : word;
    if (widthOf(tryLine, size, bold) <= width) {
      line = tryLine;
      continue;
    }
    if (line) push(line);
    line = '';
    while (widthOf(word, size, bold) > width && word.length > 1) {
      let i = word.length - 1;
      while (i > 1 && widthOf(word.slice(0, i), size, bold) > width) i--;
      push(word.slice(0, i));
      word = word.slice(i);
    }
    line = word;
  }
  if (line || !lines.length) push(line);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    let last = kept[max - 1];
    while (last && widthOf(last + '…', size, bold) > width) last = last.slice(0, -1);
    kept[max - 1] = last + '…';
    return kept;
  }
  return lines;
}

const fmt = (n) => (Math.round(n * 100) / 100).toString();

function buildPdf(doc) {
  const sections = (doc.sections || []).filter((s) => s.rows && s.rows.length);
  const maxCols = Math.max(1, ...sections.map((s) => s.columns.length));
  const landscape = maxCols > 6;
  const PW = landscape ? 841.89 : 595.28;
  const PH = landscape ? 595.28 : 841.89;
  const M = 36;
  const avail = PW - 2 * M;
  const FS = 8.5;
  const HFS = 8;
  const LINE = FS + 2.5;
  const PAD_X = 4;
  const PAD_Y = 4;
  const FOOTER = 24;

  const pages = [];
  let ops;
  let y;
  const newPage = () => {
    ops = [];
    pages.push(ops);
    y = PH - M;
  };
  const text = (str, x, yy, size, bold = false, gray = 0) => {
    ops.push(`${gray} g BT /${bold ? 'F2' : 'F1'} ${size} Tf ${fmt(x)} ${fmt(yy)} Td ${pdfString(str)} Tj ET`);
  };
  const rect = (x, yy, w, h, gray) => ops.push(`${gray} g ${fmt(x)} ${fmt(yy)} ${fmt(w)} ${fmt(h)} re f`);
  const hline = (x1, x2, yy, gray = 0.82, w = 0.5) => ops.push(`${gray} G ${w} w ${fmt(x1)} ${fmt(yy)} m ${fmt(x2)} ${fmt(yy)} l S`);

  newPage();
  // Title block
  text(doc.title || 'Report', M, y - 16, 16, true);
  y -= 24;
  const meta = [doc.shop, doc.subtitle].filter(Boolean).join('  ·  ');
  if (meta) {
    text(meta, M, y - 10, 9, false, 0.35);
    y -= 14;
  }
  if (doc.generated) {
    text(`Generated ${doc.generated}`, M, y - 9, 8, false, 0.45);
    y -= 12;
  }
  y -= 8;

  for (const sec of sections) {
    const n = sec.columns.length;
    // Right-aligned (number) columns keep their full width so amounts never break;
    // text columns share the rest, but never get narrower than their longest word.
    const longestWord = (s, bold) => Math.max(0, ...String(s ?? '').split(/\s+/).map((w) => widthOf(w, bold ? HFS : FS, bold)));
    const natural = [];
    const minW = [];
    sec.columns.forEach((c, i) => {
      let w = widthOf(c.label, HFS, true);
      let m = longestWord(c.label, true);
      for (const r of sec.rows) {
        w = Math.max(w, widthOf(r[i], FS, false));
        m = Math.max(m, longestWord(r[i], false));
      }
      natural.push(Math.min(Math.max(w + 2 * PAD_X, 34), 240));
      minW.push(Math.min(Math.max(m + 2 * PAD_X, 34), 160));
    });
    const isNum = sec.columns.map((c) => c.align === 'right');
    const fixed = natural.reduce((a, w, i) => a + (isNum[i] ? w : 0), 0);
    const flexNatural = natural.reduce((a, w, i) => a + (isNum[i] ? 0 : w), 0);
    let widths;
    if (flexNatural > 0 && fixed < avail) {
      const scale = (avail - fixed) / flexNatural;
      widths = natural.map((w, i) => (isNum[i] ? w : Math.max(w * scale, minW[i])));
      const sum = widths.reduce((a, b) => a + b, 0);
      if (sum > avail) widths = widths.map((w) => (w / sum) * avail);
    } else {
      const total = natural.reduce((a, b) => a + b, 0);
      widths = natural.map((w) => (w / total) * avail);
    }
    const xs = widths.reduce((acc, w, i) => (acc.push(i ? acc[i - 1] + widths[i - 1] : M), acc), []);
    const hasHeader = sec.columns.some((c) => c.label);

    const headerHeight = () => {
      const lines = Math.max(...sec.columns.map((c, i) => wrap(c.label, widths[i] - 2 * PAD_X, HFS, true, 2).length));
      return lines * (HFS + 2.5) + 2 * PAD_Y;
    };
    const drawHeader = () => {
      if (!hasHeader) return;
      const h = headerHeight();
      rect(M, y - h, avail, h, 0.9);
      sec.columns.forEach((c, i) => {
        wrap(c.label, widths[i] - 2 * PAD_X, HFS, true, 2).forEach((l, li) => {
          const tx = c.align === 'right' ? xs[i] + widths[i] - PAD_X - widthOf(l, HFS, true) : xs[i] + PAD_X;
          text(l, tx, y - PAD_Y - HFS - li * (HFS + 2.5) + 1, HFS, true, 0.2);
        });
      });
      y -= h;
    };
    const drawTitle = (cont) => {
      if (!sec.title) return;
      text(sec.title + (cont ? ' (continued)' : ''), M, y - 12, 11, true);
      y -= 18;
    };

    // Keep the section title and header with at least one row.
    const firstRowH = 2 * PAD_Y + LINE;
    if (y - (sec.title ? 18 : 0) - (hasHeader ? headerHeight() : 0) - firstRowH < M + FOOTER) newPage();
    drawTitle(false);
    drawHeader();

    sec.rows.forEach((row, ri) => {
      const bold = sec.bold?.includes(ri);
      const cellLines = sec.columns.map((c, i) => wrap(row[i], widths[i] - 2 * PAD_X, FS, bold));
      const h = Math.max(...cellLines.map((l) => l.length)) * LINE + 2 * PAD_Y - 2.5;
      if (y - h < M + FOOTER) {
        newPage();
        drawTitle(true);
        drawHeader();
      }
      if (bold) rect(M, y - h, avail, h, 0.95);
      cellLines.forEach((lines, i) => {
        const align = sec.columns[i].align;
        lines.forEach((l, li) => {
          const tx = align === 'right' ? xs[i] + widths[i] - PAD_X - widthOf(l, FS, bold) : xs[i] + PAD_X;
          text(l, tx, y - PAD_Y - FS - li * LINE + 1.5, FS, bold);
        });
      });
      y -= h;
      hline(M, M + avail, y);
    });
    y -= 16;
  }

  // Footers need the page count, so they are added last.
  const footerLeft = [doc.shop, doc.title].filter(Boolean).join(' · ');
  pages.forEach((p, i) => {
    ops = p;
    hline(M, PW - M, M + 12, 0.75);
    text(footerLeft, M, M, 7.5, false, 0.45);
    const label = `Page ${i + 1} of ${pages.length}`;
    text(label, PW - M - widthOf(label, 7.5, false), M, 7.5, false, 0.45);
  });

  // Assemble objects: 1 catalog, 2 pages, 3-4 fonts, 5 info, then page + content pairs.
  const objs = [];
  const kids = pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objs[5] = `<< /Title ${pdfString(doc.title || 'Report')} /Producer (Small Shop Portal) >>`;
  pages.forEach((p, i) => {
    const pageId = 6 + i * 2;
    const content = p.join('\n');
    objs[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(PW)} ${fmt(PH)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objs[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { buildPdf };
