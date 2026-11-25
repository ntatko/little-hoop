import { labToRgb, luminance, type RGB } from './color'
import { fill, outline, run, travel, type Move } from './fill'
import { cleanUp, quantize } from './quantize'
import { nearestThread } from './threads'
import { shapeArea, traceLabel, type Pt, type Shape } from './trace'

export type OpKind = 'stitch' | 'jump' | 'color' | 'end'
export interface Op { x: number; y: number; kind: OpKind }

export interface ColorInfo {
  /** Average color of this region in the photo. */
  rgb: RGB
  /** Suggested Brother thread. */
  thread: number
  /** Share of the stitched area. */
  share: number
}

export interface DesignParams {
  colors: number
  /** Width and height available inside the hoop, mm. */
  maxW: number
  maxH: number
  /** 0.3 to 1: how much of the hoop to use. */
  scale: number
  /** Smallest patch worth stitching, mm². */
  minArea: number
  /** Row spacing for fills, mm. */
  density: number
  angle: number
  underlay: boolean
  outline: boolean
  /** Palette indices to leave unstitched. */
  skip: number[]
  /** Blur passes before reducing colors: more means bolder, simpler shapes. */
  smooth: number
}

export interface Design {
  ops: Op[]
  /** Thread order: index into `colors` for each color block, in stitching order. */
  order: number[]
  colors: ColorInfo[]
  /** Entries in colors that come from the picture; any after these are the outline. */
  paletteSize: number
  width: number
  height: number
  stitches: number
  /** Jumps long enough that the thread needs trimming by hand. */
  jumps: number
  /** The cleaned-up color map, for showing what each color covers. */
  preview: { labels: Int16Array; w: number; h: number }
}

const MM_PER_PX = 0.25
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** Shrinks an image so each pixel is MM_PER_PX at the chosen size. */
function fit(img: ImageData, p: DesignParams) {
  const k = Math.min(p.maxW / img.width, p.maxH / img.height) * p.scale
  const wMm = img.width * k, hMm = img.height * k
  const w = Math.max(8, Math.round(wMm / MM_PER_PX)), h = Math.max(8, Math.round(hMm / MM_PER_PX))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(imageToCanvas(img), 0, 0, w, h)
  return { data: ctx.getImageData(0, 0, w, h), wMm: w * MM_PER_PX, hMm: h * MM_PER_PX }
}

function imageToCanvas(img: ImageData) {
  const c = new OffscreenCanvas(img.width, img.height)
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c
}

/** Three tiny stitches in place so the thread can't pull out. */
function tie(at: Pt, toward: Pt): Pt[] {
  const d = dist(at, toward) || 1
  const ux = ((toward.x - at.x) / d) * 0.5, uy = ((toward.y - at.y) / d) * 0.5
  return [{ x: at.x + ux, y: at.y + uy }, { ...at }, { x: at.x + ux, y: at.y + uy }, { ...at }]
}

export function buildDesign(img: ImageData, p: DesignParams): Design {
  const { data, wMm, hMm } = fit(img, p)
  return buildSized(data, wMm, hMm, p)
}

