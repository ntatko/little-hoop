import type { Design } from './design'

/** Embroidery files count in 0.1 mm. */
const units = (d: Design) =>
  d.ops.map((o) => ({ x: Math.round(o.x * 10), y: Math.round(o.y * 10), kind: o.kind }))

class Out {
  bytes: number[] = []
  u8(...v: number[]) { for (const b of v) this.bytes.push(b & 0xff) }
  ascii(s: string) { for (const ch of s) this.bytes.push(ch.charCodeAt(0) & 0x7f) }
  u16le(v: number) { this.u8(v, v >> 8) }
  u16be(v: number) { this.u8(v >> 8, v) }
  u24le(v: number) { this.u8(v, v >> 8, v >> 16) }
  get length() { return this.bytes.length }
  patch24le(at: number, v: number) { this.bytes[at] = v & 0xff; this.bytes[at + 1] = (v >> 8) & 0xff; this.bytes[at + 2] = (v >> 16) & 0xff }
  done() { return new Uint8Array(this.bytes) }
}

function bounds(pts: { x: number; y: number }[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  return pts.length ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 }
}

const ICON_W = 48, ICON_H = 38

/** The little monochrome pictures the machine shows: the whole design, then each color. */
function icon(pts: { x: number; y: number; kind: string }[], b: ReturnType<typeof bounds>, from: number, to: number) {
  const px = new Uint8Array(ICON_W * ICON_H)
  const sw = (ICON_W - 10) / Math.max(1, b.x1 - b.x0), sh = (ICON_H - 10) / Math.max(1, b.y1 - b.y0)
  const k = Math.min(sw, sh)
  const ox = (ICON_W - (b.x1 - b.x0) * k) / 2, oy = (ICON_H - (b.y1 - b.y0) * k) / 2
  for (let i = from; i < to; i++) {
    const p = pts[i]
    if (p.kind !== 'stitch') continue
    const x = Math.floor((p.x - b.x0) * k + ox), y = Math.floor((p.y - b.y0) * k + oy)
    if (x >= 0 && y >= 0 && x < ICON_W && y < ICON_H) px[y * ICON_W + x] = 1
  }
  // Rounded frame with an empty first and last row, as in Brother's own files. The empty first
  // row matters: readers stop at 0xFF 0x00, and the icons follow the stitch block's 0xFF.
  const mark = (x: number, y: number) => { px[y * ICON_W + x] = 1 }
  for (let x = 4; x < ICON_W - 4; x++) { mark(x, 1); mark(x, ICON_H - 2) }
  for (const [y, x] of [[2, 3], [3, 2], [ICON_H - 3, 3], [ICON_H - 4, 2]]) { mark(x, y); mark(ICON_W - 1 - x, y) }
  for (let y = 4; y < ICON_H - 4; y++) { mark(1, y); mark(ICON_W - 2, y) }
  const out: number[] = []
  for (let y = 0; y < ICON_H; y++) for (let bx = 0; bx < ICON_W / 8; bx++) {
    let v = 0
    for (let bit = 0; bit < 8; bit++) if (px[y * ICON_W + bx * 8 + bit]) v |= 1 << bit
    out.push(v)
  }
  return out
}

/**
 * Brother PES (version 1 header around a PEC block). The PEC block is what home machines
 * actually read: thread list, stitches, and preview icons.
 */
export function writePES(d: Design, name: string): Uint8Array {
  const pts = units(d)
  const stitchPts = pts.filter((p) => p.kind === 'stitch' || p.kind === 'jump')
  const b = bounds(stitchPts)
  const f = new Out()
  f.ascii('#PES0001')
  f.u8(0x16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) // PEC block starts at byte 22

  // PEC header: label, thread list padded to a fixed size.
  const label = name.replace(/[^\x20-\x7e]/g, '').slice(0, 8).padEnd(16, ' ')
  f.ascii(`LA:${label}\r`)
  f.u8(...new Array(12).fill(0x20), 0xff, 0x00, ICON_W / 8, ICON_H)
  f.u8(...new Array(12).fill(0x20))
  const threads = d.order.map((ci) => d.colors[ci].thread)
  f.u8(Math.max(0, threads.length - 1), ...threads)
  for (let i = threads.length; i < 463; i++) f.u8(0x20)

  // Stitch block.
  const start = f.length
  f.u8(0, 0)
  f.u24le(0) // length, patched below
  f.u8(0x31, 0xff, 0xf0)
  f.u16le(b.x1 - b.x0)
  f.u16le(b.y1 - b.y0)
  f.u16le(0x1e0)
  f.u16le(0x1b0)

  // Each axis is one byte (7-bit signed) when it fits, otherwise two (12-bit, high bit set).
  const value = (v: number, long = false, flag = 0) => {
    if (!long && v > -64 && v < 63) f.u8(v & 0x7f)
    else { const e = (v & 0x0fff) | 0x8000 | (flag << 8); f.u8(e >> 8, e) }
  }
  let x = 0, y = 0, jumping = true, colorTwo = true, first = true
  const blockStarts = [0]
  pts.forEach((p, i) => {
    if (p.kind === 'color') {
      if (jumping) { f.u8(0, 0); jumping = false }
      f.u8(0xfe, 0xb0, colorTwo ? 2 : 1)
      colorTwo = !colorTwo
      blockStarts.push(i)
      return
    }
    if (p.kind === 'end') return
    const dx = p.x - x, dy = p.y - y
    x = p.x; y = p.y
    if (p.kind === 'jump') {
      // The first move is a plain jump; later ones are trim-jumps, which machines with a cutter trim.
      const flag = first ? 0x10 : 0x20
      value(dx, true, flag); value(dy, true, flag)
      jumping = true; first = false
      return
    }
    first = false
    if (jumping) { if (dx !== 0 && dy !== 0) f.u8(0, 0); jumping = false }
    value(dx); value(dy)
  })
  f.u8(0xff)
  f.patch24le(start + 2, f.length - start)

  // Icons: whole design, then one per color block.
  f.u8(...icon(pts, b, 0, pts.length))
  blockStarts.push(pts.length)
  for (let i = 0; i + 1 < blockStarts.length; i++) f.u8(...icon(pts, b, blockStarts[i], blockStarts[i + 1]))
  return f.done()
}

