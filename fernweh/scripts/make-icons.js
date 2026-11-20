// Fernweh's icon: a map pin standing on the map, white on plum (the homestack icon style, drawn
// by scripts/kit/icons.js). Run with `npm run icons`; the output is committed in client/public/.

import { mix, WHITE, writeIcons } from './kit/icons.js'

const ACCENT = [123, 63, 160] // #7b3fa0
const GROUND = mix(ACCENT, WHITE, 0.4)

// In the unit square: the pin's round head, its point, the hole, and the spot it stands on
const HEAD = { cx: 0.5, cy: 0.39, r: 0.215 }
const TIP = { x: 0.5, y: 0.8 }
const HOLE = 0.085
const SPOT = { cx: 0.5, cy: 0.8, rx: 0.18, ry: 0.048 }

// The point's sides touch the head: where, seen from the tip
const d = TIP.y - HEAD.cy
const tangentLength = Math.sqrt(d * d - HEAD.r * HEAD.r)
const half = Math.asin(HEAD.r / d) // half the angle of the point
const touchY = TIP.y - tangentLength * Math.cos(half)
const touchDx = tangentLength * Math.sin(half)

function inPin(x, y) {
  if (Math.hypot(x - HEAD.cx, y - HEAD.cy) <= HEAD.r) return true
  return y >= touchY && y <= TIP.y && Math.abs(x - TIP.x) <= (TIP.y - y) * Math.tan(half)
}

function glyph(x, y) {
  if (inPin(x, y)) return Math.hypot(x - HEAD.cx, y - HEAD.cy) <= HOLE ? null : WHITE
  if (((x - SPOT.cx) / SPOT.rx) ** 2 + ((y - SPOT.cy) / SPOT.ry) ** 2 <= 1) return GROUND
  return null
}

// The same picture as SVG
const n = (v) => Math.round(v * 1000) / 10
const svg = `<ellipse cx="${n(SPOT.cx)}" cy="${n(SPOT.cy)}" rx="${n(SPOT.rx)}" ry="${n(SPOT.ry)}" fill="rgb(${GROUND})"/>`
  + `<path fill="#fff" fill-rule="evenodd" d="M${n(TIP.x - touchDx)} ${n(touchY)}A${n(HEAD.r)} ${n(HEAD.r)} 0 1 1 ${n(TIP.x + touchDx)} ${n(touchY)}L${n(TIP.x)} ${n(TIP.y)}Z`
  + `M${n(HEAD.cx - HOLE)} ${n(HEAD.cy)}a${n(HOLE)} ${n(HOLE)} 0 1 0 ${n(2 * HOLE)} 0a${n(HOLE)} ${n(HOLE)} 0 1 0 ${n(-2 * HOLE)} 0Z"/>`

writeIcons({ accent: ACCENT, glyph, svg, out: new URL('../client/public/', import.meta.url) })
