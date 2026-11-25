# Little Hoop

Turns a photo into an embroidery file for a Brother home machine (single needle, PES over USB).
Everything runs in the browser: background removal, color reduction, stitch generation, export.

Pipeline (`src/lib`):

1. `image.ts` — load, cut out the background (IMG.LY, on device), crop.
2. `quantize.ts` — blur away grain, k-means to N colors in Lab, fold specks into neighbors.
3. `trace.ts` — trace each color into outline + hole polygons, simplified.
4. `fill.ts` — tatami fill: staggered rows, blocks around holes, travel along edges.
5. `design.ts` — order colors (largest first), underlay, ties, hidden travel under colors still to come, outline.
6. `formats.ts` — PES (v1 + PEC block, Brother thread indices) and DST.

`npx tsx scripts/smoke.ts <dir>` writes a test PES/DST; check them with `pyembroidery`.

Background removal uses `@imgly/background-removal` (AGPL-3.0), so a hosted copy should link to this source.