/** Tajima DST: no thread colors, but nearly every machine reads it. */
export function writeDST(d: Design, name: string): Uint8Array {
  const pts = units(d)
  const recs: number[][] = []
  const bit = (n: number) => 1 << n
  const encode = (dx: number, dy: number, kind: 'stitch' | 'jump' | 'color') => {
    let x = dx, y = -dy
    let b0 = 0, b1 = 0, b2 = 0
    if (kind === 'jump') b2 |= bit(7)
    if (kind === 'color') b2 |= bit(7) | bit(6)
    if (x > 40) { b2 |= bit(2); x -= 81 } if (x < -40) { b2 |= bit(3); x += 81 }
    if (x > 13) { b1 |= bit(2); x -= 27 } if (x < -13) { b1 |= bit(3); x += 27 }
    if (x > 4) { b0 |= bit(2); x -= 9 } if (x < -4) { b0 |= bit(3); x += 9 }
    if (x > 1) { b1 |= bit(0); x -= 3 } if (x < -1) { b1 |= bit(1); x += 3 }
    if (x > 0) { b0 |= bit(0); x -= 1 } if (x < 0) { b0 |= bit(1); x += 1 }
    if (y > 40) { b2 |= bit(5); y -= 81 } if (y < -40) { b2 |= bit(4); y += 81 }
    if (y > 13) { b1 |= bit(5); y -= 27 } if (y < -13) { b1 |= bit(4); y += 27 }
    if (y > 4) { b0 |= bit(5); y -= 9 } if (y < -4) { b0 |= bit(4); y += 9 }
    if (y > 1) { b1 |= bit(7); y -= 3 } if (y < -1) { b1 |= bit(6); y += 3 }
    if (y > 0) { b0 |= bit(7); y -= 1 } if (y < 0) { b0 |= bit(6); y += 1 }
    recs.push([b0, b1, b2 | 0b11])
  }
  let x = 0, y = 0, colors = 0
  for (const p of pts) {
    if (p.kind === 'end') break
    if (p.kind === 'color') { encode(0, 0, 'color'); colors++; continue }
    let dx = p.x - x, dy = p.y - y
    // Each record moves at most 12.1 mm; split anything longer into jumps.
    while (Math.abs(dx) > 121 || Math.abs(dy) > 121) {
      const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 121)
      const sx = Math.round(dx / n), sy = Math.round(dy / n)
      encode(sx, sy, 'jump'); dx -= sx; dy -= sy
    }
    encode(dx, dy, p.kind === 'jump' ? 'jump' : 'stitch')
    x = p.x; y = p.y
  }
  recs.push([0, 0, 0xf3])

  const b = bounds(pts.filter((p) => p.kind !== 'color' && p.kind !== 'end'))
  const f = new Out()
  const pad = (n: number, w: number) => String(n).padStart(w, ' ')
  f.ascii(`LA:${name.replace(/[^\x20-\x7e]/g, '').slice(0, 16).padEnd(16, ' ')}\r`)
  f.ascii(`ST:${pad(recs.length, 7)}\r`)
  f.ascii(`CO:${pad(colors, 3)}\r`)
  f.ascii(`+X:${pad(Math.abs(b.x1), 5)}\r-X:${pad(Math.abs(b.x0), 5)}\r`)
  f.ascii(`+Y:${pad(Math.abs(b.y0), 5)}\r-Y:${pad(Math.abs(b.y1), 5)}\r`)
  f.ascii(`AX:+${pad(0, 5)}\rAY:+${pad(0, 5)}\rMX:+${pad(0, 5)}\rMY:+${pad(0, 5)}\rPD:******\r`)
  f.u8(0x1a)
  while (f.length < 512) f.u8(0x20)
  for (const r of recs) f.u8(...r)
  return f.done()
}
