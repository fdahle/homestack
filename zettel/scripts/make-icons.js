// Zettel's icon: a slip of paper with a folded corner and a few lines on it, white on amber
// (the homestack icon style, drawn by scripts/kit/icons.js). Run with `npm run icons`;
// the output is committed in web/public/.

import { mix, WHITE, writeIcons } from './kit/icons.js';

const ACCENT = [176, 124, 0];
const INK = mix(ACCENT, WHITE, 0.45); // the lines on the slip
const FOLD = mix(ACCENT, WHITE, 0.62); // the folded-over corner

// In the unit square: the slip, its corner folded at the bottom right
const SLIP = { x0: 0.24, x1: 0.76, y0: 0.18, y1: 0.82, r: 0.035 };
const CUT = 0.18; // how far the fold reaches along each edge
const LINES = [
  { y: 0.33, x1: 0.66 },
  { y: 0.44, x1: 0.66 },
  { y: 0.55, x1: 0.56 },
];
const LINE = { x0: 0.34, h: 0.045 };

const foldX = SLIP.x1 - CUT;
const foldY = SLIP.y1 - CUT;

function inSlip(x, y) {
  if (x < SLIP.x0 || x > SLIP.x1 || y < SLIP.y0 || y > SLIP.y1) return false;
  if (x + y > SLIP.x1 + foldY) return false; // past the fold line: cut off
  // Rounded on the three corners that aren't folded
  const { r } = SLIP;
  for (const [cx, cy] of [[SLIP.x0 + r, SLIP.y0 + r], [SLIP.x1 - r, SLIP.y0 + r], [SLIP.x0 + r, SLIP.y1 - r]]) {
    const outX = (cx < 0.5 && x < cx) || (cx > 0.5 && x > cx);
    const outY = (cy < 0.5 && y < cy) || (cy > 0.5 && y > cy);
    if (outX && outY && Math.hypot(x - cx, y - cy) > r) return false;
  }
  return true;
}

function glyph(x, y) {
  if (!inSlip(x, y)) return null;
  // The folded corner: the triangle inside the fold line
  if (x >= foldX && y >= foldY) return FOLD;
  for (const line of LINES) {
    if (y >= line.y && y <= line.y + LINE.h && x >= LINE.x0 && x <= line.x1) {
      // Round ends
      const r = LINE.h / 2;
      const cy = line.y + r;
      if (x < LINE.x0 + r && Math.hypot(x - (LINE.x0 + r), y - cy) > r) return WHITE;
      if (x > line.x1 - r && Math.hypot(x - (line.x1 - r), y - cy) > r) return WHITE;
      return INK;
    }
  }
  return WHITE;
}

// The same picture as SVG on a 100×100 canvas
const p = (v) => Math.round(v * 1000) / 10;
const rgb = (c) => `rgb(${c})`;
const { x0, x1, y0, y1, r } = SLIP;
let svg = `<path d="M${p(x0 + r)} ${p(y0)}H${p(x1 - r)}A${p(r)} ${p(r)} 0 0 1 ${p(x1)} ${p(y0 + r)}V${p(foldY)}L${p(foldX)} ${p(y1)}H${p(x0 + r)}A${p(r)} ${p(r)} 0 0 1 ${p(x0)} ${p(y1 - r)}V${p(y0 + r)}A${p(r)} ${p(r)} 0 0 1 ${p(x0 + r)} ${p(y0)}Z" fill="#fff"/>`;
svg += `<path d="M${p(x1)} ${p(foldY)}L${p(foldX)} ${p(y1)}V${p(foldY)}Z" fill="${rgb(FOLD)}"/>`;
for (const line of LINES) {
  svg += `<rect x="${p(LINE.x0)}" y="${p(line.y)}" width="${p(line.x1 - LINE.x0)}" height="${p(LINE.h)}" rx="${p(LINE.h / 2)}" fill="${rgb(INK)}"/>`;
}

writeIcons({ accent: ACCENT, glyph, svg, out: new URL('../web/public/', import.meta.url) });
