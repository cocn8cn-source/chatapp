// Legacy geometric icon generator. The shipped icons are built from the supplied 3D brand
// render by scripts/build-brand-assets.mjs; running this file overwrites them with the old
// flat mark, so only use it if you deliberately want that artwork back.
// Run: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

const YELLOW = [255, 208, 0];
const CHARCOAL = [29, 29, 29];
const IVORY = [250, 249, 240];
const MINT = [57, 201, 136];
const PINK = [240, 181, 208];

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
function png(width, height, rgba) {
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

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || y < y0 || x > x1 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function insideTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function draw(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = maskable ? 0.82 : 1; // maskable content sits inside the safe zone
  const ox = (1 - s) / 2, oy = (1 - s) / 2;
  const bx0 = (0.17 + ox * 0.7) * size, bx1 = (0.83 - ox * 0.7) * size;
  const by0 = (0.24 + oy * 0.7) * size, by1 = (0.7 - oy * 0.7) * size;
  const radius = (bx1 - bx0) * 0.23;
  const dots = [0.37, 0.5, 0.63].map((p) => ({ x: (0.17 + (0.66 * p)) * size, y: (0.24 + 0.23) * size }));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      let color = YELLOW;
      // soft geometric accent behind the bubble
      const dx = px - size * 0.78, dy = py - size * 0.23;
      if (dx * dx + dy * dy < (size * 0.085) ** 2) color = MINT;
      const px2 = px - size * 0.21, py2 = py - size * 0.78;
      if (px2 * px2 + py2 * py2 < (size * 0.06) ** 2) color = PINK;
      const bubble = insideRoundRect(px, py, bx0, by0, bx1, by1, radius)
        || insideTriangle(px, py, bx0 + radius * 0.45, by1 - 2, bx0 + radius * 0.2, by1 + size * 0.11, bx0 + radius * 1.7, by1 - 2);
      if (bubble) color = CHARCOAL;
      for (const d of dots) {
        if ((px - d.x) ** 2 + (py - d.y) ** 2 < (size * 0.033) ** 2) color = IVORY;
      }
      const i = (y * size + x) * 4;
      rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = 255;
    }
  }
  return rgba;
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false], ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true], ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true], ['favicon-32.png', 32, false],
]) {
  writeFileSync(`${OUT}/${name}`, png(size, size, draw(size, maskable)));
  console.log('wrote', `${OUT}/${name}`);
}
