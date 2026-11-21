// Generates the app icons (a pile of comics) without any image library.
// Run with `npm run icons`; the output is committed in web/public/.

import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const ACCENT = [47, 95, 168];
const WHITE = [255, 255, 255];
// The pile: [left, top, right, bottom] in the unit square, bottom to top
const BOOKS = [[0.22, 0.62, 0.78, 0.75], [0.18, 0.45, 0.72, 0.58], [0.27, 0.28, 0.81, 0.41]];
const BOOK_RADIUS = 0.025;

function inRoundedRect(x, y, [l, t, r, b], radius) {
  const cx = Math.min(Math.max(x, l + radius), r - radius);
  const cy = Math.min(Math.max(y, t + radius), b - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

const inRoundedSquare = (x, y, r) => inRoundedRect(x, y, [0, 0, 1, 1], r);

// Returns [r, g, b, a] for a point in the unit square.
function sample(x, y, { maskable }) {
  if (!maskable && !inRoundedSquare(x, y, 0.22)) return [0, 0, 0, 0];
  // Maskable icons get cropped to a circle, so shrink the glyph into the safe zone
  const s = maskable ? 0.8 : 1;
  const gx = (x - 0.5) / s + 0.5;
  const gy = (y - 0.5) / s + 0.5;
  if (BOOKS.some((book) => inRoundedRect(gx, gy, book, BOOK_RADIUS))) return [...WHITE, 255];
  return [...ACCENT, 255];
}
function render(size, opts) {
  const SS = 4; // supersampling for smooth edges
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0 + RGBA
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opts);
          acc[0] += c[0] * c[3];
          acc[1] += c[1] * c[3];
          acc[2] += c[2] * c[3];
          acc[3] += c[3];
        }
      }
      const alpha = acc[3] / (SS * SS);
      for (let k = 0; k < 3; k++) row[1 + px * 4 + k] = acc[3] ? Math.round(acc[k] / acc[3]) : 0;
      row[1 + px * 4 + 3] = Math.round(alpha);
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../web/public/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), render(192, {}));
writeFileSync(new URL('icon-512.png', out), render(512, {}));
writeFileSync(new URL('icon-maskable-512.png', out), render(512, { maskable: true }));
// iOS adds its own rounded corners and dislikes transparency
writeFileSync(new URL('icon-180.png', out), render(180, { maskable: true }));

const n = (v) => Math.round(v * 1000) / 10;
const rect = ([l, t, r, b]) => `<rect x="${n(l)}" y="${n(t)}" width="${n(r - l)}" height="${n(b - t)}" rx="${n(BOOK_RADIUS)}" fill="#fff"/>`;
writeFileSync(
  new URL('icon.svg', out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="rgb(${ACCENT})"/>${BOOKS.map(rect).join('')}</svg>\n`,
);
console.log('icons written to web/public/');
