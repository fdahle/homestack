// Leute's icon: three friends, one in front, white on terracotta (the homestack icon style,
// drawn by scripts/kit/icons.js). Run with `npm run icons`; the output is committed in web/public/.

import { mix, WHITE, writeIcons } from './kit/icons.js';

const ACCENT = [178, 72, 42];
const BACK_COLOR = mix(ACCENT, WHITE, 0.72);
// Everyone is cut off flat at the bottom
const BOTTOM = 0.8;
// A person: head (circle) and shoulders (top of an ellipse), in the unit square
const FRONT = { cx: 0.5, head: [0.4, 0.125], body: [0.83, 0.235, 0.215] };
const BACK = [
  { cx: 0.275, head: [0.45, 0.095], body: [0.83, 0.18, 0.17] },
  { cx: 0.725, head: [0.45, 0.095], body: [0.83, 0.18, 0.17] },
];
const GAP = 0.03; // accent-coloured space around the one in front

function inPerson(x, y, p, grow = 0) {
  if (y > BOTTOM) return false;
  const [hy, hr] = p.head;
  if (Math.hypot(x - p.cx, y - hy) <= hr + grow) return true;
  const [by, rx, ry] = p.body;
  return ((x - p.cx) / (rx + grow)) ** 2 + ((y - by) / (ry + grow)) ** 2 <= 1;
}

function glyph(x, y) {
  if (inPerson(x, y, FRONT)) return WHITE;
  if (inPerson(x, y, FRONT, GAP)) return ACCENT;
  if (BACK.some((p) => inPerson(x, y, p))) return BACK_COLOR;
  return null;
}

// The same picture as SVG: back people, an accent outline around the front one, the front one
const n = (v) => Math.round(v * 1000) / 10;
const person = (p, fill, grow = 0) =>
  `<circle cx="${n(p.cx)}" cy="${n(p.head[0])}" r="${n(p.head[1] + grow)}" fill="${fill}"/>`
  + `<ellipse cx="${n(p.cx)}" cy="${n(p.body[0])}" rx="${n(p.body[1] + grow)}" ry="${n(p.body[2] + grow)}" fill="${fill}" clip-path="url(#c)"/>`;
const svg = `<clipPath id="c"><rect width="100" height="${n(BOTTOM)}"/></clipPath>`
  + `${BACK.map((p) => person(p, `rgb(${BACK_COLOR})`)).join('')}`
  + `${person(FRONT, `rgb(${ACCENT})`, GAP)}${person(FRONT, '#fff')}`;

writeIcons({ accent: ACCENT, glyph, svg, out: new URL('../web/public/', import.meta.url) });
