import { useEffect, useRef } from 'react'
import type { RGB } from './lib/color'
import type { Design } from './lib/design'

interface Props {
  design: Design | null
  threadRgb: RGB[] // per entry in design.colors
  hoop: { w: number; h: number }
  fabric: string
  /** How many ops to draw (for playback); Infinity draws everything. */
  upTo: number
  showJumps: boolean
}

const shade = ([r, g, b]: RGB, k: number) => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`
const lift = ([r, g, b]: RGB, k: number) => `rgb(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)})`

export function Preview({ design, threadRgb, hoop, fabric, upTo, showJumps }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const size = canvas.clientWidth
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)

    // Hoop: a wooden frame around taut fabric, sized to the hoop's sewing area.
    const ring = size * 0.05
    const scale = (size - ring * 2 - 16) / Math.max(hoop.w, hoop.h)
    const fw = hoop.w * scale, fh = hoop.h * scale
    const cx = size / 2, cy = size / 2
    const r = Math.min(fw, fh) * 0.12
    const rr = (x: number, y: number, w: number, h: number, rad: number) => {
      ctx.beginPath(); ctx.roundRect(x, y, w, h, rad)
    }
    const wood = ctx.createLinearGradient(0, 0, size, size)
    wood.addColorStop(0, '#d9a56b'); wood.addColorStop(0.5, '#c48a4f'); wood.addColorStop(1, '#a8703b')
    ctx.shadowColor = 'rgba(60,35,15,0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6
    rr(cx - fw / 2 - ring, cy - fh / 2 - ring, fw + ring * 2, fh + ring * 2, r + ring)
    ctx.fillStyle = wood; ctx.fill()
    ctx.shadowColor = 'transparent'
    rr(cx - fw / 2, cy - fh / 2, fw, fh, r)
    ctx.fillStyle = fabric; ctx.fill()
    ctx.save(); ctx.clip()
    // Weave.
    ctx.globalAlpha = 0.07; ctx.strokeStyle = '#000'; ctx.lineWidth = 0.5
    for (let x = cx - fw / 2; x < cx + fw / 2; x += 3) { ctx.beginPath(); ctx.moveTo(x, cy - fh / 2); ctx.lineTo(x, cy + fh / 2); ctx.stroke() }
    for (let y = cy - fh / 2; y < cy + fh / 2; y += 3) { ctx.beginPath(); ctx.moveTo(cx - fw / 2, y); ctx.lineTo(cx + fw / 2, y); ctx.stroke() }
    ctx.globalAlpha = 1
    // Inner shadow from the hoop.
    const inner = ctx.createRadialGradient(cx, cy, Math.min(fw, fh) * 0.35, cx, cy, Math.max(fw, fh) * 0.75)
    inner.addColorStop(0, 'rgba(0,0,0,0)'); inner.addColorStop(1, 'rgba(0,0,0,0.12)')
    ctx.fillStyle = inner; ctx.fillRect(cx - fw / 2, cy - fh / 2, fw, fh)

    if (design) {
      const X = (x: number) => cx + x * scale, Y = (y: number) => cy + y * scale
      const width = Math.max(1, 0.38 * scale)
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      // Three passes per color block: shadow, thread, sheen.
      let block = 0
      let segs: number[] = []
      const flush = () => {
        if (!segs.length) return
        const rgb = threadRgb[design.order[block]] ?? [0, 0, 0]
        for (const [w, style, dx] of [[width * 1.25, shade(rgb, 0.55), 0.3], [width, `rgb(${rgb.join(',')})`, 0], [width * 0.3, lift(rgb, 0.45), -0.25]] as const) {
          ctx.lineWidth = w; ctx.strokeStyle = style
          ctx.beginPath()
          for (let i = 0; i < segs.length; i += 4) { ctx.moveTo(segs[i] + dx, segs[i + 1] + dx); ctx.lineTo(segs[i + 2] + dx, segs[i + 3] + dx) }
          ctx.stroke()
        }
        segs = []
      }
      const ops = design.ops
      const n = Math.min(ops.length, upTo)
      for (let i = 1; i < n; i++) {
        const o = ops[i], p = ops[i - 1]
        if (o.kind === 'color') { flush(); block++; continue }
        if (o.kind === 'stitch' && (p.kind === 'stitch' || p.kind === 'jump')) segs.push(X(p.x), Y(p.y), X(o.x), Y(o.y))
        else if (o.kind === 'jump' && showJumps) {
          flush()
          ctx.setLineDash([3, 3]); ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(180,40,40,0.55)'
          ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(o.x), Y(o.y)); ctx.stroke(); ctx.setLineDash([])
        }
      }
      flush()
      if (n < ops.length && n > 0) {
        // The needle.
        const o = ops[n - 1]
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      }
    }
    ctx.restore()
  }, [design, threadRgb, hoop, fabric, upTo, showJumps])

  return <canvas ref={ref} className="preview" aria-label="Stitch preview" />
}
