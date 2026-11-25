import { buildSized } from '../src/lib/design'
const W = 340, H = 340
const data = new Uint8ClampedArray(W * H * 4)
const put = (x: number, y: number, r: number, g: number, b: number) => { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255 }
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = x - 170, dy = y - 180, r = Math.hypot(dx, dy)
  if (r < 140) { put(x, y, 250, 200, 60); if (Math.hypot(x - 120, y - 140) < 18 || Math.hypot(x - 220, y - 140) < 18) put(x, y, 30, 30, 40); if (r > 70 && r < 85 && dy > 20 && Math.abs(dx) < 70) put(x, y, 200, 40, 50) }
  if (y < 70 && y > 30 && Math.abs(x - 170) < 120 && r < 160) put(x, y, 60, 90, 200)
}
const d = buildSized({ width: W, height: H, data } as unknown as ImageData, W * 0.25, H * 0.25, { colors: 5, maxW: 90, maxH: 90, scale: 1, minArea: 4, density: 0.4, angle: 45, underlay: true, lines: 'outline', cartoon: false, skip: [], smooth: 0 })
const hist = new Map<string, number>()
d.ops.forEach((o, i) => {
  if (i === 0 || o.kind !== 'stitch' || d.ops[i - 1].kind !== 'stitch') return
  const L = Math.hypot(o.x - d.ops[i - 1].x, o.y - d.ops[i - 1].y)
  if (L > 4) { const k = L.toFixed(0); hist.set(k, (hist.get(k) ?? 0) + 1); if ((hist.get(k) ?? 0) < 2) console.log(i, L.toFixed(2), JSON.stringify(d.ops.slice(i - 3, i + 2).map((p) => [p.x.toFixed(1), p.y.toFixed(1), p.kind]))) }
})
console.log([...hist].sort())
