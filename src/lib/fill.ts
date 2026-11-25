import { pointInShape, type Pt, type Shape } from './trace'

export interface FillOptions {
  /** Direction of the rows, in degrees. */
  angle: number
  /** Distance between rows, mm. 0.4 is a standard dense fill. */
  spacing: number
  /** Longest stitch along a row, mm. */
  stitchLen: number
  /** Rows reach this far past the edge, so the fabric pulling in doesn't leave gaps. */
  pullComp: number
  /** Rows stop this far short of the edge (for underlay). */
  inset: number
}

export interface Move { x: number; y: number; jump?: boolean }

const rot = (p: Pt, c: number, s: number): Pt => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c })
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

interface Row { y: number; x0: number; x1: number; row: number }

/** Where each scanline crosses the shape, as [x0, x1] spans (in the rotated frame). */
function scan(shape: Shape, o: FillOptions): Row[][] {
  let minY = Infinity, maxY = -Infinity
  for (const ring of shape) for (const p of ring) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
  const rows: Row[][] = []
  let r = 0
  for (let y = minY + o.spacing / 2; y < maxY; y += o.spacing, r++) {
    const xs: number[] = []
    for (const ring of shape) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]
      if ((a.y <= y) !== (b.y <= y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
    }
    xs.sort((p, q) => p - q)
    const spans: Row[] = []
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = xs[i] + o.inset - o.pullComp, x1 = xs[i + 1] - o.inset + o.pullComp
      if (x1 - x0 >= Math.max(0.3, o.inset * 1.5)) spans.push({ y, x0, x1, row: r })
    }
    rows.push(spans)
  }
  return rows
}

const overlaps = (a: Row, b: Row) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.2

/**
 * Groups spans into blocks the needle can sweep back and forth: each row of a block
 * overlaps exactly one span in the row before. Where the shape forks or joins, blocks end.
 */
function blocks(rows: Row[][]): Row[][] {
  const done: Row[][] = []
  let open: Row[][] = []
  for (const spans of rows) {
    const next: Row[][] = []
    const used = new Set<Row[]>()
    for (const s of spans) {
      const parents = open.filter((b) => overlaps(b[b.length - 1], s))
      const only = parents.length === 1 ? parents[0] : null
      const siblings = only ? spans.filter((t) => overlaps(only[only.length - 1], t)) : []
      if (only && siblings.length === 1 && !used.has(only)) {
        only.push(s); used.add(only); next.push(only)
      } else {
        next.push([s])
      }
    }
    for (const b of open) if (!next.includes(b)) done.push(b)
    open = next
  }
  done.push(...open)
  return done.filter((b) => b.length)
}

/** Points along one row from xa to xb, staggered by row so the stitch ends don't line up. */
function rowPoints(r: Row, xa: number, xb: number, o: FillOptions): Pt[] {
  const pts: Pt[] = [{ x: xa, y: r.y }]
  const offset = ([0, 0.5, 0.25, 0.75][r.row % 4]) * o.stitchLen
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb)
  const grid: number[] = []
  for (let g = Math.ceil((lo - offset) / o.stitchLen) * o.stitchLen + offset; g < hi; g += o.stitchLen) {
    if (g - lo > 0.6 && hi - g > 0.6) grid.push(g)
  }
  if (xb < xa) grid.reverse()
  for (const g of grid) pts.push({ x: g, y: r.y })
  pts.push({ x: xb, y: r.y })
  return pts
}

function sweep(block: Row[], fromTop: boolean, leftFirst: boolean, o: FillOptions): Pt[] {
  const rows = fromTop ? block : [...block].reverse()
  const out: Pt[] = []
  rows.forEach((r, i) => {
    const ltr = (i % 2 === 0) === leftFirst
    const pts = rowPoints(r, ltr ? r.x0 : r.x1, ltr ? r.x1 : r.x0, o)
    // Where the edge runs nearly along the rows, the next row starts well along; don't
    // make that one long loose stitch.
    if (out.length && dist(out[out.length - 1], pts[0]) > o.stitchLen) out.push(...run(out[out.length - 1], pts[0], o.stitchLen).slice(0, -1))
    out.push(...pts)
  })
  return out
}

const segsCross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}

/** Running stitches from a to b, at most len long. */
export function run(a: Pt, b: Pt, len: number): Pt[] {
  const n = Math.max(1, Math.ceil(dist(a, b) / len))
  return Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * (i + 1)) / n, y: a.y + ((b.y - a.y) * (i + 1)) / n }))
}

