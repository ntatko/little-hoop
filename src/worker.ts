import { buildDesign, type DesignParams } from './lib/design'

// Building a design takes a few hundred milliseconds on a big picture; keep it off the UI thread.
self.onmessage = (e: MessageEvent<{ id: number; img: ImageData; params: DesignParams }>) => {
  const { id, img, params } = e.data
  try {
    const design = buildDesign(img, params)
    ;(self as unknown as Worker).postMessage({ id, design })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
