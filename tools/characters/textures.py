# Web-sized textures for the players (from the MakeHuman CC0 asset pack via each asset's
# .mhmat), written next to player_base.glb as WebP, plus a manifest the game reads.
#   python tools/characters/textures.py
import os, re, json
from PIL import Image

DATA = os.path.expandvars(r'%APPDATA%\Blender Foundation\Blender\5.2\extensions\.user\blender_org\mpfb\data')
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'players', 'textures')
os.makedirs(OUT, exist_ok=True)

def mhmat(path):
    """{ diffuse, normal, ao, … } absolute texture paths from a MakeHuman material file."""
    keys = { 'diffuseTexture': 'diffuse', 'normalmapTexture': 'normal', 'aomapTexture': 'ao', 'specularmapTexture': 'spec', 'transmissionmapTexture': 'sss' }
    out = {}
    for line in open(path, encoding='utf8', errors='ignore'):
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0] in keys:
            p = os.path.join(os.path.dirname(path), parts[1].strip())
            if os.path.isfile(p): out[keys[parts[0]]] = p
    return out

def save(src, name, size, alpha=False, quality=88):
    im = Image.open(src)
    im = im.convert('RGBA' if alpha or im.mode in ('RGBA', 'LA', 'P') and 'transparency' in im.info or im.mode == 'RGBA' else 'RGB')
    if max(im.size) > size:
        k = size / max(im.size)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    dst = os.path.join(OUT, name + '.webp')
    im.save(dst, 'WEBP', quality=quality, method=6)
    return { 'file': 'textures/' + name + '.webp', 'size': list(im.size), 'alpha': im.mode == 'RGBA', 'bytes': os.path.getsize(dst) }

manifest = {}
def put(slot, mat_path, size, alpha=False):
    m = mhmat(mat_path)
    manifest[slot] = { k: save(p, f'{slot}_{k}', size if k == 'diffuse' else size // 2 if k != 'normal' else size, alpha and k == 'diffuse') for k, p in m.items() if k in ('diffuse', 'normal', 'ao') }

# skin tones (the game picks one per player, then tints subtly)
for tone, d in [('light', 'young_caucasian_male'), ('olive', 'young_caucasian_male2'), ('tan', 'young_asian_male'), ('dark', 'young_african_male')]:
    put('skin_' + tone, os.path.join(DATA, 'skins', d, d + '.mhmat'), 2048)
for col in ['brown', 'brownlight', 'blue', 'green', 'grey']:
    put('eye_' + col, os.path.join(DATA, 'eyes', 'materials', col + '.mhmat'), 512)
put('brows', os.path.join(DATA, 'eyebrows', 'eyebrow001', 'eyebrow001.mhmat'), 512, alpha=True)
put('lashes', os.path.join(DATA, 'eyelashes', 'eyelashes01', 'eyelashes01.mhmat'), 512, alpha=True)
for h in ['short02', 'short04', 'afro01', 'short01']:
    put('hair_' + h, os.path.join(DATA, 'hair', h, h + '.mhmat'), 1024, alpha=True)
put('kit', os.path.join(DATA, 'clothes', 'male_casualsuit04', 'male_casualsuit04.mhmat'), 2048)
put('boots', os.path.join(DATA, 'clothes', 'shoes06', 'shoes06.mhmat'), 1024)
# the boots in greyscale, lifted: the game tints them per player (boot colours vary)
bp = os.path.join(OUT, 'boots_diffuse.webp')
Image.open(bp).convert('L').point(lambda v: min(255, int(v * 2.8))).save(bp, 'WEBP', quality=88, method=6)
manifest['boots']['diffuse']['bytes'] = os.path.getsize(bp)

# The kit mask, from the tee/jeans layout: R = shirt fabric, G = trim (collar, cuffs, hem),
# B = shorts — the game paints each player's kit from it (team colours, name, number).
import numpy as np
from PIL import ImageFilter, ImageDraw
N = 1024
src = np.asarray(Image.open(os.path.join(DATA, 'clothes', 'male_casualsuit04', 'male_casualsuit04_diffuse.png')).convert('RGB').resize((N, N), Image.BILINEAR)).astype(np.int32)
r, g, b = src[..., 0], src[..., 1], src[..., 2]
bg = (np.abs(r - 61) < 14) & (np.abs(g - 96) < 14) & (np.abs(b - 117) < 14)
yy, xx = np.mgrid[0:N, 0:N]
logo = (xx - 1078 / 2) ** 2 + (yy - 322 / 2) ** 2 < (120 / 2) ** 2           # the front print
orange = (r > 190) & (g > 90) & (g < 185) & (b < 90)
collar = (b > 110) & (r < 40) & (g < 90) & (yy < N * 0.09)
top = yy < N * 0.385
# the panels: off the background, closed, holes filled from the border, edges cleaned
im = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8))
im = im.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))     # close small gaps
fill = im.copy(); ImageDraw.floodfill(fill, (0, 0), 128)                       # outside reached from the corner
fabric = np.asarray(fill) != 128
fabric = np.asarray(Image.fromarray((fabric * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))) > 127
trim = np.asarray(Image.fromarray(((orange | collar) & ~logo & fabric & top).astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))) > 127
mask = np.zeros((N, N, 4), np.uint8)
mask[..., 0] = np.where(fabric & top, 255, 0)
mask[..., 1] = np.where(trim, 255, 0)
mask[..., 2] = np.where(fabric & ~top, 255, 0)
mask[..., 3] = 255
Image.fromarray(mask).filter(ImageFilter.GaussianBlur(0.6)).save(os.path.join(OUT, 'kit_mask.png'))
manifest['kitMask'] = { 'diffuse': { 'file': 'textures/kit_mask.png', 'size': [1024, 1024], 'alpha': False, 'bytes': os.path.getsize(os.path.join(OUT, 'kit_mask.png')) } }
# where to print: the back panel and the chest (UV, 0..1, top-left origin)
manifest['kitLayout'] = { 'back': [0.035, 0.03, 0.335, 0.37], 'front': [0.405, 0.03, 0.665, 0.37] }

json.dump(manifest, open(os.path.join(OUT, '..', 'textures.json'), 'w'), indent=1)
total = sum(v['bytes'] for s in manifest.values() if isinstance(s, dict) for v in s.values() if isinstance(v, dict))

print('TOTAL', round(total / 1e6, 2), 'MB')
