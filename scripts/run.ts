// Usage: tsx scripts/run.ts <raw.rgba> <w> <h> <out.pes> [colors] [detail] [outline]
import { readFileSync, writeFileSync } from 'node:fs'
import { buildSized } from '../src/lib/design'
import { writePES } from '../src/lib/formats'
import { threadById } from '../src/lib/threads'
const [raw, ws, hs, out, cs = '6', ds = '4', os = '0'] = process.argv.slice(2)
const w = +ws, h = +hs, detail = +ds
const data = new Uint8ClampedArray(readFileSync(raw))
const img = { width: w, height: h, data } as unknown as ImageData
const d = buildSized(img, w * 0.25, h * 0.25, {
  colors: +cs, maxW: 92, maxH: 92, scale: 1,
  minArea: 16 * Math.pow(1.5 / 16, (detail - 1) / 9), smooth: Math.round((10 - detail) / 3),
  density: 0.4, angle: 45, underlay: true, outline: os === '1', skip: [],
})
writeFileSync(out, writePES(d, 'test'))
console.log(JSON.stringify({ stitches: d.stitches, trims: d.jumps, colors: d.order.length, threads: d.order.map((i) => threadById(d.colors[i].thread).name + ' for ' + d.colors[i].rgb.join(',')), mm: [+d.width.toFixed(1), +d.height.toFixed(1)] }))
