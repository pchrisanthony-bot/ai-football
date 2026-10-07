# =====================================================================
# Builds Sitara Gully's spectators from MakeHuman (CC0) with MPFB 2 in Blender:
#   blender --background --python tools/characters/build_crowd.py -- public/assets/crowd/crowd.glb
#
# A dozen everyday people (men, women, an older man and woman, kids), each on MakeHuman's
# low-poly proxy body with MakeHuman clothes, hair and low-poly eyes, on MPFB's game-engine
# rig: the players' rig, so the game poses them with the same bone names.
# No textures ship. Each part's texture is baked into vertex colours, blurred to the
# mesh's resolution, and the parts are decimated, so a person is about 2-3k triangles.
# Material slots name the regions the game recolours: skin, top, bottom, shoes, hair, eyes.
#
# Assets: MakeHuman system assets (CC0) — https://static.makehumancommunity.org/assets/assetpacks.html
# Tool:   MPFB 2 (GPL-3, a Blender extension; none of its code ships with the game).
# =====================================================================
import bpy, bmesh, os, sys, json
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'public/assets/crowd/crowd.glb')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService
from bl_ext.blender_org.mpfb.services.locationservice import LocationService

DATA = LocationService.get_user_data()
A = lambda *p: os.path.join(DATA, *p)

# Faces: MakeHuman's three ancestry sliders are coarse; this mix reads closest to a South
# Asian face. Skin tones are the game's (the bake keeps only the texture's detail).
RACE = { 'african': 0.2, 'asian': 0.25, 'caucasian': 0.55 }
# MakeHuman ages: 0 = 1 yr, 0.1875 = 11, 0.5 = 25, 1 = 90.
PEOPLE = [
    dict(id='man_tee',     sex='m', macro=dict(gender=1, age=0.55, muscle=0.5,  weight=0.5,  height=0.45), clothes='male_casualsuit06', hair='short02'),
    dict(id='man_shirt',   sex='m', macro=dict(gender=1, age=0.66, muscle=0.45, weight=0.68, height=0.4),  clothes='male_casualsuit03', hair='short04'),
    dict(id='man_slim',    sex='m', macro=dict(gender=1, age=0.44, muscle=0.55, weight=0.35, height=0.55), clothes='male_casualsuit02', hair='short01', shoes='shoes02'),
    dict(id='old_man',     sex='m', macro=dict(gender=1, age=0.86, muscle=0.3,  weight=0.42, height=0.35), clothes='male_casualsuit03', hair=None),
    dict(id='worker',      sex='m', macro=dict(gender=1, age=0.6,  muscle=0.7,  weight=0.55, height=0.5),  clothes='male_worksuit01',   hair='short03'),
    dict(id='woman_kurta', sex='f', macro=dict(gender=0, age=0.6,  muscle=0.4,  weight=0.56, height=0.38), clothes='female_elegantsuit01', hair='braid01'),
    dict(id='woman_young', sex='f', macro=dict(gender=0, age=0.45, muscle=0.45, weight=0.42, height=0.45), clothes='female_casualsuit01',  hair='ponytail01', shoes='shoes05'),
    dict(id='woman_older', sex='f', macro=dict(gender=0, age=0.8,  muscle=0.35, weight=0.68, height=0.3),  clothes='female_elegantsuit01', hair='bob02'),
    dict(id='boy',         sex='m', macro=dict(gender=1, age=0.19, muscle=0.5,  weight=0.45, height=0.5),  clothes='male_casualsuit06', hair='short02', shoes='shoes02', shorts=True),
    dict(id='girl',        sex='f', macro=dict(gender=0, age=0.17, muscle=0.45, weight=0.45, height=0.5),  clothes='female_elegantsuit01', hair='ponytail01'),
    dict(id='teen',        sex='m', macro=dict(gender=1, age=0.28, muscle=0.5,  weight=0.4,  height=0.55), clothes='male_casualsuit06', hair='short01', shoes='shoes05'),
    dict(id='man_long',    sex='m', macro=dict(gender=1, age=0.5,  muscle=0.6,  weight=0.52, height=0.6),  clothes='male_casualsuit02', hair='short03'),
]
# How much of each part's mesh to keep (the proxy body is low-poly already).
KEEP = { 'body': 0.55, 'clothes': 0.1, 'hair': 0.15, 'shoes': 0.08, 'eyes': 1.0 }
SKIN = { 'm': A('skins', 'young_asian_male', 'young_lightskinned_male_diffuse3.png'),
         'f': A('skins', 'young_asian_female', 'young_lightskinned_female_diffuse3.png') }

bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)

def add(path, human, kind):
    return HumanService.add_mhclo_asset(path, human, asset_type=kind, subdiv_levels=0, material_type='NONE')