/** Builds from an image already at MM_PER_PX resolution (wMm × hMm). */
export function buildSized(data: ImageData, wMm: number, hMm: number, p: DesignParams): Design {
  const minPx = Math.max(4, p.minArea / (MM_PER_PX * MM_PER_PX))
  const q = cleanUp(quantize(data, p.colors, p.smooth), minPx)
  const { width: w, height: h } = q
  const toMm = (pt: Pt): Pt => ({ x: pt.x * MM_PER_PX - wMm / 2, y: pt.y * MM_PER_PX - hMm / 2 })

  // Pixel counts per color, for ordering and the share shown next to each thread.
  const counts = new Array(q.palette.length).fill(0)
  for (const l of q.labels) if (l >= 0) counts[l]++
  const total = counts.reduce((a, b) => a + b, 0) || 1
  // Threads: the biggest areas choose first, each from those not yet taken.
  const taken = new Set<number>()
  const colors: ColorInfo[] = q.palette.map((lab) => ({ rgb: labToRgb(...lab), thread: 0, share: 0 }))
  const byShare = colors.map((_, i) => i).sort((a, b) => counts[b] - counts[a])
  for (const i of byShare) {
    const lab = q.palette[i]
    // Photos are muted next to thread: match muted colors as a more saturated version, the
    // way you'd pick a spool to stand for them. Colors that are already strong stay as they are.
    const chroma = Math.hypot(lab[1], lab[2])
    const boost = 1 + 0.6 * Math.max(0, 1 - chroma / 40)
    const t = nearestThread([lab[0], lab[1] * boost, lab[2] * boost], taken)
    taken.add(t.id)
    colors[i].thread = t.id
    colors[i].share = counts[i] / total
  }

  const ops: Op[] = []
  let here: Pt = { x: 0, y: 0 }
  const order: number[] = []

  // Colors not stitched yet (including the current one): travel stitches hidden under them
  // get covered later, which saves a jump and a thread to trim.
  let coverable = new Set<number>()
  const toPx = (pt: Pt) => [Math.floor((pt.x + wMm / 2) / MM_PER_PX), Math.floor((pt.y + hMm / 2) / MM_PER_PX)]
  const underCover = (a: Pt, b: Pt): Pt[] | null => {
    const d = dist(a, b)
    if (d > 20) return null
    for (let t = 0; t <= d; t += MM_PER_PX * 0.7) {
      const [x, y] = toPx({ x: a.x + ((b.x - a.x) * t) / d, y: a.y + ((b.y - a.y) * t) / d })
      // A little slack at the ends, which sit on the edge of a shape.
      if (t < 0.6 || d - t < 0.6) continue
      if (x < 0 || y < 0 || x >= w || y >= h || !coverable.has(q.labels[y * w + x])) return null
    }
    return run(a, b, 2.5)
  }

  const emit = (moves: Move[], shape: Shape | null) => {
    if (!moves.length) return
    const first = moves[0]
    const gap = dist(here, first)
    let stitched = ops.length > 0 && ops[ops.length - 1].kind === 'stitch'
    const path = gap < 0.05 ? [] : !stitched ? null
      : gap < 1.5 ? [{ x: first.x, y: first.y }]
      : (shape && travel(here, first, shape, 6)) || (shape ? underCover(here, first) : null)
    if (path) {
      for (const pt of path) ops.push({ ...pt, kind: 'stitch' })
    } else if (gap >= 0.05 || !stitched) {
      if (stitched) for (const pt of tie(here, ops[ops.length - 2] ?? here)) ops.push({ ...pt, kind: 'stitch' })
      ops.push({ ...first, kind: 'jump' })
      const next = moves.find((m) => dist(m, first) > 0.3) ?? first
      for (const pt of tie(first, next)) ops.push({ ...pt, kind: 'stitch' })
      stitched = true
    }
    for (const m of moves.slice(1)) {
      const prev = ops[ops.length - 1]
      const hidden = !m.jump ? null : dist(prev, m) < 1.5 ? [{ x: m.x, y: m.y }] : underCover(prev, m)
      if (hidden) for (const pt of hidden) ops.push({ ...pt, kind: 'stitch' })
      else if (m.jump) {
        // A jump inside a fill: tie off, jump, tie in.
        for (const pt of tie(ops[ops.length - 1], ops[ops.length - 2] ?? ops[ops.length - 1])) ops.push({ ...pt, kind: 'stitch' })
        ops.push({ x: m.x, y: m.y, kind: 'jump' })
        for (const pt of tie(m, m)) ops.push({ ...pt, kind: 'stitch' })
      } else ops.push({ x: m.x, y: m.y, kind: 'stitch' })
    }
    here = ops[ops.length - 1]
  }

  // Biggest areas first, so details land on top of what's around them.
  const palette = colors.map((_, i) => i).filter((i) => !p.skip.includes(i) && counts[i] > 0).sort((a, b) => counts[b] - counts[a])
  palette.forEach((ci, n) => {
    if (n > 0) {
      for (const pt of tie(here, ops[ops.length - 2] ?? here)) ops.push({ ...pt, kind: 'stitch' })
      ops.push({ ...here, kind: 'color' })
    }
    order.push(ci)
    coverable = new Set(palette.slice(n))
    let shapes = traceLabel(q.labels, w, h, ci).map((s) => s.map((r) => r.map(toMm)))
    shapes = shapes.filter((s) => shapeArea(s) >= p.minArea * 0.5)
    const angle = p.angle
    while (shapes.length) {
      // Nearest shape next, to keep jumps short.
      let bi = 0, bd = Infinity
      shapes.forEach((s, i) => s[0].forEach((pt) => { const d = dist(pt, here); if (d < bd) { bd = d; bi = i } }))
      const s = shapes.splice(bi, 1)[0]
      const area = shapeArea(s)
      if (p.underlay && area > 12) {
        emit(fill(s, { angle: angle + 90, spacing: 2, stitchLen: 3, pullComp: 0, inset: 0.6 }, here), s)
      }
      emit(fill(s, { angle, spacing: p.density, stitchLen: 3.5, pullComp: 0.2, inset: 0 }, here), s)
    }
  })

  if (p.outline) {
    // Bold outline around the whole subject in the darkest thread, stitched last.
    const mask = q.labels.map((l) => (l >= 0 && !p.skip.includes(l) ? 0 : -1)) as Int16Array
    const rings = traceLabel(mask, w, h, 0, 0.6).flatMap((s) => s).map((r) => r.map(toMm))
    if (rings.length) {
      const darkest = colors.reduce((bi, c, i) => (luminance(c.rgb) < luminance(colors[bi].rgb) ? i : bi), 0)
      const thread = luminance(colors[darkest].rgb) < 0.05 ? colors[darkest].thread : 20
      const last = order[order.length - 1]
      if (last !== undefined && colors[last].thread === thread) {
        // Same thread as the last block: keep going, no stop needed.
      } else {
        colors.push({ rgb: colors[darkest].rgb, thread, share: 0 })
        if (ops.length) {
          for (const pt of tie(here, ops[ops.length - 2] ?? here)) ops.push({ ...pt, kind: 'stitch' })
          ops.push({ ...here, kind: 'color' })
        }
        order.push(colors.length - 1)
      }
      const left = [...rings]
      while (left.length) {
        let bi = 0, bd = Infinity
        left.forEach((r, i) => r.forEach((pt) => { const d = dist(pt, here); if (d < bd) { bd = d; bi = i } }))
        emit(outline(left.splice(bi, 1)[0], 2, true, here), null)
      }
    }
  }

  if (ops.length) {
    for (const pt of tie(here, ops[ops.length - 2] ?? here)) ops.push({ ...pt, kind: 'stitch' })
    ops.push({ ...here, kind: 'end' })
  }
  return {
    ops, order, colors, paletteSize: q.palette.length, width: wMm, height: hMm,
    jumps: ops.filter((o, i) => o.kind === 'jump' && i > 1 && dist(o, ops[i - 1]) > 3).length,
    stitches: ops.filter((o) => o.kind === 'stitch').length,
    preview: { labels: q.labels, w, h },
  }
}
