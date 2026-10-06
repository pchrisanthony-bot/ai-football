# =====================================================================
# Builds the players' base character from MakeHuman (CC0) with MPFB 2 in Blender:
#   blender --background --python tools/characters/build_players.py -- <out.glb>
# then:  python tools/characters/textures.py   (web-sized textures next to the GLB)
#
# One athletic male base mesh on MPFB's 53-bone game-engine rig (with fingers), with
# high-poly eyes, eyebrows, eyelashes (no teeth: the mouth never opens), four hairstyles, a football kit cut from
# MakeHuman clothes (the tee; the jeans cut to shorts) and trainers for boots.
# Body types are morph targets on every mesh (body, kit, hair…): lean, strong, stocky.
# Exported as one skinned GLB — geometry, UVs, skin weights, morphs and material slot
# names (skin, socks, shirt, shorts, boots, eyes, brows, lashes, hair_*). The game
# builds the materials (skin, cornea, cloth, kit colours) from the source textures.
#
# Assets: MakeHuman system assets (CC0) — https://static.makehumancommunity.org/assets/assetpacks.html
# Tool:   MPFB 2 (GPL-3, a Blender extension; none of its code ships with the game).
# =====================================================================
import bpy, bmesh, os, sys, json
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'public/assets/players/player_base.glb')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService
from bl_ext.blender_org.mpfb.services.locationservice import LocationService
from bl_ext.blender_org.mpfb.entities.objectproperties import HumanObjectProperties

DATA = LocationService.get_user_data()
A = lambda *p: os.path.join(DATA, *p)

SHORTS_HEM = 0.60       # m: the jeans become shorts just above the knee
SOCK_TOP = 0.46         # m: socks up to just below the knee
HAIR = ['short02', 'short04', 'afro01', 'short01']

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------- the athlete
BASE = { 'gender': 1.0, 'age': 0.5, 'muscle': 0.72, 'weight': 0.42, 'proportions': 0.85, 'height': 0.55 }
BUILDS = {   # body types, as differences from the base (subtle — a footballer, not a bodybuilder)
    'lean':   { 'muscle': 0.62, 'weight': 0.30 },
    'strong': { 'muscle': 0.92, 'weight': 0.52 },
    'stocky': { 'muscle': 0.80, 'weight': 0.62, 'proportions': 0.6 },
}
macro = TargetService.get_default_macro_info_dict()
macro.update(BASE)
macro['race'] = { 'african': 0.34, 'asian': 0.33, 'caucasian': 0.33 }
human = HumanService.create_human(macro_detail_dict=macro, feet_on_ground=True, scale=0.1)
human.name = 'body'
rig = HumanService.add_builtin_rig(human, 'game_engine')
rig.name = 'rig'

def add(path, kind, name):
    o = HumanService.add_mhclo_asset(path, human, asset_type=kind, subdiv_levels=0, material_type='NONE')
    o.name = name
    return o

objs = {
    'eyes': add(A('eyes', 'high-poly', 'high-poly.mhclo'), 'eyes', 'eyes'),
    'eyebrows': add(A('eyebrows', 'eyebrow001', 'eyebrow001.mhclo'), 'eyebrows', 'eyebrows'),
    'eyelashes': add(A('eyelashes', 'eyelashes01', 'eyelashes01.mhclo'), 'eyelashes', 'eyelashes'),
    'kit': add(A('clothes', 'male_casualsuit04', 'male_casualsuit04.mhclo'), 'clothes', 'kit'),
    'boots': add(A('clothes', 'shoes06', 'shoes06.mhclo'), 'clothes', 'boots'),
}
for h in HAIR:
    objs['hair_' + h] = add(A('hair', h, h + '.mhclo'), 'hair', 'hair_' + h)
meshes = { 'body': human, **objs }

# ---------------------------------------------------------------- shape capture
def coords(o):
    """Vertex positions of o with its shape keys mixed in, before any modifier."""
    mods = [(m, m.show_viewport) for m in o.modifiers]
    for m, _ in mods: m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    for m, v in mods: m.show_viewport = v
    return co.reshape(-1, 3)

def set_build(values):
    for k, v in { **BASE, **values }.items():
        HumanObjectProperties.set_value(k, v, entity_reference=human)
    TargetService.reapply_macro_details(human)
    HumanService.refit(human)
    bpy.context.view_layer.update()

captured = {}
for name, values in BUILDS.items():
    set_build(values)
    captured[name] = { k: coords(o) for k, o in meshes.items() }
set_build({})
base = { k: coords(o) for k, o in meshes.items() }

# Bake the base build into the body, then add the body types as morph targets on every mesh
# (so the kit, hair, boots follow the body).
TargetService.bake_targets(human)
for k, o in meshes.items():
    if o.data.shape_keys is None: o.shape_key_add(name='Basis', from_mix=False)
    for name in BUILDS:
        d = captured[name][k] - base[k]
        if np.abs(d).max() < 1e-5: continue
        sk = o.shape_key_add(name=name, from_mix=False)
        sk.data.foreach_set('co', (base[k] + d).ravel())