# ---------------------------------------------------------------- texture → vertex colours
_px = {}
def texels(path, n):
    """The texture block-averaged to n×n (premultiplied by alpha, so transparent texels
    don't darken hair), linear RGB, plus its coverage."""
    key = (path, n)
    if key in _px: return _px[key]
    img = bpy.data.images.load(path, check_existing=True)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)
    rgb = a[..., :3]
    rgb = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    al = a[..., 3:4]
    bh, bw = h // n, w // n
    pm = np.concatenate([rgb * al, al], axis=-1)[:bh * n, :bw * n].reshape(n, bh, n, bw, 4).mean(axis=(1, 3))
    cov = pm[..., 3]
    col = pm[..., :3] / np.maximum(cov[..., None], 1e-4)
    mean = (pm[..., :3].sum(axis=(0, 1)) / max(cov.sum(), 1e-4))
    col[cov < 0.02] = mean
    _px[key] = (col, cov)
    return _px[key]

def bake(o, path, n=64):
    col, cov = texels(path, n)
    me = o.data
    nl = len(me.loops)
    uvs = np.empty(nl * 2, dtype=np.float32); me.uv_layers.active.data.foreach_get('uv', uvs); uvs = uvs.reshape(-1, 2)
    vi = np.empty(nl, dtype=np.int32); me.loops.foreach_get('vertex_index', vi)
    x = np.clip((uvs[:, 0] % 1.0) * n, 0, n - 1).astype(int)
    y = np.clip((uvs[:, 1] % 1.0) * n, 0, n - 1).astype(int)
    w = cov[y, x] + 1e-3
    acc = np.zeros((len(me.vertices), 3)); cnt = np.zeros(len(me.vertices))
    np.add.at(acc, vi, col[y, x] * w[:, None]); np.add.at(cnt, vi, w)
    vc = acc / np.maximum(cnt, 1e-6)[:, None]
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.concatenate([vc, np.ones((len(vc), 1))], axis=1).astype(np.float32).ravel())
    me.color_attributes.active_color = attr

# ---------------------------------------------------------------- mesh helpers
def islands(bm):
    seen, out = set(), []
    for v in bm.verts:
        if v.index in seen: continue
        stack, isl = [v], []
        seen.add(v.index)
        while stack:
            x = stack.pop(); isl.append(x.index)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen: seen.add(y.index); stack.append(y)
        out.append(isl)
    return out

def assign(o, pick):
    """pick(face) → slot name; one material per region name, shared by everyone.
    (The slots go in first: in Blender 5, clearing a mesh's materials zeroes its faces'
    material indices.)"""
    bm = bmesh.new(); bm.from_mesh(o.data)
    picks = [pick(f) for f in bm.faces]
    names = list(dict.fromkeys(picks))
    o.data.materials.clear()
    for n in names: o.data.materials.append(material(n))
    for f, n in zip(bm.faces, picks): f.material_index = names.index(n)
    bm.to_mesh(o.data); bm.free()

def decimate(o, ratio):
    if ratio >= 1: return
    m = o.modifiers.new('Dec', 'DECIMATE')
    m.ratio = ratio
    m.use_symmetry = True; m.symmetry_axis = 'X'
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o], selected_editable_objects=[o]):
        bpy.ops.object.modifier_move_to_index(modifier='Dec', index=0)
        bpy.ops.object.modifier_apply(modifier='Dec')

def drop_modifiers(o, kinds=('MASK',)):
    for m in list(o.modifiers):
        if m.type in kinds: o.modifiers.remove(m)

def bone_z(rig, name):
    b = rig.data.bones[name]
    return (rig.matrix_world @ b.head_local).z

