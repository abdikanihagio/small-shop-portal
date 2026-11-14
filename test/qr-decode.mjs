// Independent QR decoder used only by the tests, to prove lib/qr.js produces valid symbols.
// Written from the ISO/IEC 18004 rules (format info, masks, module order, block layout),
// not from the encoder's code. Supports what the encoder produces: versions 1–6, ECC M/L, byte mode.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _internal } = require('../lib/qr.js');

const BLOCKS = { M: [null, [1, 10], [1, 16], [1, 26], [2, 18], [2, 24], [4, 16]], L: [null, [1, 7], [1, 10], [1, 15], [1, 20], [1, 26], [2, 18]] };
const TOTAL = [null, 26, 44, 70, 100, 134, 172];
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function bchValid(fifteen) {
  let v = fifteen;
  for (let i = 14; i >= 10; i--) if ((v >>> i) & 1) v ^= 0x537 << (i - 10);
  return v === 0;
}

export function decodeQr(m) {
  const size = m.length;
  const ver = (size - 17) / 4;
  if (!Number.isInteger(ver) || ver < 1 || ver > 6) throw new Error('unsupported size');
  const dark = (r, c) => m[r][c]; // r = row (y), c = column (x)

  // Format information, copy 1 (around the top-left finder), most significant bit first.
  const seq1 = [];
  for (let c = 0; c <= 5; c++) seq1.push(dark(8, c));
  seq1.push(dark(8, 7), dark(8, 8), dark(7, 8));
  for (let r = 5; r >= 0; r--) seq1.push(dark(r, 8));
  const raw1 = seq1.reduce((a, b) => (a << 1) | (b ? 1 : 0), 0);
  // Copy 2 (split between top-right and bottom-left).
  const seq2 = [];
  for (let r = size - 1; r >= size - 7; r--) seq2.push(dark(r, 8));
  for (let c = size - 8; c < size; c++) seq2.push(dark(8, c));
  const raw2 = seq2.reduce((a, b) => (a << 1) | (b ? 1 : 0), 0);
  if (raw1 !== raw2) throw new Error('format copies differ');
  const fmt = raw1 ^ 0x5412;
  if (!bchValid(fmt)) throw new Error('format BCH invalid');
  const ecl = { 0: 'M', 1: 'L' }[fmt >>> 13];
  if (!ecl) throw new Error('unexpected ECC level');
  const mask = (fmt >>> 10) & 7;
  if (!dark(4 * ver + 9, 8)) throw new Error('dark module missing');

  // Which modules hold data.
  const align = size - 7;
  const isFn = (r, c) =>
    (r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9) || r === 6 || c === 6 || (ver >= 2 && Math.abs(r - align) <= 2 && Math.abs(c - align) <= 2);

  // Read bits in the standard two-column zig-zag, starting at the bottom right going up.
  const bits = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const r = upward ? size - 1 - k : k;
      for (const c of [col, col - 1]) if (!isFn(r, c)) bits.push(dark(r, c) !== MASKS[mask](r, c));
    }
    upward = !upward;
  }
  const total = TOTAL[ver];
  const cw = [];
  for (let i = 0; i < total; i++) cw.push(bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | (b ? 1 : 0), 0));

  // De-interleave and check every block's error correction.
  const [nb, ecLen] = BLOCKS[ecl][ver];
  const per = (total - nb * ecLen) / nb;
  const data = [];
  const blocks = Array.from({ length: nb }, () => []);
  for (let i = 0; i < per; i++) for (let b = 0; b < nb; b++) blocks[b].push(cw[i * nb + b]);
  const divisor = _internal.rsDivisor(ecLen);
  for (let b = 0; b < nb; b++) {
    const ec = [];
    for (let i = 0; i < ecLen; i++) ec.push(cw[per * nb + i * nb + b]);
    if (_internal.rsRemainder(blocks[b], divisor).join() !== ec.join()) throw new Error(`block ${b} error correction mismatch`);
  }
  for (const blk of blocks) data.push(...blk); // the message is block 1's data, then block 2's, …

  // Byte-mode segment.
  if (data[0] >>> 4 !== 4) throw new Error('not byte mode');
  const len = ((data[0] & 15) << 4) | (data[1] >>> 4);
  const out = [];
  for (let i = 0; i < len; i++) out.push(((data[1 + i] & 15) << 4) | (data[2 + i] >>> 4));
  return { text: Buffer.from(out).toString('utf8'), version: ver, ecl, mask };
}
