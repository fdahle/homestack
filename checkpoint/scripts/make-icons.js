// Checkpoint's icon: a checkered flag on its pole, white on indigo (the homestack icon style,
// drawn by scripts/kit/icons.js). Run with `npm run icons`; the output is committed in web/public/.

import { mix, WHITE, writeIcons } from './kit/icons.js';

const ACCENT = [84, 72, 200];
const CHECK = mix(ACCENT, WHITE, 0.62);

// In the unit square: pole, a checkered flag hanging from it, a base under it
const POLE = { x0: 0.29, x1: 0.35, y0: 0.17, y1: 0.79 };
const FLAG = { x0: 0.35, x1: 0.77, y0: 0.2, y1: 0.5, cols: 4, rows: 3 };
const BASE = { cx: 0.32, cy: 0.81, rx: 0.15, ry: 0.045 };
const KNOB = { cx: 0.32, cy: 0.17, r: 0.045 };
const SHIFT = 0.03; // the whole flag sits a little right of centre
// The flag's free edge waves a little
const wave = (x) => 0.025 * Math.sin(((x - FLAG.x0) / (FLAG.x1 - FLAG.x0)) * Math.PI * 1.6);

function glyph(x, y) {
  const gx = x - SHIFT;
  if (gx >= POLE.x0 && gx <= POLE.x1 && y >= POLE.y0 && y <= POLE.y1) return WHITE;
  if (Math.hypot(gx - KNOB.cx, y - KNOB.cy) <= KNOB.r) return WHITE;
  if (((gx - BASE.cx) / BASE.rx) ** 2 + ((y - BASE.cy) / BASE.ry) ** 2 <= 1) return WHITE;
  const fy = y - wave(gx);
  if (gx > FLAG.x0 && gx <= FLAG.x1 && fy >= FLAG.y0 && fy <= FLAG.y1) {
    const col = Math.floor(((gx - FLAG.x0) / (FLAG.x1 - FLAG.x0)) * FLAG.cols);
    const row = Math.floor(((fy - FLAG.y0) / (FLAG.y1 - FLAG.y0)) * FLAG.rows);
    return (col + row) % 2 ? CHECK : WHITE;
  }
  return null;
}

// The same picture as SVG (the flag without the wave)
const n = (v) => Math.round((v + SHIFT) * 1000) / 10;
const h = (v) => Math.round(v * 1000) / 10;
const cw = (FLAG.x1 - FLAG.x0) / FLAG.cols;
const ch = (FLAG.y1 - FLAG.y0) / FLAG.rows;
let checks = '';
for (let r = 0; r < FLAG.rows; r++) for (let c = 0; c < FLAG.cols; c++) {
  if ((c + r) % 2) checks += `<rect x="${n(FLAG.x0 + c * cw)}" y="${h(FLAG.y0 + r * ch)}" width="${h(cw)}" height="${h(ch)}" fill="rgb(${CHECK})"/>`;
}
const svg = `<rect x="${n(POLE.x0)}" y="${h(POLE.y0)}" width="${h(POLE.x1 - POLE.x0)}" height="${h(POLE.y1 - POLE.y0)}" fill="#fff"/>`
  + `<circle cx="${n(KNOB.cx)}" cy="${h(KNOB.cy)}" r="${h(KNOB.r)}" fill="#fff"/>`
  + `<ellipse cx="${n(BASE.cx)}" cy="${h(BASE.cy)}" rx="${h(BASE.rx)}" ry="${h(BASE.ry)}" fill="#fff"/>`
  + `<rect x="${n(FLAG.x0)}" y="${h(FLAG.y0)}" width="${h(FLAG.x1 - FLAG.x0)}" height="${h(FLAG.y1 - FLAG.y0)}" fill="#fff"/>${checks}`;

writeIcons({ accent: ACCENT, glyph, svg, out: new URL('../web/public/', import.meta.url) });
