# Tile a filmstrip (tools/play/out/film-<label>-<move>-<i>.png) into one sheet.
#   python tools/play/filmsheet.py <label> <move> [cols=8] [crop=x0,y0,x1,y1]
import sys, glob, os
from PIL import Image
label, move = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 8
crop = tuple(int(v) for v in (sys.argv[4] if len(sys.argv) > 4 else '300,40,660,520').split(','))
out = os.path.join(os.path.dirname(__file__), 'out')
fs = sorted(glob.glob(os.path.join(out, f'film-{label}-{move}-*.png')), key=lambda f: int(f.rsplit('-', 1)[1].split('.')[0]))
w, h = crop[2] - crop[0], crop[3] - crop[1]
tw, th = 270, int(270 * h / w)
ims = [Image.open(f).convert('RGB').crop(crop).resize((tw, th)) for f in fs]
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (tw * cols, th * rows), (20, 20, 20))
for i, im in enumerate(ims): sheet.paste(im, ((i % cols) * tw, (i // cols) * th))
dst = os.path.join(out, f'sheet-{label}-{move}.png'); sheet.save(dst); print(dst, sheet.size, len(ims))
