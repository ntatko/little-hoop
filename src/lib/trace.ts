export interface Pt { x: number; y: number }
/** A shape to stitch: rings[0] is the outline, the rest are holes. */
export type Shape = Pt[][]

export function signedArea(ring: Pt[]) {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export function pointInRing(p: Pt, ring: Pt[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export const pointInShape = (p: Pt, shape: Shape) => shape.reduce((inside, ring) => (pointInRing(p, ring) ? !inside : inside), false)

/** Douglas-Peucker on a closed ring. */
function simplify(ring: Pt[], eps: number): Pt[] {
  if (ring.length < 6) return ring
  // Split at the vertex farthest from the first so both halves are open polylines.
  let far = 0, fd = -1
  ring.forEach((p, i) => { const d = (p.x - ring[0].x) ** 2 + (p.y - ring[0].y) ** 2; if (d > fd) { fd = d; far = i } })
  const half = (pts: Pt[]): Pt[] => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
    const stack: [number, number][] = [[0, pts.length - 1]]
    while (stack.length) {
      const [s, e] = stack.pop()!
      const a = pts[s], b = pts[e]
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
      let mi = -1, md = eps
      for (let i = s + 1; i < e; i++) {
        const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len
        if (d > md) { md = d; mi = i }
      }
      if (mi >= 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]) }
    }
    return pts.filter((_, i) => keep[i])
  }
  const a = half(ring.slice(0, far + 1)), b = half([...ring.slice(far), ring[0]])
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

/** One round of corner cutting: turns pixel stair-steps into smooth curves. */
function chaikin(ring: Pt[]): Pt[] {
  if (ring.length < 4) return ring
  const out: Pt[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
  }
  return out
}

/**
 * Traces every region of one label into shapes, in pixel units. Edges run around each
 * pixel in a fixed rotation, so shared edges cancel and what's left are the outlines
 * (negative area) and holes (positive area).
 */
export function traceLabel(labels: Int16Array, w: number, h: number, label: number, eps = 0.75): Shape[] {
  const W = w + 1
  const out = new Map<number, number[]>() // vertex -> outgoing edge targets
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = y0 * W + x0
    const list = out.get(k)
    if (list) list.push(y1 * W + x1); else out.set(k, [y1 * W + x1])
  }
  const is = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === label
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (labels[y * w + x] !== label) continue
    if (!is(x, y - 1)) add(x + 1, y, x, y)
    if (!is(x - 1, y)) add(x, y, x, y + 1)
    if (!is(x, y + 1)) add(x, y + 1, x + 1, y + 1)
    if (!is(x + 1, y)) add(x + 1, y + 1, x + 1, y)
  }

  const rings: Pt[][] = []
  for (const [startKey] of out) {
    while ((out.get(startKey)?.length ?? 0) > 0) {
      const ring: Pt[] = []
      let v = startKey, dx = 0, dy = 0
      for (let guard = 0; guard < 4 * w * h + 8; guard++) {
        const list = out.get(v)
        if (!list || !list.length) break
        // At a pinch point, turn toward the pixel being traced so diagonal neighbors stay separate.
        let pick = 0
        if (list.length > 1) {
          const vx = v % W, vy = (v / W) | 0
          const score = (t: number) => {
            const ex = (t % W) - vx, ey = ((t / W) | 0) - vy
            if (ex === dy && ey === -dx) return 0 // left
            if (ex === dx && ey === dy) return 1 // straight
            return 2
          }
          pick = list.reduce((bi, t, i) => (score(t) < score(list[bi]) ? i : bi), 0)
        }
        const next = list.splice(pick, 1)[0]
        const vx = v % W, vy = (v / W) | 0
        dx = (next % W) - vx; dy = ((next / W) | 0) - vy
        ring.push({ x: vx, y: vy })
        v = next
        if (v === startKey && !(out.get(v)?.length)) break
        if (v === startKey) break
      }
      // Drop collinear vertices before simplifying.
      const tight = ring.filter((p, i) => {
        const a = ring[(i - 1 + ring.length) % ring.length], b = ring[(i + 1) % ring.length]
        return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0
      })
      if (tight.length >= 3) rings.push(chaikin(simplify(tight, eps)))
    }
  }

  const outers = rings.filter((r) => signedArea(r) < 0)
  const holes = rings.filter((r) => signedArea(r) > 0)
  const shapes: Shape[] = outers.map((r) => [r])
  for (const hole of holes) {
    // The smallest outline that contains most of the hole's vertices owns it.
    let owner = -1, ownerArea = Infinity
    outers.forEach((o, i) => {
      const votes = hole.filter((p) => pointInRing(p, o)).length
      const a = -signedArea(o)
      if (votes * 2 >= hole.length && a < ownerArea) { owner = i; ownerArea = a }
    })
    if (owner >= 0) shapes[owner].push(hole)
  }
  return shapes.filter((s) => s[0].length >= 3)
}

export function shapeArea(s: Shape) {
  return -signedArea(s[0]) - s.slice(1).reduce((t, r) => t + signedArea(r), 0)
}