# ---------------------------------------------------------------- one person
def person(spec):
    macro = TargetService.get_default_macro_info_dict()
    macro.update(spec['macro'])
    macro['race'] = dict(RACE)
    human = HumanService.create_human(macro_detail_dict=macro, feet_on_ground=True, scale=0.1)
    rig = HumanService.add_builtin_rig(human, 'game_engine')
    proxy_name = 'male1591' if spec['sex'] == 'm' else 'female1605'
    body = add(A('proxymeshes', proxy_name, proxy_name + '.proxy'), human, 'Proxymeshes')
    eyes = add(A('eyes', 'low-poly', 'low-poly.mhclo'), human, 'Eyes')
    clothes = add(A('clothes', spec['clothes'], spec['clothes'] + '.mhclo'), human, 'Clothes')
    hair = add(A('hair', spec['hair'], spec['hair'] + '.mhclo'), human, 'Hair') if spec.get('hair') else None
    shoes = add(A('clothes', spec['shoes'], spec['shoes'] + '.mhclo'), human, 'Clothes') if spec.get('shoes') else None
    bpy.context.view_layer.update()

    knee = bone_z(rig, 'calf_l')
    ankle = bone_z(rig, 'foot_l')
    height = max((body.matrix_world @ v.co).z for v in body.data.vertices)
    hem = knee + 0.06 if spec.get('shorts') else None

    # the clothes: top / bottom (the island reaching lowest is the bottom; small islands
    # — buttons, a belt — join the big island nearest them), the bottom cut to shorts
    clothes.data.materials.clear()
    clothes.data.materials.append(material('top')); clothes.data.materials.append(material('bottom'))
    bm = bmesh.new(); bm.from_mesh(clothes.data); bm.verts.ensure_lookup_table()
    isl = islands(bm)
    big = [i for i in isl if len(i) >= 300] or isl
    low = lambda i: min(bm.verts[j].co.z for j in i)
    bottom_isl = min(big, key=low) if len(big) > 1 else None
    centre = lambda i: sum((bm.verts[j].co for j in i), bm.verts[i[0]].co * 0) / len(i)
    region = {}
    for i in isl:
        if i in big: r = 'bottom' if i is bottom_isl else 'top'
        else:
            c = centre(i)
            near = min(big, key=lambda b: (centre(b) - c).length)
            r = 'bottom' if near is bottom_isl else 'top'
        for j in i: region[j] = r
    for f in bm.faces: f.material_index = 1 if region.get(f.verts[0].index) == 'bottom' else 0
    # (split faces keep their material through the cut)
    if hem is not None and bottom_isl is not None:
        bot = [bm.verts[j] for j in bottom_isl]
        geom = bot + list({e for v in bot for e in v.link_edges}) + list({f for v in bot for f in v.link_faces})
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, hem), plane_no=(0, 0, 1), clear_inner=True)
    bm.to_mesh(clothes.data); bm.free()

    # the body: delete what the clothes and shoes hide (the legs below a shorts hem stay)
    groups = { g.index: g.name for g in body.vertex_groups }
    hide = []
    for v in body.data.vertices:
        for g in v.groups:
            n = groups.get(g.group, '')
            if n.startswith('Delete.') and g.weight > 0.5:
                if hem is not None and n == 'Delete.' + spec['clothes'] and v.co.z < hem - 0.04: continue
                hide.append(v.index); break
    bm = bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in hide], context='VERTS')
    bm.to_mesh(body.data); bm.free()
    drop_modifiers(body)
    # bare feet are sandals (chappals): the game colours the 'shoes' region
    assign(body, lambda f: 'shoes' if (not shoes and f.calc_center_median().z < ankle * 0.85) else 'skin')

    # vertex colours from each part's texture, then decimate
    bake(body, SKIN[spec['sex']], 64)
    bake(eyes, A('eyes', 'materials', 'brown_eye.png'), 32)
    bake(clothes, A('clothes', spec['clothes'], spec['clothes'] + '_diffuse.png'), 64)
    if hair: bake(hair, A('hair', spec['hair'], spec['hair'] + '_diffuse.png'), 32)
    if shoes: bake(shoes, A('clothes', spec['shoes'], spec['shoes'] + '_diffuse.png'), 32)
    assign(eyes, lambda f: 'eyes')
    if hair: assign(hair, lambda f: 'hair')
    if shoes: assign(shoes, lambda f: 'shoes')
    for o, k in [(body, 'body'), (clothes, 'clothes'), (hair, 'hair'), (shoes, 'shoes')]:
        if o: drop_modifiers(o); decimate(o, KEEP[k])

    # one mesh per person; the basemesh goes
    parts = [o for o in (body, eyes, clothes, hair, shoes) if o]
    for o in parts:
        for u in list(o.data.uv_layers): o.data.uv_layers.remove(u)
    with bpy.context.temp_override(object=body, active_object=body, selected_objects=parts, selected_editable_objects=parts):
        bpy.ops.object.join()
    body.data.shade_smooth()
    body.data.color_attributes.active_color = body.data.color_attributes['Col']
    bpy.data.objects.remove(human, do_unlink=True)
    body.name = spec['id']; body.data.name = spec['id']
    rig.name = spec['id'] + '_rig'
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print(f"CROWD {spec['id']}: {len(body.data.vertices)} verts, {tris} tris, height {height:.2f} m, slots {[m.name for m in body.data.materials]}")
    return rig, body, dict(id=spec['id'], sex=spec['sex'], age=spec['macro']['age'], height=round(height, 3), verts=len(body.data.vertices), tris=tris)

out, meta = [], []
for i, spec in enumerate(PEOPLE):
    rig, body, info = person(spec)
    out += [rig, body]
    meta.append(info)

# ---------------------------------------------------------------- export
bpy.ops.object.select_all(action='DESELECT')
for o in out: o.select_set(True)
bpy.context.view_layer.objects.active = out[0]
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True,
    export_skins=True, export_morph=False, export_animations=False, export_apply=False,
    export_materials='EXPORT', export_image_format='NONE', export_yup=True,
    export_texcoords=False, export_normals=True, export_vertex_color='ACTIVE',
)
with open(os.path.splitext(OUT)[0] + '.json', 'w') as f:
    json.dump({ 'people': meta, 'source': 'MakeHuman system assets (CC0) via MPFB 2; tools/characters/build_crowd.py' }, f, indent=1)
print('CROWD wrote', OUT, sum(m['tris'] for m in meta), 'tris in all')
