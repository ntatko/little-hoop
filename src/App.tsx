import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hex, type RGB } from './lib/color'
import type { Design, DesignParams } from './lib/design'
import { writeDST, writePES } from './lib/formats'
import { cropToContent, hasTransparency, loadImage, looksLikePhoto, removeBackground } from './lib/image'
import { BROTHER, threadById } from './lib/threads'
import { Preview } from './Preview'
import { TouchUp } from './TouchUp'

const HOOPS = [
  { id: '4x4', label: '4 × 4 in', w: 100, h: 100 },
  { id: '5x7', label: '5 × 7 in', w: 130, h: 180 },
  { id: '6x10', label: '6 × 10 in', w: 160, h: 260 },
]
const FABRICS = [
  { name: 'White cotton', color: '#f7f4ee' },
  { name: 'Natural linen', color: '#d9ccb4' },
  { name: 'Denim', color: '#3e5a7a' },
  { name: 'Black', color: '#1d1c1f' },
  { name: 'Blush', color: '#efc9c4' },
  { name: 'Sage', color: '#a9b79c' },
]
const DENSITY = [
  { label: 'Light', mm: 0.5 },
  { label: 'Standard', mm: 0.4 },
  { label: 'Dense', mm: 0.33 },
]
/** Stitches per minute, a middle-of-the-road speed for a home machine. */
const SPM = 550

type Stage = 'empty' | 'cutting' | 'ready'

