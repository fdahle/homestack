// Generates the app icons (three friends, one in front) without any image library.
// Run with `npm run icons`; the output is committed in web/public/.

import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const ACCENT = [178, 72, 42];
const WHITE = [255, 255, 255];
// Everyone is cut off flat at the bottom
const BOTTOM = 0.8;
// A person: head (circle) and shoulders (top of an ellipse), in the unit square
const FRONT = { cx: 0.5, head: [0.4, 0.125], body: [0.83, 0.235, 0.215] };
const BACK = [
  { cx: 0.275, head: [0.45, 0.095], body: [0.83, 0.18, 0.17] },
  { cx: 0.725, head: [0.45, 0.095], body: [0.83, 0.18, 0.17] },
];
const GAP = 0.03; // accent-colored space around the one in front

function inPerson(x, y, p, grow = 0) {
  if (y > BOTTOM) return false;
  const [hy, hr] = p.head;
  if (Math.hypot(x - p.cx, y - hy) <= hr + grow) return true;
  const [by, rx, ry] = p.body;
  return ((x - p.cx) / (rx + grow)) ** 2 + ((y - by) / (ry + grow)) ** 2 <= 1;
}

function inRoundedSquare(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// Returns [r, g, b, a] for a point in the unit square.
function sample(x, y, { maskable }) {
  if (!maskable && !inRoundedSquare(x, y, 0.22)) return [0, 0, 0, 0];
  // Maskable icons get cropped to a circle, so shrink the glyph into the safe zone
  const s = maskable ? 0.8 : 1;
  const gx = (x - 0.5) / s + 0.5;
  const gy = (y - 0.5) / s + 0.5;
  if (inPerson(gx, gy, FRONT)) return [...WHITE, 255];
  if (inPerson(gx, gy, FRONT, GAP)) return [...ACCENT, 255];
  if (BACK.some((p) => inPerson(gx, gy, p))) return [...mix(ACCENT, WHITE, 0.72), 255];
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

// The same picture as SVG: back people, an accent outline around the front one, the front one
const n = (v) => Math.round(v * 1000) / 10;
const person = (p, fill, grow = 0) =>
  `<circle cx="${n(p.cx)}" cy="${n(p.head[0])}" r="${n(p.head[1] + grow)}" fill="${fill}"/>`
  + `<ellipse cx="${n(p.cx)}" cy="${n(p.body[0])}" rx="${n(p.body[1] + grow)}" ry="${n(p.body[2] + grow)}" fill="${fill}" clip-path="url(#c)"/>`;
const back = `rgb(${mix(ACCENT, WHITE, 0.72)})`;
writeFileSync(
  new URL('icon.svg', out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><clipPath id="c"><rect width="100" height="${n(BOTTOM)}"/></clipPath>`
  + `<rect width="100" height="100" rx="22" fill="rgb(${ACCENT})"/>${BACK.map((p) => person(p, back)).join('')}`
  + `${person(FRONT, `rgb(${ACCENT})`, GAP)}${person(FRONT, '#fff')}</svg>\n`,
);
console.log('icons written to web/public/');
