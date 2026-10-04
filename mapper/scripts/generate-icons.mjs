// Generates the PWA/app icons in client/public from the same geometry as icon.svg.
// No dependencies: shapes are rasterized with 4×4 supersampling and written as PNG.
// Usage: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const BG = [59, 130, 246]   // #3b82f6, the app accent color
const FG = [255, 255, 255]

// Unit-square geometry of a map pin, kept inside the central 80% "maskable" safe zone.
function inPin(x, y) {
  const cx = 0.5, cy = 0.42, r = 0.2
  const inHead = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  // Tail: triangle from the head's lower tangents down to the tip.
  const tipY = 0.8, topY = 0.5, halfW = 0.17
  const inTail = y >= topY && y <= tipY && Math.abs(x - cx) <= halfW * (tipY - y) / (tipY - topY)
  const inHole = (x - cx) ** 2 + (y - cy) ** 2 <= 0.08 ** 2
  return (inHead || inTail) && !inHole
}

function render(size) {
  const ss = 4
  const rows = []
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3) // filter byte 0 + RGB
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        if (inPin((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)) hits++
      }
      const t = hits / (ss * ss)
      for (let c = 0; c < 3; c++) row[1 + px * 3 + c] = Math.round(BG[c] * (1 - t) + FG[c] * t)
    }
    rows.push(row)
  }
  return png(size, Buffer.concat(rows))
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, raw) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4)
  header[8] = 8; header[9] = 2 // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = new URL('../client/public/', import.meta.url)
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(new URL(name, out), render(size))
  console.log('wrote client/public/' + name)
}