export default function App() {
  const [stage, setStage] = useState<Stage>('empty')
  const [progress, setProgress] = useState<{ f: number; label: string } | null>(null)
  const [name, setName] = useState('design')
  const [original, setOriginal] = useState<ImageData | null>(null)
  /** The original with the background made transparent, same size, for touch-ups. */
  const [masked, setMasked] = useState<ImageData | null>(null)
  const cutout = useMemo(() => (masked ? cropToContent(masked) : null), [masked])
  const [touching, setTouching] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [useCutout, setUseCutout] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [colors, setColors] = useState(5)
  const [hoopId, setHoopId] = useState('4x4')
  const [scale, setScale] = useState(0.9)
  const [detail, setDetail] = useState(4)
  const [density, setDensity] = useState(1)
  const [angle, setAngle] = useState(45)
  const [underlay, setUnderlay] = useState(true)
  const [lines, setLines] = useState<'none' | 'outline' | 'cartoon'>('none')
  const [cartoon, setCartoon] = useState(false)
  const [skip, setSkip] = useState<number[]>([])
  const [threads, setThreads] = useState<Record<number, number>>({})
  const [picking, setPicking] = useState<number | null>(null)

  const [fabric, setFabric] = useState(FABRICS[0].color)
  const [design, setDesign] = useState<Design | null>(null)
  const [busy, setBusy] = useState(false)
  const [upTo, setUpTo] = useState(Infinity)
  const [playing, setPlaying] = useState(false)
  const [showJumps, setShowJumps] = useState(false)

  const hoop = HOOPS.find((h) => h.id === hoopId)!
  const source = useCutout && cutout ? cutout : original

  // Colors, picture and hoop change what the regions are, so per-color choices start over.
  useEffect(() => { setSkip([]); setThreads({}) }, [colors, source])

  const params: DesignParams = useMemo(() => ({
    colors, maxW: hoop.w - 8, maxH: hoop.h - 8, scale,
    // Detail 1..10 → smallest patch 16 mm² (bold) .. 1.5 mm² (fine).
    minArea: 16 * Math.pow(1.5 / 16, (detail - 1) / 9),
    density: DENSITY[density].mm, angle, underlay, lines, cartoon, skip,
    smooth: Math.round((10 - detail) / 3),
  }), [colors, hoop, scale, detail, density, angle, underlay, lines, cartoon, skip])

  // Rebuild in the worker whenever anything changes; only the newest result is kept.
  const worker = useRef<Worker | null>(null)
  const latest = useRef(0)
  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; design?: Design; error?: string }>) => {
      if (e.data.id !== latest.current) return
      setBusy(false)
      if (e.data.error) setError(e.data.error)
      else { setDesign(e.data.design!); setUpTo(Infinity); setPlaying(false) }
    }
    worker.current = w
    return () => w.terminate()
  }, [])
  useEffect(() => {
    if (!source || !worker.current) return
    const id = ++latest.current
    setBusy(true)
    const t = setTimeout(() => worker.current!.postMessage({ id, img: source, params }), 120)
    return () => clearTimeout(t)
  }, [source, params])

  const threadFor = useCallback((i: number) => threadById(threads[i] ?? design?.colors[i]?.thread ?? 20), [threads, design])
  // The preview shows the picture's own colors (what to aim for when choosing spools) unless
  // a specific thread was picked for a color.
  const threadRgb: RGB[] = useMemo(() => (design ? design.colors.map((c, i) => (threads[i] ? threadFor(i).rgb : c.rgb)) : []), [design, threads, threadFor])

  // Playback: sew the design out in stitch order.
  useEffect(() => {
    if (!playing || !design) return
    let raf = 0
    const total = design.ops.length
    const perFrame = Math.max(8, Math.round(total / 600))
    const tick = () => {
      setUpTo((u) => {
        const next = (u === Infinity ? 0 : u) + perFrame
        if (next >= total) { setPlaying(false); return Infinity }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, design])

  async function open(file: File) {
    setError(null)
    setName(file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 24) || 'design')
    const img = await loadImage(file)
    setOriginal(img); setMasked(null); setDesign(null)
    // Photos stitch best flattened into a few tones with an outline; artwork as it is.
    const photo = looksLikePhoto(img)
    setCartoon(photo); setLines(photo ? 'outline' : 'none'); setColors(photo ? 4 : 5)
    setNote(photo ? 'Looks like a photo, so it starts with Cartoon style, an outline, and 4 colors.' : null)
    if (hasTransparency(img)) {
      // Already cut out: the model would only nibble at the edges.
      setMasked(img); setUseCutout(true); setStage('ready')
      return
    }
    setStage('cutting')
    try {
      setMasked(await removeBackground(img, (f, label) => setProgress({ f, label })))
      setUseCutout(true)
    } catch (e) {
      setUseCutout(false)
      setError("Couldn't cut out the background, so the whole picture is used. Uncheck colors below to leave them out.")
      console.error(e)
    }
    setProgress(null)
    setStage('ready')
  }

  function download(kind: 'pes' | 'dst') {
    if (!design) return
    const withThreads: Design = { ...design, colors: design.colors.map((c, i) => ({ ...c, thread: threadFor(i).id })) }
    const bytes = kind === 'pes' ? writePES(withThreads, name) : writeDST(withThreads, name)
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url; a.download = `${name}.${kind}`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const minutes = design ? Math.max(1, Math.round(design.stitches / SPM + design.order.length * 1.5)) : 0
  const tooBig = design && (design.width > hoop.w || design.height > hoop.h)

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="4" /><path d="M8 32 L33 7" stroke="var(--thread)" strokeWidth="2.4" strokeLinecap="round" /><circle cx="31" cy="9" r="2.2" fill="none" stroke="var(--ink)" strokeWidth="1.4" /></svg>
          <div><h1>Little Hoop</h1><p>Photos into embroidery files for a Brother machine</p></div>
        </div>
      </header>

      {stage === 'empty' ? (
        <Drop onFile={open} />
      ) : (
        <main className="work">
          <aside className="panel">
            <section className="card">
              <h2><span>1</span>Picture</h2>
              <div className="pics">
                {original && <Thumb img={original} label="Original" active={!useCutout || !cutout} onClick={() => setUseCutout(false)} />}
                {cutout && <Thumb img={cutout} label="Cut out" active={useCutout} onClick={() => setUseCutout(true)} checker />}
                {stage === 'cutting' && <div className="thumb pending"><div className="bar"><i style={{ width: `${Math.round((progress?.f ?? 0) * 100)}%` }} /></div><small>{progress?.label ?? 'Cutting out'}…</small></div>}
              </div>
              {masked && original && (
                <button className="link" onClick={() => setTouching(true)}>Touch up the cutout</button>
              )}
              {note && <p className="hint">{note}</p>}
              <label className="file">Choose another picture<input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} /></label>
            </section>

            <section className="card">
              <h2><span>2</span>Threads</h2>
              <Slider label="Colors" value={colors} min={2} max={10} onChange={setColors} show={`${colors}`} />
              <ul className="threads">
                {design?.colors.map((c, i) => {
                  const t = threadFor(i)
                  const isOutline = i >= design.paletteSize
                  if (!isOutline && c.share === 0 && !skip.includes(i)) return null
                  return (
                    <li key={i} className={skip.includes(i) ? 'off' : ''}>
                      {!isOutline ? (
                        <input type="checkbox" aria-label={`Stitch ${t.name}`} checked={!skip.includes(i)} onChange={() => setSkip((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))} />
                      ) : <span className="spacer" />}
                      <span className="photo" style={{ background: hex(c.rgb) }} title="Color in the picture" />
                      <button className="chip" onClick={() => setPicking(picking === i ? null : i)}>
                        <span className="dot" style={{ background: hex(t.rgb) }} />
                        <span className="tname">{t.name}</span>
                        <span className="tnum">#{t.id}</span>
                      </button>
                      <span className="share">{isOutline ? 'outline' : `${Math.round(c.share * 100)}%`}</span>
                      {picking === i && (
                        <div className="picker" role="listbox" aria-label="Brother threads">
                          {BROTHER.map((b) => (
                            <button key={b.id} title={`${b.name} (#${b.id})`} style={{ background: hex(b.rgb) }} className={b.id === t.id ? 'on' : ''}
                              onClick={() => { setThreads((m) => ({ ...m, [i]: b.id })); setPicking(null) }} />
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
              <p className="hint">Uncheck a color to leave it unstitched, like a leftover bit of background. Tap a thread to swap it for one you have.</p>
            </section>

            <section className="card">
              <h2><span>3</span>Size</h2>
              <div className="seg">
                {HOOPS.map((h) => <button key={h.id} className={h.id === hoopId ? 'on' : ''} onClick={() => setHoopId(h.id)}>{h.label}</button>)}
              </div>
              <Slider label="Size in hoop" value={Math.round(scale * 100)} min={30} max={100} onChange={(v) => setScale(v / 100)} show={design ? `${(design.width / 25.4).toFixed(1)} × ${(design.height / 25.4).toFixed(1)} in` : ''} />
            </section>

            <section className="card">
              <h2><span>4</span>Stitches</h2>
              <div className="row"><span>Style</span>
                <div className="seg small">
                  <button className={!cartoon ? 'on' : ''} onClick={() => setCartoon(false)}>As is</button>
                  <button className={cartoon ? 'on' : ''} onClick={() => setCartoon(true)}>Cartoon</button>
                </div>
              </div>
              {cartoon && <p className="hint">Flattens shading into a few clean tones. Best for photos.</p>}
              <Slider label="Detail" value={detail} min={1} max={10} onChange={setDetail} show={detail <= 3 ? 'Bold' : detail >= 8 ? 'Fine' : 'Medium'} />
              <div className="row"><span>Fill</span>
                <div className="seg small">{DENSITY.map((d, i) => <button key={d.label} className={i === density ? 'on' : ''} onClick={() => setDensity(i)}>{d.label}</button>)}</div>
              </div>
              <Slider label="Stitch direction" value={angle} min={0} max={175} step={5} onChange={setAngle} show={`${angle}°`} />
              <label className="check"><input type="checkbox" checked={underlay} onChange={(e) => setUnderlay(e.target.checked)} /> Underlay <small>(steadies the fabric; leave on)</small></label>
              <div className="row"><span>Lines</span>
                <div className="seg small">
                  <button className={lines === 'none' ? 'on' : ''} onClick={() => setLines('none')}>None</button>
                  <button className={lines === 'outline' ? 'on' : ''} onClick={() => setLines('outline')}>Outline</button>
                  <button className={lines === 'cartoon' ? 'on' : ''} onClick={() => setLines('cartoon')}>Cartoon</button>
                </div>
              </div>
              {lines !== 'none' && <p className="hint">{lines === 'outline' ? 'A bold dark line around the whole subject.' : 'Dark lines around the subject and between light and dark areas, like a coloring book.'}</p>}
            </section>
          </aside>

          <section className="stage">
            <div className="hoopwrap">
              <Preview design={design} threadRgb={threadRgb} hoop={hoop} fabric={fabric} upTo={upTo} showJumps={showJumps} />
              {(busy || stage === 'cutting') && <div className="working">{stage === 'cutting' ? 'Cutting out the background…' : 'Stitching…'}</div>}
            </div>
            <div className="toolbar">
              <button className="play" disabled={!design} onClick={() => { if (playing) setPlaying(false); else { setUpTo(0); setPlaying(true) } }}>{playing ? 'Pause' : 'Sew it out'}</button>
              <div className="fabrics" role="radiogroup" aria-label="Fabric">
                {FABRICS.map((f) => <button key={f.color} role="radio" aria-checked={fabric === f.color} title={f.name} style={{ background: f.color }} className={fabric === f.color ? 'on' : ''} onClick={() => setFabric(f.color)} />)}
              </div>
              <label className="check tiny"><input type="checkbox" checked={showJumps} onChange={(e) => setShowJumps(e.target.checked)} /> Show jumps</label>
            </div>
            {design && (
              <div className="stats">
                <div><b>{design.stitches.toLocaleString()}</b><span>stitches</span></div>
                <div><b>{design.order.length}</b><span>thread changes</span></div>
                <div><b>{design.jumps}</b><span>threads to trim</span></div>
                <div><b>~{minutes} min</b><span>to stitch</span></div>
              </div>
            )}
            {tooBig && <p className="warn">This is bigger than the hoop. Make it smaller or pick a bigger hoop.</p>}
            {error && <p className="warn">{error}</p>}
            <div className="export">
              <button className="primary" disabled={!design || busy} onClick={() => download('pes')}>Download for Brother (.pes)</button>
              <button disabled={!design || busy} onClick={() => download('dst')}>.dst</button>
            </div>
            <p className="hint center">Copy the file to a USB stick, plug it into the machine, and load the threads in the order shown.</p>
            {design && (
              <ol className="order">
                {design.order.map((ci, n) => {
                  const t = threadFor(ci)
                  return <li key={n}><span className="dot" style={{ background: hex(t.rgb) }} />{t.name} <small>#{t.id}</small></li>
                })}
              </ol>
            )}
          </section>
        </main>
      )}
      {touching && original && masked && (
        <TouchUp original={original} masked={masked}
          onDone={(m) => { setMasked(m); setUseCutout(true); setTouching(false) }}
          onCancel={() => setTouching(false)} />
      )}
      <footer className="foot">Background removal by <a href="https://github.com/imgly/background-removal-js">IMG.LY</a>, runs on your device (AGPL). Nothing is uploaded.</footer>
    </div>
  )
}

function Drop({ onFile }: { onFile: (f: File) => void }) {
  const [over, setOver] = useState(false)
  return (
    <main className={`drop ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}>
      <div className="dropcard">
        <div className="hoopart" aria-hidden="true" />
        <h2>Drop a picture to stitch</h2>
        <p>A pet, a kid's drawing, a logo, a favorite face. Simple pictures with clear shapes stitch best.</p>
        <label className="primary big">Choose a picture<input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
        <small>Everything happens in your browser. Nothing is uploaded.</small>
      </div>
    </main>
  )
}

function Thumb({ img, label, active, onClick, checker }: { img: ImageData; label: string; active: boolean; onClick: () => void; checker?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    c.width = img.width; c.height = img.height
    c.getContext('2d')!.putImageData(img, 0, 0)
  }, [img])
  return (
    <button className={`thumb ${active ? 'on' : ''} ${checker ? 'checker' : ''}`} onClick={onClick}>
      <canvas ref={ref} />
      <small>{label}</small>
    </button>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, show }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; show: string }) {
  return (
    <label className="slider">
      <span className="lab">{label}<b>{show}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}