# ---------------------------------------------------------------- materials (slot names)
def mat(name):
    return bpy.data.materials.get(name) or bpy.data.materials.new(name)
for o in meshes.values(): o.data.materials.clear()

def assign(o, pick):
    """pick(face, bm) → material name; slots created in first-use order."""
    names = []
    bm = bmesh.new(); bm.from_mesh(o.data)
    for f in bm.faces:
        n = pick(f, bm)
        if n not in names: names.append(n)
        f.material_index = names.index(n)
    bm.to_mesh(o.data); bm.free()
    for n in names: o.data.materials.append(mat(n))

# ---------------------------------------------------------------- the kit: tee + shorts
kit = objs['kit']
bm = bmesh.new(); bm.from_mesh(kit.data); bm.verts.ensure_lookup_table()
# islands: the tee is the one reaching highest
seen, islands = set(), []
for v in bm.verts:
    if v.index in seen: continue
    stack, isl = [v], []
    seen.add(v.index)
    while stack:
        x = stack.pop(); isl.append(x.index)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y.index not in seen: seen.add(y.index); stack.append(y)
    islands.append(isl)
tee = set(max(islands, key=lambda isl: max(bm.verts[i].co.z for i in isl)))
# the jeans' legs are cut straight across at the hem (a plane cut, not a ragged face-by-face
# one; the new verts interpolate the UVs, weights and body-type shapes)
jeans = [v for v in bm.verts if v.index not in tee]
jf = list({ f for v in jeans for f in v.link_faces })
je = list({ e for v in jeans for e in v.link_edges })
bmesh.ops.bisect_plane(bm, geom=jeans + je + jf, plane_co=(0, 0, SHORTS_HEM), plane_no=(0, 0, 1), clear_inner=True)
bm.verts.ensure_lookup_table()
bm.to_mesh(kit.data); bm.free()
kit_tee_z = min(v.co.z for v in kit.data.vertices if v.co.z > 0.85) if kit.data.vertices else 0.9
bmk = bmesh.new(); bmk.from_mesh(kit.data); bmk.verts.ensure_lookup_table()
# re-find the tee island after the delete (indices changed)
seen, islands = set(), []
for v in bmk.verts:
    if v.index in seen: continue
    stack, isl = [v], []
    seen.add(v.index)
    while stack:
        x = stack.pop(); isl.append(x.index)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y.index not in seen: seen.add(y.index); stack.append(y)
    islands.append(isl)
tee = set(max(islands, key=lambda isl: max(bmk.verts[i].co.z for i in isl)))
bmk.free()
assign(kit, lambda f, bm: 'shirt' if f.verts[0].index in tee else 'shorts')

# ---------------------------------------------------------------- the body: masks, socks
# Apply the clothes' masks by deleting the hidden skin — except the legs below the shorts'
# hem (the jeans used to hide them) — and the helper geometry.
body = human
vg = { g.name: g.index for g in body.vertex_groups }
def in_group(v, name):
    gi = vg.get(name)
    return gi is not None and any(g.group == gi and g.weight > 0.5 for g in v.groups)
hide = []
for v in body.data.vertices:
    if not in_group(v, 'body'): hide.append(v.index); continue                 # helpers
    if in_group(v, 'Delete.shoes06'): hide.append(v.index); continue
    if in_group(v, 'Delete.male_casualsuit04') and v.co.z > SHORTS_HEM + 0.04: hide.append(v.index)
bm = bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in hide], context='VERTS')
# a clean line where the socks start
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, SOCK_TOP), plane_no=(0, 0, 1))
bm.to_mesh(body.data); bm.free()
for m in list(body.modifiers):
    if m.type == 'MASK': body.modifiers.remove(m)
assign(body, lambda f, bm: 'socks' if f.calc_center_median().z < SOCK_TOP else 'skin')

for k in ['boots', 'eyes', 'eyebrows', 'eyelashes'] + ['hair_' + h for h in HAIR]:
    assign(objs[k], lambda f, bm, k=k: {'eyebrows': 'brows', 'eyelashes': 'lashes'}.get(k, k))

# ---------------------------------------------------------------- export
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for o in meshes.values(): o.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True,
    export_skins=True, export_morph=True, export_morph_normal=True, export_animations=False,
    export_apply=False, export_materials='EXPORT', export_image_format='NONE', export_yup=True, export_texcoords=True, export_normals=True,
)
info = {
    'source': 'MakeHuman system assets (CC0) via MPFB 2',
    'height': float(max(v.co.z for v in body.data.vertices)),
    'builds': list(BUILDS), 'hair': HAIR, 'shortsHem': SHORTS_HEM, 'sockTop': SOCK_TOP,
    'counts': { k: len(o.data.vertices) for k, o in meshes.items() },
}
json.dump(info, open(OUT.replace('.glb', '.json'), 'w'), indent=1)
print('EXPORTED', OUT, os.path.getsize(OUT), json.dumps(info))
