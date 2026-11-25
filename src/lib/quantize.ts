import { deltaE2000, labToRgb, rgbToLab, type Lab } from './color'

/** Seeded so moving an unrelated slider doesn't reshuffle the colors. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Quantized {
  /** One entry per pixel: a palette index, or -1 for no stitching (background). */
  labels: Int16Array
  palette: Lab[]
  width: number
  height: number
}

/**
 * Reduces the foreground of an image to k colors with k-means in Lab space.
 * Pixels with alpha below half are background.
 */
export function quantize(img: ImageData, k: number, smooth = 0, cartoon = false): Quantized {
  const { width, height } = img
  let data = cartoon ? flatten(img) : img.data
  if (smooth > 0) data = blur({ width, height, data } as ImageData, smooth)
  const n = width * height
  const lab = new Float32Array(n * 3)
  const fg: number[] = []
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) continue
    const [L, a, b] = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b
    fg.push(i)
  }
  const labels = new Int16Array(n).fill(-1)
  if (!fg.length) return { labels, palette: [], width, height }

  const rand = rng(1234)
  const sample = fg.length > 40000 ? Array.from({ length: 40000 }, () => fg[Math.floor(rand() * fg.length)]) : fg
  const d2 = (i: number, c: Lab) => (lab[i * 3] - c[0]) ** 2 + (lab[i * 3 + 1] - c[1]) ** 2 + (lab[i * 3 + 2] - c[2]) ** 2
  const at = (i: number): Lab => [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]]

  // Over-split first: k-means hands colors to whatever covers the most pixels, so a small
  // but striking feature (a beak, an eye) loses out to two nearly identical body shades.
  const want = Math.min(k + 4, 16)
  // k-means++ start: spread the first centers out.
  let centers: Lab[] = [at(sample[Math.floor(rand() * sample.length)])]
  const best = new Float32Array(sample.length).fill(Infinity)
  while (centers.length < want) {
    let sum = 0
    sample.forEach((p, s) => { best[s] = Math.min(best[s], d2(p, centers[centers.length - 1])); sum += best[s] })
    if (sum === 0) break
    let r = rand() * sum, s = 0
    while (s < sample.length - 1 && (r -= best[s]) > 0) s++
    centers.push(at(sample[s]))
  }

  const assign = (i: number) => {
    let bi = 0, bd = Infinity
    for (let c = 0; c < centers.length; c++) { const d = d2(i, centers[c]); if (d < bd) { bd = d; bi = c } }
    return bi
  }
  const refine = (iters: number) => {
    let sizes: number[] = []
    for (let iter = 0; iter < iters; iter++) {
      const sums = centers.map(() => [0, 0, 0, 0])
      for (const p of sample) { const c = assign(p); const s = sums[c]; s[0] += lab[p * 3]; s[1] += lab[p * 3 + 1]; s[2] += lab[p * 3 + 2]; s[3]++ }
      let moved = 0
      sums.forEach((s, c) => {
        if (!s[3]) return
        const next: Lab = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
        moved = Math.max(moved, Math.abs(next[0] - centers[c][0]) + Math.abs(next[1] - centers[c][1]) + Math.abs(next[2] - centers[c][2]))
        centers[c] = next
      })
      sizes = sums.map((s) => s[3])
      if (moved < 0.5) break
    }
    return sizes
  }
  let sizes = refine(14)
  // Drop empty clusters, then merge the two most alike colors until k remain.
  centers = centers.filter((_, i) => sizes[i] > 0); sizes = sizes.filter((n) => n > 0)
  while (centers.length > k) {
    let ba = 0, bb = 1, bd = Infinity
    for (let a = 0; a < centers.length; a++) for (let b = a + 1; b < centers.length; b++) {
      const d = deltaE2000(centers[a], centers[b])
      if (d < bd) { bd = d; ba = a; bb = b }
    }
    const na = sizes[ba], nb = sizes[bb]
    centers[ba] = [0, 1, 2].map((j) => (centers[ba][j] * na + centers[bb][j] * nb) / (na + nb)) as Lab
    sizes[ba] = na + nb
    centers.splice(bb, 1); sizes.splice(bb, 1)
  }
  refine(3)
  for (const p of fg) labels[p] = assign(p)
  return compact({ labels, palette: centers, width, height })
}

/** Drops palette entries no pixel uses and renumbers the rest. */
function compact(q: Quantized): Quantized {
  const used = new Map<number, number>()
  for (const l of q.labels) if (l >= 0 && !used.has(l)) used.set(l, 0)
  const order = [...used.keys()].sort((a, b) => a - b)
  order.forEach((l, i) => used.set(l, i))
  const labels = q.labels.map((l) => (l < 0 ? -1 : used.get(l)!)) as Int16Array
  return { ...q, labels, palette: order.map((l) => q.palette[l]) }
}

