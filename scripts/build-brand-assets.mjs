// Turns the two supplied logo renders into web-ready brand assets and app icons.
// No image dependencies: PNG decode (RGBA8, non-interlaced), trim, box downscale,
// alpha compositing and PNG encode are all done with node:zlib.
//
// Run:
//   node scripts/build-brand-assets.mjs "<white emblem.png>" "<black emblem.png>"
//
// Outputs:
//   public/brand/logo-white.png  emblem for dark surfaces (white bubble)
//   public/brand/logo-black.png  emblem for light surfaces (black bubble)
//   public/icons/*.png           favicon, apple touch icon and PWA icons on a charcoal tile
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [whitePath, blackPath] = process.argv.slice(2);
if (!whitePath || !blackPath) {
  console.error('usage: node scripts/build-brand-assets.mjs <white emblem.png> <black emblem.png>');
  process.exit(1);
}

const CHARCOAL = [29, 29, 29];
const MARK_SIZE = 256;

// ── PNG decode ──────────────────────────────────────────────────────────────
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let header;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        depth: data[8], color: data[9], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!header) throw new Error('missing IHDR');
  if (header.depth !== 8 || header.color !== 6 || header.interlace !== 0) {
    throw new Error('expected an 8-bit non-interlaced RGBA PNG');
  }
  const { width: w, height: h } = header;
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const rowLen = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(rowLen);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (rowLen + 1)];
    const row = raw.subarray(y * (rowLen + 1) + 1, (y + 1) * (rowLen + 1));
    const cur = Buffer.alloc(rowLen);
    for (let x = 0; x < rowLen; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let value = row[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad scanline filter ${filter}`);
      cur[x] = value & 255;
    }
    cur.copy(out, y * rowLen);
    prev = cur;
  }
  return { width: w, height: h, data: out };
}

// ── PNG encode ──────────────────────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── trim + square + box downscale ───────────────────────────────────────────
/** Crops fully transparent margins, then centres the artwork on a transparent square. */
function trimSquare(img) {
  const { width, height, data } = img;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('image is fully transparent');
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const side = Math.round(Math.max(w, h) * 1.02); // a hair of breathing room
  const ox = Math.round((side - w) / 2);
  const oy = Math.round((side - h) / 2);
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < h; y++) {
    data.copy(
      out,
      ((y + oy) * side + ox) * 4,
      ((y + minY) * width + minX) * 4,
      ((y + minY) * width + minX + w) * 4,
    );
  }
  return { width: side, height: side, data: out };
}

/** Box filter with premultiplied alpha so edges keep their colour instead of darkening. */
function resize(img, size) {
  const { width: sw, height: sh, data } = img;
  const out = Buffer.alloc(size * size * 4);
  const scaleX = sw / size;
  const scaleY = sh / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          const alpha = data[i + 3];
          r += data[i] * alpha;
          g += data[i + 1] * alpha;
          b += data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round(a / n);
      }
    }
  }
  return { width: size, height: size, data: out };
}

/** Source-over the emblem onto a solid charcoal square. */
function tile(mark, size, scale) {
  const art = resize(mark, Math.max(1, Math.round(size * scale)));
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = CHARCOAL[0]; out[i * 4 + 1] = CHARCOAL[1]; out[i * 4 + 2] = CHARCOAL[2]; out[i * 4 + 3] = 255;
  }
  const offset = Math.round((size - art.width) / 2);
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const s = (y * art.width + x) * 4;
      const alpha = art.data[s + 3] / 255;
      if (!alpha) continue;
      const d = ((y + offset) * size + (x + offset)) * 4;
      out[d] = Math.round(art.data[s] * alpha + out[d] * (1 - alpha));
      out[d + 1] = Math.round(art.data[s + 1] * alpha + out[d + 1] * (1 - alpha));
      out[d + 2] = Math.round(art.data[s + 2] * alpha + out[d + 2] * (1 - alpha));
      out[d + 3] = 255;
    }
  }
  return { width: size, height: size, data: out };
}

// ── build ───────────────────────────────────────────────────────────────────
mkdirSync('public/brand', { recursive: true });
mkdirSync('public/icons', { recursive: true });

const white = trimSquare(decodePng(readFileSync(whitePath)));
const black = trimSquare(decodePng(readFileSync(blackPath)));

for (const [name, mark] of [['logo-white.png', white], ['logo-black.png', black]]) {
  const out = resize(mark, MARK_SIZE);
  writeFileSync(`public/brand/${name}`, encodePng(MARK_SIZE, MARK_SIZE, out.data));
  console.log('wrote', `public/brand/${name}`, `${MARK_SIZE}×${MARK_SIZE}`);
}

// The white emblem on charcoal reads on both light and dark launchers.
for (const [name, size, scale] of [
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  ['icon-maskable-192.png', 192, 0.6],
  ['icon-maskable-512.png', 512, 0.6],
  ['apple-touch-icon.png', 180, 0.72],
  ['favicon-32.png', 32, 0.88],
]) {
  const t = tile(white, size, scale);
  writeFileSync(`public/icons/${name}`, encodePng(size, size, t.data));
  console.log('wrote', `public/icons/${name}`, `${size}×${size}`);
}

console.log('done from', basename(whitePath), '+', basename(blackPath));
