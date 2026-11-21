// Watchlist's icon: a frame of film with a play button in it, white on teal (the homestack
// icon style, drawn by scripts/kit/icons.js). Run with `npm run icons`; the output is committed in web/public/.

import { WHITE, writeIcons } from './kit/icons.js';

const ACCENT = [20, 120, 122];

// In the unit square: the strip, its sprocket holes along the top and bottom, the picture
// window in the middle and the play triangle in it
const STRIP = { x0: 0.15, x1: 0.85, y0: 0.2, y1: 0.8, r: 0.06 };
const HOLES = { w: 0.075, h: 0.06, r: 0.015, top: 0.235, bottom: 0.705, xs: [0.235, 0.3675, 0.5, 0.6325, 0.765] };
const WINDOW = { x0: 0.21, x1: 0.79, y0: 0.335, y1: 0.665, r: 0.035 };
const PLAY = [[0.44, 0.395], [0.44, 0.605], [0.615, 0.5]];

function inRect(x, y, { x0, x1, y0, y1, r }) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

const holes = HOLES.xs.flatMap((cx) => [HOLES.top, HOLES.bottom].map((y0) => ({ x0: cx - HOLES.w / 2, x1: cx + HOLES.w / 2, y0, y1: y0 + HOLES.h, r: HOLES.r })));

function inTriangle(x, y) {
  const [[ax, ay], [bx, by], [cx, cy]] = PLAY;
  const side = (px, py, qx, qy) => (x - qx) * (py - qy) - (px - qx) * (y - qy);
  const d1 = side(ax, ay, bx, by);
  const d2 = side(bx, by, cx, cy);
  const d3 = side(cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function glyph(x, y) {
  if (inTriangle(x, y)) return WHITE;
  if (!inRect(x, y, STRIP)) return null;
  if (inRect(x, y, WINDOW) || holes.some((h) => inRect(x, y, h))) return null;
  return WHITE;
}

// The same picture as SVG: the strip in white, holes and window cut out in the accent
const n = (v) => Math.round(v * 1000) / 10;
const rect = ({ x0, x1, y0, y1, r }, fill) => `<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" rx="${n(r)}" fill="${fill}"/>`;
const accent = `rgb(${ACCENT})`;
const svg = rect(STRIP, '#fff') + holes.map((h) => rect(h, accent)).join('') + rect(WINDOW, accent)
  + `<path d="M${PLAY.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}z" fill="#fff"/>`;

writeIcons({ accent: ACCENT, glyph, svg, out: new URL('../web/public/', import.meta.url) });