/**
 * Makes the color map stitchable: smooths ragged edges, then folds every patch smaller than
 * minArea pixels (specks, slivers, pinholes) into the neighbor it shares the most border with.
 */
export function cleanUp(q: Quantized, minArea: number): Quantized {
  const { width: w, height: h } = q
  let labels = q.labels.slice()

  // Majority filter: a pixel that disagrees with most of its neighbors joins them.
  for (let pass = 0; pass < 2; pass++) {
    const next = labels.slice()
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const counts = new Map<number, number>()
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const l = labels[i + dy * w + dx]
        counts.set(l, (counts.get(l) ?? 0) + 1)
      }
      if ((counts.get(labels[i]) ?? 0) >= 2) continue
      let bl = labels[i], bc = 0
      counts.forEach((c, l) => { if (c > bc) { bc = c; bl = l } })
      if (bc >= 5) next[i] = bl
    }
    labels = next
  }

  // Small patches, including background holes, merge into their biggest neighbor.
  for (let pass = 0; pass < 4; pass++) {
    const comp = new Int32Array(w * h).fill(-1)
    let changed = false
    const stack: number[] = []
    for (let start = 0; start < w * h; start++) {
      if (comp[start] >= 0) continue
      const l = labels[start]
      const members: number[] = []
      const border = new Map<number, number>()
      comp[start] = start; stack.push(start)
      while (stack.length) {
        const i = stack.pop()!
        members.push(i)
        const x = i % w, y = (i / w) | 0
        const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
        for (const j of nb) {
          if (j < 0) { border.set(-2, (border.get(-2) ?? 0) + 1); continue }
          if (labels[j] === l) { if (comp[j] < 0) { comp[j] = start; stack.push(j) } }
          else border.set(labels[j], (border.get(labels[j]) ?? 0) + 1)
        }
      }
      if (members.length >= minArea) continue
      let to = -3, tc = 0
      border.forEach((c, nl) => { if (nl !== -2 && c > tc) { tc = c; to = nl } })
      // Background specks touching the image edge stay background.
      if (to === -3 || (l === -1 && border.has(-2))) continue
      for (const i of members) labels[i] = to
      changed = true
    }
    if (!changed) break
  }
  return compact({ ...q, labels })
}

/**
 * Median filter over the visible pixels: removes photo grain but keeps hard edges, so
 * clip art doesn't grow a halo of in-between colors.
 */
function blur(img: ImageData, passes: number): Uint8ClampedArray {
  const { width: w, height: h } = img
  let src = img.data
  const r: number[] = [], g: number[] = [], b: number[] = []
  const mid = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1]
  for (let pass = 0; pass < passes; pass++) {
    const out = new Uint8ClampedArray(src)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (src[i + 3] < 128) continue
      r.length = g.length = b.length = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = (yy * w + xx) * 4
        if (src[j + 3] < 128) continue
        r.push(src[j]); g.push(src[j + 1]); b.push(src[j + 2])
      }
      out[i] = mid(r); out[i + 1] = mid(g); out[i + 2] = mid(b)
    }
    src = out
  }
  return src
}

/**
 * Cartoon look: an edge-preserving (bilateral) filter, run a few times, so shading inside an
 * area melts into one flat tone while edges between areas stay sharp.
 */
function flatten(img: ImageData, passes = 6, radius = 3, sigmaColor = 16): Uint8ClampedArray {
  const { width: w, height: h } = img
  const n = w * h
  let lab = new Float32Array(n * 3)
  const alpha = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    alpha[i] = img.data[i * 4 + 3] >= 128 ? 1 : 0
    const [L, a, b] = rgbToLab(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2])
    lab[i * 3] = L; lab[i * 3 + 1] = a; lab[i * 3 + 2] = b
  }
  const spatial: number[] = []
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * (radius * 0.75) ** 2)))
  const inv = 1 / (2 * sigmaColor * sigmaColor)
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float32Array(lab)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!alpha[i]) continue
      const L0 = lab[i * 3], a0 = lab[i * 3 + 1], b0 = lab[i * 3 + 2]
      let sw = 0, sL = 0, sa = 0, sb = 0, k = 0
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++, k++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = yy * w + xx
        if (!alpha[j]) continue
        const dL = lab[j * 3] - L0, da = lab[j * 3 + 1] - a0, db = lab[j * 3 + 2] - b0
        const wt = spatial[k] * Math.exp(-(dL * dL + da * da + db * db) * inv)
        sw += wt; sL += wt * lab[j * 3]; sa += wt * lab[j * 3 + 1]; sb += wt * lab[j * 3 + 2]
      }
      out[i * 3] = sL / sw; out[i * 3 + 1] = sa / sw; out[i * 3 + 2] = sb / sw
    }
    lab = out
  }
  const data = new Uint8ClampedArray(img.data)
  for (let i = 0; i < n; i++) {
    if (!alpha[i]) continue
    const [r, g, b] = labToRgb(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2])
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b
  }
  return data
}
