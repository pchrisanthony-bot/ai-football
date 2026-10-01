# Contact sheet: crop the middle of each filmstrip frame and tile them in a row (or grid).
#   python tools/play/sheet.py out.png frame0.png frame1.png …  [--cols=N] [--crop=x0,y0,x1,y1]
import sys
from PIL import Image
args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--'))
out, files = args[0], args[1:]
crop = tuple(int(v) for v in opt.get('crop', '300,60,660,520').split(','))
cols = int(opt.get('cols', len(files)))
ims = [Image.open(f).convert('RGB').crop(crop) for f in files]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), (20, 20, 20))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out)
print(out, sheet.size)
