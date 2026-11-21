// Copied from design/scripts/icons.js by design/sync.mjs. Change it there, not here.
// Draws a homestack app icon without any image library: a white symbol on a rounded
// square in the app's accent colour. Every app looks alike this way; only the
// colour and the symbol change.
//
// writeIcons({
//   accent: [84, 72, 200],
//   glyph: (x, y) => [r, g, b] | null,   // colour of the symbol at (x, y) in the unit square, null = background
//   svg: '<rect … fill="#fff"/>',         // the same symbol as SVG elements on a 100×100 canvas
//   out: new URL('../web/public/', import.meta.url),
// })
//
// writes icon-192.png, icon-512.png, icon-maskable-512.png, icon-180.png (Apple) and icon.svg.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

export const WHITE = [255, 255, 255];
export const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const RADIUS = 0.22;

function inRoundedSquare(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function render(size, { accent, glyph, maskable }) {
  const SS = 4; // supersampling for smooth edges
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0 + RGBA
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          let c = [0, 0, 0, 0];
          if (maskable || inRoundedSquare(x, y, RADIUS)) {
            // Maskable icons get cropped to a circle, so the symbol shrinks into the safe zone
            const s = maskable ? 0.78 : 1;
            c = [...(glyph((x - 0.5) / s + 0.5, (y - 0.5) / s + 0.5) || accent), 255];
          }
          acc[0] += c[0] * c[3];
          acc[1] += c[1] * c[3];
          acc[2] += c[2] * c[3];
          acc[3] += c[3];
        }
      }
      for (let k = 0; k < 3; k++) row[1 + px * 4 + k] = acc[3] ? Math.round(acc[k] / acc[3]) : 0;
      row[1 + px * 4 + 3] = Math.round(acc[3] / (SS * SS));
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

export function writeIcons({ accent, glyph, svg, out }) {
  writeFileSync(new URL('icon-192.png', out), render(192, { accent, glyph }));
  writeFileSync(new URL('icon-512.png', out), render(512, { accent, glyph }));
  writeFileSync(new URL('icon-maskable-512.png', out), render(512, { accent, glyph, maskable: true }));
  // iOS adds its own rounded corners and dislikes transparency
  writeFileSync(new URL('icon-180.png', out), render(180, { accent, glyph, maskable: true }));
  writeFileSync(
    new URL('icon.svg', out),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${RADIUS * 100}" fill="rgb(${accent})"/>${svg}</svg>\n`,
  );
  console.log(`icons written to ${fileURLToPath(out)}`);
}
