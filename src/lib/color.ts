export type RGB = [number, number, number]
export type Lab = [number, number, number]

const lin = (c: number) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)

/** sRGB to CIE Lab (D65). Distances in Lab track how different two threads look. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = lin(r), G = lin(g), B = lin(b)
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const fx = f(x), fy = f(y), fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function labToRgb(L: number, a: number, b: number): RGB {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883
  const R = 3.2406 * x - 1.5372 * y - 0.4986 * z
  const G = -0.9689 * x + 1.8758 * y + 0.0415 * z
  const B = 0.0557 * x - 0.204 * y + 1.057 * z
  const g = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)))
  return [g(R), g(G), g(B)]
}

export const labDist2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

export const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

export const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

/** CIEDE2000 color difference: how different two colors look to a person. */
export function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const rad = Math.PI / 180, deg = 180 / Math.PI
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const ap1 = a1 * (1 + G), ap2 = a2 * (1 + G)
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2)
  const hp = (a: number, b: number) => { if (!a && !b) return 0; const h = Math.atan2(b, a) * deg; return h < 0 ? h + 360 : h }
  const hp1 = hp(ap1, b1), hp2 = hp(ap2, b2)
  const dL = L2 - L1, dC = Cp2 - Cp1
  let dh = 0
  if (Cp1 * Cp2) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360 }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad)
  const Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2
  let hb = hp1 + hp2
  if (Cp1 * Cp2) { hb = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2 : (hp1 + hp2) / 2 }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2)
  const Sc = 1 + 0.045 * Cpb, Sh = 1 + 0.015 * Cpb * T
  const Rt = -Math.sin(2 * dTheta * rad) * Rc
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh))
}
