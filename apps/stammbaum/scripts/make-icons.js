// Stammbaum's icon: the tree from its top bar (three crowns on branches), white on walnut
// (the homestack icon style, drawn by scripts/kit/icons.js). Run with `npm run icons`;
// the output is committed in public/.

import { WHITE, writeIcons } from './kit/icons.js';

const ACCENT = [122, 78, 45];
// The top bar's tree on its 24×24 grid, scaled into the middle of the icon
const S = 0.8 / 24;
const at = (x, y) => [0.5 + (x - 12) * S, 0.5 + (y - 11) * S];
const CROWNS = [[12, 5, 4], [6, 12, 3], [18, 10, 3]].map(([x, y, r]) => [...at(x, y), r * S]);
const LINES = [[[12, 21], [12, 15]], [[12, 15], [8, 11]], [[12, 13], [16, 9]], [[12, 15], [12, 9]]].map(([a, b]) => [at(...a), at(...b)]);
const WIDTH = 2.2 * S;

function distToSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function glyph(x, y) {
  if (CROWNS.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) <= r)) return WHITE;
  if (LINES.some(([a, b]) => distToSegment(x, y, a, b) <= WIDTH / 2)) return WHITE;
  return null;
}

const p = (v) => Math.round(v * 1000) / 10;
const svg = LINES.map(([[x1, y1], [x2, y2]]) => `<line x1="${p(x1)}" y1="${p(y1)}" x2="${p(x2)}" y2="${p(y2)}" stroke="#fff" stroke-width="${p(WIDTH)}" stroke-linecap="round"/>`).join('')
  + CROWNS.map(([cx, cy, r]) => `<circle cx="${p(cx)}" cy="${p(cy)}" r="${p(r)}" fill="#fff"/>`).join('');

writeIcons({ accent: ACCENT, glyph, svg, out: new URL('../public/', import.meta.url) });
