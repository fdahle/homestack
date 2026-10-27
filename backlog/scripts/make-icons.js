// Generates the app icons (bookmark with a check mark) without any image library.
// Run with `npm run icons`; the output is committed in public/.

import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const ACCENT = [180, 83, 42];
const WHITE = [255, 255, 255];
const BOOKMARK = [[0.3, 0.2], [0.7, 0.2], [0.7, 0.82], [0.5, 0.68], [0.3, 0.82]];
const CHECK = [[0.4, 0.44], [0.48, 0.52], [0.61, 0.37]];
const CHECK_WIDTH = 0.06;

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(x, y, [ax, ay], [bx, by]) {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
}

function inRoundedSquare(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

// Returns [r, g, b, a] for a point in the unit square.
function sample(x, y, { maskable }) {
  if (!maskable && !inRoundedSquare(x, y, 0.22)) return [0, 0, 0, 0];
  // Maskable icons get cropped to a circle, so shrink the glyph into the safe zone
  const s = maskable ? 0.8 : 1;
  const gx = (x - 0.5) / s + 0.5;
  const gy = (y - 0.5) / s + 0.5;
  const onCheck = distToSegment(gx, gy, CHECK[0], CHECK[1]) < CHECK_WIDTH / 2 || distToSegment(gx, gy, CHECK[1], CHECK[2]) < CHECK_WIDTH / 2;
  if (inPolygon(gx, gy, BOOKMARK) && !onCheck) return [...WHITE, 255];
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

const out = new URL('../public/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), render(192, {}));
writeFileSync(new URL('icon-512.png', out), render(512, {}));
writeFileSync(new URL('icon-maskable-512.png', out), render(512, { maskable: true }));
// iOS adds its own rounded corners and dislikes transparency
writeFileSync(new URL('icon-180.png', out), render(180, { maskable: true }));

const pts = (p) => p.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
writeFileSync(
  new URL('icon.svg', out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="rgb(${ACCENT})"/><polygon points="${pts(BOOKMARK)}" fill="#fff"/><polyline points="${pts(CHECK)}" fill="none" stroke="rgb(${ACCENT})" stroke-width="${CHECK_WIDTH * 100}" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`,
);
console.log('icons written to public/');
