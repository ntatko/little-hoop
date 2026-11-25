/** Loads a picture file, shrunk so its longest side is at most `max` pixels. */
export async function loadImage(file: Blob, max = 1400): Promise<ImageData> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k)
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

export async function toBlob(img: ImageData): Promise<Blob> {
  const c = new OffscreenCanvas(img.width, img.height)
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}

/** Trims fully transparent margins (left by background removal), keeping a small border. */
export function cropToContent(img: ImageData, pad = 4): ImageData {
  const { width: w, height: h, data } = img
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] < 128) continue
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  if (x1 < 0) return img
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad)
  const c = new OffscreenCanvas(w, h)
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c.getContext('2d')!.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1)
}

/**
 * Removes the background with a model that runs in the browser (downloaded once, then
 * cached). Returns the picture at its original size with the background made transparent,
 * so touch-ups can line up with the original.
 */
export async function removeBackground(img: ImageData, onProgress: (fraction: number, label: string) => void): Promise<ImageData> {
  const { removeBackground } = await import('@imgly/background-removal')
  const blob = await removeBackground(await toBlob(img), {
    model: 'isnet_fp16',
    output: { format: 'image/png' },
    progress: (key, current, total) => onProgress(total ? current / total : 0, key.startsWith('fetch') ? 'Downloading the cutout model (once)' : 'Cutting out'),
  })
  const cut = await loadImage(blob, Math.max(img.width, img.height))
  // Keep the original colors; take only the mask from the model's output.
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height)
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = cut.width === img.width ? cut.data[i] : 255
  return out
}

/**
 * Tells photos from flat artwork: clip art spends most of its pixels on a handful of exact
 * colors, photos spread them over thousands.
 */
export function looksLikePhoto(img: ImageData): boolean {
  const counts = new Map<number, number>()
  let total = 0
  for (let i = 0; i < img.data.length; i += 16) { // every 4th pixel is plenty
    if (img.data[i + 3] < 128) continue
    const key = ((img.data[i] >> 3) << 10) | ((img.data[i + 1] >> 3) << 5) | (img.data[i + 2] >> 3)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    total++
  }
  if (!total) return false
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, 16).reduce((a, b) => a + b, 0)
  return top / total < 0.7
}

/** True when the picture already has a cut-out background (a transparent PNG, say). */
export function hasTransparency(img: ImageData): boolean {
  const { data } = img
  let clear = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) clear++
  return clear > (data.length / 4) * 0.02
}
