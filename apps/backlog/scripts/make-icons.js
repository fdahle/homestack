// Backlog's icon: a bookmark with a tick cut into it, white on slate blue (the homestack icon
// style, drawn by scripts/kit/icons.js). Run with `npm run icons`; the output is committed
// in web/public/.

import { writeIcons } from './kit/icons.js';

const ACCENT = [75, 93, 120];
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
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function glyph(x, y) {
  if (!inPolygon(x, y, BOOKMARK)) return null;
  // The tick is cut out of the bookmark, in the background colour
  if (distToSegment(x, y, CHECK[0], CHECK[1]) <= CHECK_WIDTH / 2 || distToSegment(x, y, CHECK[1], CHECK[2]) <= CHECK_WIDTH / 2) return ACCENT;
  return WHITE;
}

const p = (v) => Math.round(v * 1000) / 10;
const accent = `rgb(${ACCENT})`;
const svg = `<polygon points="${BOOKMARK.map(([x, y]) => `${p(x)},${p(y)}`).join(' ')}" fill="#fff"/>`
  + `<polyline points="${CHECK.map(([x, y]) => `${p(x)},${p(y)}`).join(' ')}" fill="none" stroke="${accent}" stroke-width="${p(CHECK_WIDTH)}" stroke-linecap="round" stroke-linejoin="round"/>`;

writeIcons({ accent: ACCENT, glyph, svg, out: new URL('../web/public/', import.meta.url) });
