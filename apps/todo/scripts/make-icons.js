// To-do's icon: a box with a tick that swings out of it, white on raspberry (the homestack
// icon style, drawn by scripts/kit/icons.js). Run with `npm run icons`; the output is
// committed in web/public/.

import { WHITE, writeIcons } from './kit/icons.js';

const ACCENT = [176, 32, 88];

// In the unit square: the box's outline (open at the top right, where the tick leaves it)
const BOX = { x0: 0.24, y0: 0.26, x1: 0.7, y1: 0.76, r: 0.09, w: 0.065 };
const GAP = { x: 0.5, y: 0.4 }; // the outline is left out right and above this point
// The tick: two strokes with round ends
const TICK = [[0.36, 0.49], [0.47, 0.6], [0.8, 0.25]];
const TICK_W = 0.085;

function distToSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// Distance from the outline of a rounded rectangle
function roundedRectDist(x, y, { x0, y0, x1, y1, r }) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - cy) - ((y1 - y0) / 2 - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  return Math.abs(outside);
}

function glyph(x, y) {
  if (distToSegment(x, y, TICK[0], TICK[1]) <= TICK_W / 2 || distToSegment(x, y, TICK[1], TICK[2]) <= TICK_W / 2) return WHITE;
  const onBox = roundedRectDist(x, y, BOX) <= BOX.w / 2;
  if (onBox && !(x > GAP.x && y < GAP.y)) return WHITE;
  return null;
}

// The same picture as SVG on a 100×100 canvas
const p = (v) => Math.round(v * 1000) / 10;
const { x0, y0, x1, y1, r, w } = BOX;
// The box from the gap at the top, round the left, bottom and right, up to the gap on the right
const box = `M${p(GAP.x)} ${p(y0)}H${p(x0 + r)}A${p(r)} ${p(r)} 0 0 0 ${p(x0)} ${p(y0 + r)}V${p(y1 - r)}A${p(r)} ${p(r)} 0 0 0 ${p(x0 + r)} ${p(y1)}H${p(x1 - r)}A${p(r)} ${p(r)} 0 0 0 ${p(x1)} ${p(y1 - r)}V${p(GAP.y)}`;
const tick = `M${p(TICK[0][0])} ${p(TICK[0][1])}L${p(TICK[1][0])} ${p(TICK[1][1])}L${p(TICK[2][0])} ${p(TICK[2][1])}`;
const svg = `<path d="${box}" fill="none" stroke="#fff" stroke-width="${p(w)}"/><path d="${tick}" fill="none" stroke="#fff" stroke-width="${p(TICK_W)}" stroke-linecap="round" stroke-linejoin="round"/>`;

writeIcons({ accent: ACCENT, glyph, svg, out: new URL('../web/public/', import.meta.url) });
