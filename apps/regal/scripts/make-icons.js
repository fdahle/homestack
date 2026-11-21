// Regal's icon: books standing on a shelf, one leaning against the others, white on green
// (the homestack icon style, drawn by scripts/kit/icons.js). Run with `npm run icons`;
// the output is committed in web/public/.

import { mix, WHITE, writeIcons } from './kit/icons.js';

const ACCENT = [61, 122, 58];
const BAND = mix(ACCENT, WHITE, 0.6);

// In the unit square: upright books (with bands across their spines), the shelf under them
const BOOKS = [
  { x0: 0.2, x1: 0.31, y0: 0.3, bands: [0.38, 0.62] },
  { x0: 0.33, x1: 0.46, y0: 0.21, bands: [0.29, 0.63] },
  { x0: 0.48, x1: 0.57, y0: 0.35, bands: [0.43] },
];
const SHELF = { x0: 0.15, x1: 0.85, y0: 0.73, y1: 0.79 };
const BAND_H = 0.035;
// The leaning book: its bottom right corner on the shelf, its top resting on the third book
const LEAN = { px: 0.81, py: SHELF.y0, w: 0.1, h: 0.37, angle: (22 * Math.PI) / 180 };

// Where (x, y) lies in the leaning book's own frame: 0 ≤ u ≤ w across, 0 ≤ v ≤ h up from the shelf
function leanFrame(x, y) {
  const dx = x - LEAN.px;
  const dy = LEAN.py - y;
  const c = Math.cos(LEAN.angle);
  const s = Math.sin(LEAN.angle);
  return { u: -(dx * c + dy * s), v: -dx * s + dy * c };
}

function glyph(x, y) {
  if (x >= SHELF.x0 && x <= SHELF.x1 && y >= SHELF.y0 && y <= SHELF.y1) return WHITE;
  for (const b of BOOKS) {
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y < SHELF.y0) {
      return b.bands.some((by) => y >= by && y <= by + BAND_H) ? BAND : WHITE;
    }
  }
  const { u, v } = leanFrame(x, y);
  if (u >= 0 && u <= LEAN.w && v >= 0 && v <= LEAN.h) return v >= LEAN.h * 0.72 && v <= LEAN.h * 0.72 + BAND_H ? BAND : WHITE;
  return null;
}

// The same picture as SVG on a 100×100 canvas
const p = (v) => Math.round(v * 1000) / 10;
const rect = (x0, y0, x1, y1, fill) => `<rect x="${p(x0)}" y="${p(y0)}" width="${p(x1 - x0)}" height="${p(y1 - y0)}" fill="${fill}"/>`;
const band = `rgb(${BAND})`;
let svg = rect(SHELF.x0, SHELF.y0, SHELF.x1, SHELF.y1, '#fff');
for (const b of BOOKS) {
  svg += rect(b.x0, b.y0, b.x1, SHELF.y0, '#fff');
  for (const by of b.bands) svg += rect(b.x0, by, b.x1, by + BAND_H, band);
}
// The leaning book's corners, from its frame back to the square
const corner = (u, v) => {
  const c = Math.cos(LEAN.angle);
  const s = Math.sin(LEAN.angle);
  return [LEAN.px - (u * c + v * s), LEAN.py - (-u * s + v * c)];
};
const poly = (pts) => pts.map(([x, y]) => `${p(x)},${p(y)}`).join(' ');
const bandV = LEAN.h * 0.72;
svg += `<polygon points="${poly([corner(0, 0), corner(LEAN.w, 0), corner(LEAN.w, LEAN.h), corner(0, LEAN.h)])}" fill="#fff"/>`;
svg += `<polygon points="${poly([corner(0, bandV), corner(LEAN.w, bandV), corner(LEAN.w, bandV + BAND_H), corner(0, bandV + BAND_H)])}" fill="${band}"/>`;

writeIcons({ accent: ACCENT, glyph, svg, out: new URL('../web/public/', import.meta.url) });