/** Evenly spaced points along a polyline (excluding its start), regardless of its vertices. */
export function along(path: Pt[], len: number): Pt[] {
  let total = 0
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i])
  if (total < 1e-6) return []
  const n = Math.max(1, Math.ceil(total / len)), step = total / n
  const out: Pt[] = []
  let seg = 1, segStart = 0, segLen = dist(path[0], path[1] ?? path[0])
  for (let k = 1; k <= n; k++) {
    const target = k === n ? total : k * step
    while (seg < path.length - 1 && segStart + segLen < target) { segStart += segLen; seg++; segLen = dist(path[seg - 1], path[seg]) }
    const t = segLen ? (target - segStart) / segLen : 1
    const a = path[seg - 1], b = path[seg]
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return out
}

/**
 * How to get from a to b while staying inside the shape: straight if the line doesn't
 * leave it, otherwise along the nearest edge. Returns null when only a jump will do.
 */
export function travel(a: Pt, b: Pt, shape: Shape, maxLen: number): Pt[] | null {
  const d = dist(a, b)
  if (d < 0.05) return []
  // Row ends sit just outside the edge (pull compensation), so ignore the very ends.
  const t = Math.min(0.45, 0.5 / d)
  const a2 = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  const b2 = { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t }
  const straight = shape.every((ring) => ring.every((p, i) => !segsCross(a2, b2, p, ring[(i + 1) % ring.length]))) &&
    pointInShape({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, shape)
  // Short hops go straight; they're lost in the fill.
  if (straight && d <= 3) return run(a, b, 2.5)

  // Longer ones follow the edge, where the fill's own edge (and any outline) covers them,
  // rather than crossing rows that are already stitched.
  let best: Pt[] | null = null, bestLen = Infinity
  for (const ring of shape) {
    let ia = 0, ib = 0
    ring.forEach((p, i) => { if (dist(p, a) < dist(ring[ia], a)) ia = i; if (dist(p, b) < dist(ring[ib], b)) ib = i })
    if (dist(ring[ia], a) > 2 || dist(ring[ib], b) > 2) continue
    for (const step of [1, -1]) {
      const path: Pt[] = [ring[ia]]
      for (let i = ia; i !== ib; i = (i + step + ring.length) % ring.length) path.push(ring[(i + step + ring.length) % ring.length])
      path.push(b)
      let len = dist(a, path[0])
      for (let i = 1; i < path.length; i++) len += dist(path[i - 1], path[i])
      if (len < bestLen) { bestLen = len; best = path }
    }
  }
  if (best && bestLen <= maxLen && (!straight || bestLen < d * 3)) return along([a, ...best], 2.5)
  if (straight && d <= maxLen) return run(a, b, 2.5)
  return null
}

/** Tatami fill for one shape, starting as close to `from` as it can. */
export function fill(shape: Shape, o: FillOptions, from: Pt): Move[] {
  const rad = (o.angle * Math.PI) / 180
  const c = Math.cos(-rad), s = Math.sin(-rad)
  const local = shape.map((ring) => ring.map((p) => rot(p, c, s)))
  let here = rot(from, c, s)
  const todo = blocks(scan(local, o))
  const moves: Move[] = []
  while (todo.length) {
    // Pick the block whose nearest entry point is closest.
    let bi = 0, bt = true, bl = true, bd = Infinity
    todo.forEach((b, i) => {
      for (const top of [true, false]) for (const left of [true, false]) {
        const r = top ? b[0] : b[b.length - 1]
        const d = dist(here, { x: left ? r.x0 : r.x1, y: r.y })
        if (d < bd) { bd = d; bi = i; bt = top; bl = left }
      }
    })
    const pts = sweep(todo.splice(bi, 1)[0], bt, bl, o)
    if (moves.length) {
      const path = travel(here, pts[0], local, 25)
      if (path) moves.push(...path.map((p) => ({ ...p })))
      else moves.push({ ...pts[0], jump: true })
    } else {
      moves.push({ ...pts[0], jump: true })
    }
    for (const p of pts.slice(1)) moves.push({ ...p })
    here = pts[pts.length - 1]
  }
  const back = Math.cos(rad), sb = Math.sin(rad)
  return moves.map((m) => ({ ...rot(m, back, sb), jump: m.jump }))
}

/** Bean stitch (forward, back, forward) along a ring, for a bold outline. */
export function outline(ring: Pt[], len: number, bean: boolean, from: Pt): Move[] {
  let start = 0
  ring.forEach((p, i) => { if (dist(p, from) < dist(ring[start], from)) start = i })
  const loop = [...ring.slice(start), ...ring.slice(0, start), ring[start]]
  const moves: Move[] = [{ ...loop[0], jump: true }]
  let last = loop[0]
  for (const q of along(loop, len)) {
    if (bean) moves.push({ ...q }, { ...last }, { ...q })
    else moves.push({ ...q })
    last = q
  }
  return moves
}
