import { writeFileSync } from 'node:fs'
import { buildSized } from '../src/lib/design'
import { writeDST, writePES } from '../src/lib/formats'

const W = 340, H = 340
const data = new Uint8ClampedArray(W * H * 4)
const put = (x: number, y: number, r: number, g: number, b: number) => { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255 }
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const dx = x - 170, dy = y - 180, r = Math.hypot(dx, dy)
  if (r < 140) {
    put(x, y, 250, 200, 60) // yellow face
    if (Math.hypot(x - 120, y - 140) < 18 || Math.hypot(x - 220, y - 140) < 18) put(x, y, 30, 30, 40) // eyes
    if (r > 70 && r < 85 && dy > 20 && Math.abs(dx) < 70) put(x, y, 200, 40, 50) // mouth
  }
  if (y < 70 && y > 30 && Math.abs(x - 170) < 120 && r < 160) put(x, y, 60, 90, 200) // hair band
}
const img = { width: W, height: H, data, colorSpace: 'srgb' } as unknown as ImageData
const t0 = performance.now()
const d = buildSized(img, W * 0.25, H * 0.25, { colors: 5, maxW: 90, maxH: 90, scale: 1, minArea: 4, density: 0.4, angle: 45, underlay: true, lines: 'outline', cartoon: false, skip: [], smooth: 0 })
console.log(`built in ${(performance.now() - t0).toFixed(0)} ms: ${d.stitches} stitches, ${d.jumps} jumps, ${d.order.length} color blocks, ${d.width.toFixed(1)}x${d.height.toFixed(1)} mm`)
console.log('colors', d.order.map((i) => `${d.colors[i].thread}:${d.colors[i].rgb}`).join('  '))
const long = d.ops.filter((o, i) => i > 0 && o.kind === 'stitch' && d.ops[i - 1].kind === 'stitch' && Math.hypot(o.x - d.ops[i - 1].x, o.y - d.ops[i - 1].y) > 4)
console.log('stitches longer than 4mm:', long.length)
writeFileSync(process.argv[2] + '/smoke.pes', writePES(d, 'smoke'))
writeFileSync(process.argv[2] + '/smoke.dst', writeDST(d, 'smoke'))
