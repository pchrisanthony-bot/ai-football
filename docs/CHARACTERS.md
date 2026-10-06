# Characters — the players' bodies

The players used to be code-built "dolls" (capsules and boxes). They are now realistic
human bodies built from MakeHuman's CC0 assets, driven by the game's own procedural
animation system.

## Asset research and licence check

| Candidate | What it is | Licence | Verdict |
|---|---|---|---|
| **MakeHuman system assets** (base mesh, skins, eyes, brows, lashes, hair, clothes, shoes, proxies) | Parametric realistic humans | **CC0** (re-released Sept 2020; stated in every asset file) | **Chosen.** Free to ship in a public repo and a public web game, modify and recolour. |
| MPFB 2 (MakeHuman plugin for Blender) | The tool that builds the human, fits the clothes, adds the rig | GPL-3 | Used **offline only** (tools/characters). None of its code ships with the game; what it outputs from CC0 assets is CC0. |
| Mixamo characters and animations | Rigged characters, mocap | Adobe terms: free to use in games, **not to redistribute the raw files** | Rejected. The repo is public, so committing the FBX/GLB would redistribute them. |
| Ready Player Me | Stylised avatars | Proprietary; the service closed to new developers | Rejected. Stylised rather than realistic, and the licence fits poorly. |
| Quaternius / Kenney characters | Low-poly CC0 characters | CC0 | Rejected for the body. Too stylised for the "real footballer" brief. |
| Sketchfab "footballer" models | Assorted | Mixed (CC-BY, CC-BY-NC, editorial); often real kits and brands | Rejected. Mixed licences, trademarked kits and likenesses. |
| Unreal MetaHumans | Photoreal humans | Unreal-engine-only EULA | Rejected. Not allowed outside Unreal. |

Brand check: the CC0 trainer texture (shoes06) carried a sportswear logo. The build makes
it greyscale and the game recolours it, so there is no brand identity left. The kit is
the CC0 tee and jeans from male_casualsuit04: the jeans are cut to shorts, the print is
masked out, and each team's colours, name and number are painted on.

## Pipeline

1. `blender --background --python tools/characters/build_players.py -- public/assets/players/player_base.glb`
   - One athletic male base: gender 1, age 0.5, muscle 0.72, weight 0.42, proportions 0.85,
     with an even ethnic mix so the four skin textures all sit naturally.
   - MPFB's 53-bone *game_engine* rig, including fingers.
   - Assets: high-poly eyes, eyebrows, eyelashes, four hairstyles (short02, short04,
     afro01, short01), the kit (tee, plus jeans cut at 0.60 m into shorts) and trainers
     as boots.
   - Body types are **morph targets on every mesh**, so the kit and hair follow the body:
     lean, strong, stocky.
   - The skin hidden under the clothes is deleted; below the knee it becomes the socks slot.
   - Exports one skinned GLB (about 3 MB) with geometry, UVs, weights, morphs and
     material slot names only.
2. `python tools/characters/textures.py`
   - Web-sized WebP textures from each asset's .mhmat (2.7 MB total).
   - The kit mask: R = shirt, G = trim, B = shorts, plus where the back and front numbers go.
3. In the game, `src/render/humanmodel.js`:
   - Loads the model once and clones it per player.
   - Builds the materials: physical skin with sheen and micro-normal, a clearcoat
     cornea, alpha-tested hair, kit cloth with the source normal and AO maps and a rim
     light.
   - Paints each player's own kit texture (team colours, trim, name and number on the
     back, small number on the chest).
   - Gives each player his own look: skin tone and tint, eye colour, hair, boot colour,
     body type by archetype, and height (keepers 1.86 m, tricksters 1.72 m, ±3 cm).

## Animation retargeting

The procedural animation (gait, foot IK, kicks, tackles, dives, celebrations) still runs
on the game's invisible "driver" skeleton in athlete.js. Every frame, each human bone is
set from it:

    human world rotation = driver world rotation · C

C is a constant calibrated at load. It matches the two rest poses: the human's A-pose
arms and its legs are brought down to the driver's straight-down limbs.

- The driver is scaled so its thigh and shin lengths equal the model's, so a foot the IK
  plants stays planted on the mesh.
- The pelvis follows the driver's hip-joint centre.
- The spine is spread over spine_01–03, and the neck takes half the head's turn.
- Fingers rest in a loose fist, and the toes bend as the heel lifts.

## Budget

Per player: about 17.7k body triangles plus about 7k for the kit, boots, eyes and hair,
in 9 draw calls. Eyes, brows and lashes cast no shadow, and the hidden hairstyles are not
drawn.

The teeth were dropped (7k triangles behind a mouth that never opens). The low-poly eyes
(86 faces) were rejected as too blocky for close-ups.
