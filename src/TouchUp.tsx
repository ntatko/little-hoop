import { useEffect, useRef, useState } from 'react'

interface Props {
  original: ImageData
  /** Same size as original; alpha says what's kept. */
  masked: ImageData
  onDone: (masked: ImageData) => void
  onCancel: () => void
}

/** Brush away leftover background, or paint back bits the cutout took by mistake. */
export function TouchUp({ original, masked, onDone, onCancel }: Props) {
  const view = useRef<HTMLCanvasElement>(null)
  const alpha = useRef<Uint8ClampedArray>(new Uint8ClampedArray(0))
  const history = useRef<Uint8ClampedArray[]>([])
  const [mode, setMode] = useState<'erase' | 'restore'>('erase')
  const [size, setSize] = useState(24)
  const [canUndo, setCanUndo] = useState(false)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const { width: w, height: h } = original

  useEffect(() => {
    const a = new Uint8ClampedArray(w * h)
    for (let i = 0; i < w * h; i++) a[i] = masked.data[i * 4 + 3]
    alpha.current = a
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masked])

  // Kept pixels in full color; removed ones faded so you can see what to restore.
  function paint() {
    const c = view.current!
    c.width = w; c.height = h
    const img = new ImageData(w, h)
    const a = alpha.current
    for (let i = 0; i < w * h; i++) {
      const k = a[i] / 255
      img.data[i * 4] = original.data[i * 4]
      img.data[i * 4 + 1] = original.data[i * 4 + 1]
      img.data[i * 4 + 2] = original.data[i * 4 + 2]
      img.data[i * 4 + 3] = 50 + 205 * k
    }
    c.getContext('2d')!.putImageData(img, 0, 0)
  }

  function at(e: React.PointerEvent) {
    const r = view.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h, scale: w / r.width }
  }

  function dab(x0: number, y0: number, x1: number, y1: number, radius: number) {
    const a = alpha.current
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (radius / 3)))
    const value = mode === 'erase' ? 0 : 255
    for (let s = 0; s <= steps; s++) {
      const cx = x0 + ((x1 - x0) * s) / steps, cy = y0 + ((y1 - y0) * s) / steps
      for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(h - 1, Math.ceil(cy + radius)); y++)
        for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(w - 1, Math.ceil(cx + radius)); x++)
          if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) a[y * w + x] = value
    }
  }

  function down(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    history.current.push(alpha.current.slice())
    if (history.current.length > 30) history.current.shift()
    setCanUndo(true)
    drawing.current = true
    const p = at(e)
    last.current = p
    dab(p.x, p.y, p.x, p.y, (size / 2) * p.scale)
    paint()
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current || !last.current) return
    const p = at(e)
    dab(last.current.x, last.current.y, p.x, p.y, (size / 2) * p.scale)
    last.current = p
    paint()
  }
  function up() { drawing.current = false; last.current = null }

  function undo() {
    const prev = history.current.pop()
    if (prev) { alpha.current = prev; paint() }
    setCanUndo(history.current.length > 0)
  }

  function done() {
    const out = new ImageData(new Uint8ClampedArray(original.data), w, h)
    for (let i = 0; i < w * h; i++) out.data[i * 4 + 3] = alpha.current[i]
    onDone(out)
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Touch up the cutout">
      <div className="sheet">
        <div className="sheet-head">
          <h2>Touch up the cutout</h2>
          <p>Brush away leftover background, or paint back anything the cutout took by mistake.</p>
        </div>
        <div className="seg">
          <button className={mode === 'erase' ? 'on' : ''} onClick={() => setMode('erase')}>Erase</button>
          <button className={mode === 'restore' ? 'on' : ''} onClick={() => setMode('restore')}>Restore</button>
        </div>
        <div className="canvasbox">
          <canvas ref={view} className={`touch ${mode}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            style={{ aspectRatio: `${w} / ${h}` }} />
        </div>
        <label className="slider">
          <span className="lab">Brush size<b>{size}px</b></span>
          <input type="range" min={6} max={80} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <div className="sheet-foot">
          <button onClick={undo} disabled={!canUndo}>Undo</button>
          <span className="grow" />
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={done}>Done</button>
        </div>
      </div>
    </div>
  )
}
