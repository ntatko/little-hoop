import { rgbToLab, type Lab, type RGB } from './color'

export interface Thread {
  /** Brother's PEC color index, written into the file so the machine names the thread to load. */
  id: number
  name: string
  rgb: RGB
}

/** Brother's built-in thread chart (the 64 PEC colors, minus the applique markers). */
export const BROTHER: Thread[] = [
  [1, 'Prussian Blue', 14, 31, 124], [2, 'Blue', 10, 85, 163], [3, 'Teal Green', 0, 135, 119],
  [4, 'Cornflower Blue', 75, 107, 175], [5, 'Red', 237, 23, 31], [6, 'Reddish Brown', 209, 92, 0],
  [7, 'Magenta', 145, 54, 151], [8, 'Light Lilac', 228, 154, 203], [9, 'Lilac', 145, 95, 172],
  [10, 'Mint Green', 158, 214, 125], [11, 'Deep Gold', 232, 169, 0], [12, 'Orange', 254, 186, 53],
  [13, 'Yellow', 255, 255, 0], [14, 'Lime Green', 112, 188, 31], [15, 'Brass', 186, 152, 0],
  [16, 'Silver', 168, 168, 168], [17, 'Russet Brown', 125, 111, 0], [18, 'Cream Brown', 255, 255, 179],
  [19, 'Pewter', 79, 85, 86], [20, 'Black', 0, 0, 0], [21, 'Ultramarine', 11, 61, 145],
  [22, 'Royal Purple', 119, 1, 118], [23, 'Dark Gray', 41, 49, 51], [24, 'Dark Brown', 42, 19, 1],
  [25, 'Deep Rose', 246, 74, 138], [26, 'Light Brown', 178, 118, 36], [27, 'Salmon Pink', 252, 187, 197],
  [28, 'Vermilion', 254, 55, 15], [29, 'White', 240, 240, 240], [30, 'Violet', 106, 28, 138],
  [31, 'Seacrest', 168, 221, 196], [32, 'Sky Blue', 37, 132, 187], [33, 'Pumpkin', 254, 179, 67],
  [34, 'Cream Yellow', 255, 243, 107], [35, 'Khaki', 208, 166, 96], [36, 'Clay Brown', 209, 84, 0],
  [37, 'Leaf Green', 102, 186, 73], [38, 'Peacock Blue', 19, 74, 70], [39, 'Gray', 135, 135, 135],
  [40, 'Warm Gray', 216, 204, 198], [41, 'Dark Olive', 67, 86, 7], [42, 'Linen', 253, 217, 222],
  [43, 'Pink', 249, 147, 188], [44, 'Deep Green', 0, 56, 34], [45, 'Lavender', 178, 175, 212],
  [46, 'Wisteria Violet', 104, 106, 176], [47, 'Beige', 239, 227, 185], [48, 'Carmine', 247, 56, 102],
  [49, 'Amber Red', 181, 75, 100], [50, 'Olive Green', 19, 43, 26], [51, 'Dark Fuchsia', 199, 1, 86],
  [52, 'Tangerine', 254, 158, 50], [53, 'Light Blue', 168, 222, 235], [54, 'Emerald Green', 0, 103, 62],
  [55, 'Purple', 78, 41, 144], [56, 'Moss Green', 47, 126, 32], [57, 'Flesh Pink', 255, 204, 204],
  [58, 'Harvest Gold', 255, 217, 17], [59, 'Electric Blue', 9, 91, 166], [60, 'Lemon Yellow', 240, 249, 112],
  [61, 'Fresh Green', 227, 243, 91],
].map(([id, name, r, g, b]) => ({ id: id as number, name: name as string, rgb: [r, g, b] as RGB }))

const labs: Lab[] = BROTHER.map((t) => rgbToLab(...t.rgb))

export const threadById = (id: number) => BROTHER.find((t) => t.id === id) ?? BROTHER[19]

/** The Brother thread that looks closest to a color, skipping any already taken. */
export function nearestThread(lab: Lab, taken: Set<number> = new Set()): Thread {
  let best = BROTHER[0], bestD = Infinity
  BROTHER.forEach((t, i) => {
    if (taken.has(t.id)) return
    // Lightness counts for less than hue: a golden dog should get a gold thread, not a pale gray.
    const t2 = labs[i]
    const d = 0.5 * (lab[0] - t2[0]) ** 2 + 1.4 * ((lab[1] - t2[1]) ** 2 + (lab[2] - t2[2]) ** 2)
    if (d < bestD) { bestD = d; best = t }
  })
  return best
}
