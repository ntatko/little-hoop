# Runs Little Hoop on test pictures and renders the stitches next to each original.
import json, subprocess, sys, os
from PIL import Image, ImageDraw, ImageFont
import pyembroidery as pe

S = sys.argv[1]; cases = json.loads(sys.argv[2]); tag = sys.argv[3] if len(sys.argv) > 3 else 'bench'
MM_PX = 0.25; FIT = 85

def render(pes, size=480):
    p = pe.read(pes); x0, y0, x1, y1 = p.bounds()
    k = (size - 20) / max(x1 - x0, y1 - y0)
    im = Image.new('RGB', (size, size), '#f7f4ee'); d = ImageDraw.Draw(im)
    cols = [t.color for t in p.threadlist]; ci = 0; prev = None
    ox = (size - (x1 - x0) * k) / 2; oy = (size - (y1 - y0) * k) / 2
    w = max(1, round(0.4 * 10 * k))
    for x, y, c in p.stitches:
        c &= pe.COMMAND_MASK
        P = ((x - x0) * k + ox, (y - y0) * k + oy)
        if c == pe.COLOR_CHANGE: ci += 1; prev = None; continue
        if c in (pe.JUMP, pe.TRIM): prev = P; continue
        if c == pe.STITCH and prev:
            col = cols[min(ci, len(cols) - 1)]
            d.line([prev, P], fill='#%06x' % col, width=w)
        prev = P
    return im

tiles = []
for c in cases:
    src = Image.open(os.path.join(S, c['file'])).convert('RGBA')
    k = FIT / MM_PX / max(src.size)
    small = src.resize((max(8, round(src.width * k)), max(8, round(src.height * k))), Image.LANCZOS)
    raw = os.path.join(S, 'tmp.rgba'); open(raw, 'wb').write(small.tobytes())
    out = os.path.join(S, c['file'] + '.pes')
    res = subprocess.run(['npx', 'tsx', 'scripts/run.ts', raw, str(small.width), str(small.height), out,
                          str(c.get('colors', 6)), str(c.get('detail', 4)), c.get('lines', 'none'), '1' if c.get('cartoon') else '0'],
                         capture_output=True, text=True)
    if res.returncode: print(res.stderr[-2000:]); continue
    info = json.loads(res.stdout.strip().splitlines()[-1]); print(c['file'], info)
    orig = Image.new('RGB', (480, 480), '#ffffff'); t = src.copy(); t.thumbnail((460, 460))
    orig.paste(t, ((480 - t.width) // 2, (480 - t.height) // 2), t)
    st = render(out)
    tile = Image.new('RGB', (960, 510), '#ffffff'); tile.paste(orig, (0, 0)); tile.paste(st, (480, 0))
    ImageDraw.Draw(tile).text((10, 488), f"{c['file']}  colors={c.get('colors',6)} detail={c.get('detail',4)} cartoon={c.get('cartoon',False)} lines={c.get('lines','none')}  stitches={info['stitches']} trims={info['trims']}", fill='#333')
    tiles.append(tile)
sheet = Image.new('RGB', (960, 510 * len(tiles)), '#fff')
for i, t in enumerate(tiles): sheet.paste(t, (0, 510 * i))
sheet.save(os.path.join(S, tag + '.png')); print('saved', tag)
