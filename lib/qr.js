// Small QR code generator (byte mode, versions 1–6, error correction M or L) for the two-step
// login setup link. Follows ISO/IEC 18004; structure modelled on Project Nayuki's reference design.
// Returns an SVG string. No dependencies.

// Per version 1..6: [total codewords, ec codewords per block (M), blocks (M), ec per block (L), blocks (L)]
const TABLE = [
  null,
  [26, 10, 1, 7, 1],
  [44, 16, 1, 10, 1],
  [70, 26, 1, 15, 1],
  [100, 18, 2, 20, 1],
  [134, 24, 2, 26, 1],
  [172, 16, 4, 18, 2],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];
const ECL_BITS = { M: 0, L: 1 };

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
  }
  return result;
}

const capacityBytes = (ver, ecl) => {
  const [total, ecM, blkM, ecL, blkL] = TABLE[ver];
  const dataCw = total - (ecl === 'M' ? ecM * blkM : ecL * blkL);
  return Math.floor((dataCw * 8 - 12) / 8); // 4-bit mode + 8-bit length
};

function encode(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  let ver = 0;
  let ecl = 'M';
  for (const e of ['M', 'L']) {
    for (let v = 1; v <= 6 && !ver; v++) if (bytes.length <= capacityBytes(v, e)) (ver = v), (ecl = e);
    if (ver) break;
  }
  if (!ver) throw new Error('Text too long for QR code');

  const [total, ecM, blkM, ecL, blkL] = TABLE[ver];
  const ecLen = ecl === 'M' ? ecM : ecL;
  const blocks = ecl === 'M' ? blkM : blkL;
  const dataCw = total - ecLen * blocks;

  // Data bits: byte mode indicator, length, bytes, terminator, padding.
  const bits = [];
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataCw * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCw; pad ^= 0xec ^ 0x11) data.push(pad);

  // Split into equal blocks, add error correction, interleave.
  const per = dataCw / blocks;
  const divisor = rsDivisor(ecLen);
  const dataBlocks = [];
  const ecBlocks = [];
  for (let b = 0; b < blocks; b++) {
    const d = data.slice(b * per, (b + 1) * per);
    dataBlocks.push(d);
    ecBlocks.push(rsRemainder(d, divisor));
  }
  const codewords = [];
  for (let i = 0; i < per; i++) for (const d of dataBlocks) codewords.push(d[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecBlocks) codewords.push(e[i]);

  // Matrix with function patterns.
  const size = ver * 4 + 17;
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => {
    mod[y][x] = dark;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const al = ALIGN[ver];
  for (let i = 0; i < al.length; i++)
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

  const formatBits = (mask) => {
    const d = (ECL_BITS[ecl] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((d << 10) | rem) ^ 0x5412;
  };
  const drawFormat = (mask) => {
    const b = formatBits(mask);
    const bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6));
    setFn(8, 8, bit(7));
    setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true); // always-dark module
  };
  drawFormat(0); // reserve the format areas

  // Place codewords in the zig-zag order.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) {
          mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
  };
  // Simplified penalty (runs, 2×2 blocks, balance) to pick a mask that scans well.
  const penalty = () => {
    let p = 0;
    for (let pass = 0; pass < 2; pass++)
      for (let a = 0; a < size; a++) {
        let run = 1;
        for (let b = 1; b < size; b++) {
          const cur = pass ? mod[b][a] : mod[a][b];
          const prev = pass ? mod[b - 1][a] : mod[a][b - 1];
          if (cur === prev) run++;
          else {
            if (run >= 5) p += run - 2;
            run = 1;
          }
        }
        if (run >= 5) p += run - 2;
      }
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
      }
    let dark = 0;
    for (const row of mod) for (const v of row) dark += v ? 1 : 0;
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  };
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty();
    if (s < bestScore) (best = m), (bestScore = s);
    applyMask(m); // undo (XOR)
  }
  applyMask(best);
  drawFormat(best);
  return { size, modules: mod, version: ver, ecl, mask: best };
}

function toSvg(text, { scale = 6, quiet = 4 } = {}) {
  const { size, modules } = encode(text);
  const dim = size + quiet * 2;
  let path = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) path += `M${x + quiet},${y + quiet}h1v1h-1z`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim * scale}" height="${dim * scale}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${dim}" height="${dim}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`
  );
}

module.exports = { encode, toSvg, _internal: { rsDivisor, rsRemainder, gfMul } };
