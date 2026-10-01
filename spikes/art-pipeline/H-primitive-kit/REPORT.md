# Spike H — primitives-only vehicles (the "Chef Clash" method), round 3

**Question:** can a car and a prop be modelled, deformed and *shipped* from Three.js primitives alone — recognisable as a real car,
cheap enough for a 24-tile host screen, and held to the same contract and performance guarantees the Blender track has?

**Status: yes.** A golden Cruze-flavoured sedan that reads as a Cruze, breaks like a game car (doors, bonnet, boot, wheels, lamps,
glass), ships as four contract-valid GLB LODs (20.8 k / **4.7 k** / 2.1 k / 1.0 k triangles), and is guarded by an automated gate suite that
runs in ~35 s and proves itself against 26 injected defects. The wheelie bin is still the round-1 model (not yet through the contract or
optimisation pass).

Open `gallery.html` for everything, `index.html` to hit the car (click a part). Method: skill `.claude/skills/threejs-primitive-modelling/`.
Contract profile: `ASSET-CONTRACT-PROCEDURAL.md`. All gates: `node tools/check_asset.mjs --bake --selftest`.

---

## 1. How the reference does it (evidence-based)

`dontdie.wtf/cooked` ships **no model files or textures**: one 287 KB `game.js` (three r186) with cached primitives, spline lathes,
generic parametric surfaces, colour painted per vertex by position functions, one white-based `vertexColors` material per kind, a
builder that merges by material, fresnel rim light via `onBeforeCompile`, canvas-drawn decals. Function-by-function mapping:
`.claude/skills/threejs-primitive-modelling/references/cooked-evidence.md`. (The post says the code was LLM-written; not verified further.)

## 2. Round 3: recognition first

Feedback: push the roofline toward the Codex concept, take a few passes at making it *look better*, avoid funky windows, keep what
people recognise and tone the flourish down. So the rule became: **recognition cues are copied from the reference and only scaled;
cuteness comes from proportion, not from redesigning shapes.**

* **Measured, not eyeballed.** `recog/measure_side.py` extracts the real Cruze's centreline roof profile and daylight-opening polygons
  from the Codex side orthographic; metric-grid overlays (`recog/grid_front.png`, `grid_rear.png`) give the front/rear fascia features.
  `recog/spec.js` holds them (REAL) and their mapping to toy proportions (TOY: wheelbase 2.30 m, chunkier wheels, softer volumes).
* **Roofline:** the greenhouse loft's centreline top *is* the measured profile: long shallow windscreen, roof peak behind the wheelbase
  centre, long rear slope, lip spoiler on the short deck. The bubble is gone.
* **Windows:** glass is a Coons patch of the *measured polygon* (front door, rear door, quarter light: the six-light greenhouse), so the
  outlines are the reference shapes with softened corners. The wedge-shaped frames ("funky windows") are gone. Door skins are cut the
  same way (edge curves parallel to the roofline), so there are no pinches at the belt line.
* **Front:** slatted bar over a chrome-framed honeycomb grille (trapezoid, real ratios), swept parallelogram headlamps with a projector and
  an amber indicator inside the lens, wide shallow fog recesses, lower honeycomb intake, generic roundel badge (no real marque).
  **Rear:** two-piece wrap lamps with the lighter reverse section low, plate.
* **Golden:** champagne-gold metallic (`#e0a520`, metalness 0.55) with a red accent; identity colour is a tint on `jj_paint`.
* **Bays as geometry:** the dark opening you see when a door/bonnet/boot is gone is a real dark patch on the *same grid* as the panel, under
  it. The earlier vertex-painted version smeared dark wedges across coarse LODs (found in the LOD-ladder review).
* **Guarded:** `recog.roofline`, `recog.glass`, `recog.lamps`, `recog.grille`, `recog.proportions` (geometric, measured on the shipped GLB) and
  `silhouette.reference` (shape IoU against the real orthographics: side 0.76, top 0.81, front 0.83) fail if the cues drift.

## 3. Triangle optimisation (design trade-offs, tier by tier)

| LOD | role | before (round 2) | **now** | prims | GLB | kept / cut |
|---|---|---|---|---|---|---|
| 0 | hero | 54,948 | **20,774** | 80 | 881 KB | everything: lens rims, chrome rings, brake discs, coil springs, wheel nuts, badge |
| 1 | **gameplay baseline** | 13,150 | **4,652** | 58 | 288 KB | keeps: 5 flat spokes, chrome frames on grille + bar, projector disc, handles, mirrors, strut, panel liners. Cuts: nuts, brake discs, coils, lens rims, secondary rings, skirts, exhausts, mirror glass |
| 2 | medium | 5,666 | **2,094** | 48 | 183 KB | keeps: six-light greenhouse, grille + bar, lamps, wheel disc + tyre ring, arch beads. Cuts: liners, rings, spokes, handles, projector |
| 3 | distant | 2,436 | **1,022** | 47 | 140 KB | keeps: silhouette, lamps as dots, wheel discs. Cuts: arch beads, badge, all trim |

Where the triangles were going, and the fix (found with `breakdown.mjs`): (1) panels carried a full-resolution liner **plus** four edge skirts
(~2.3× the skin) → half-resolution liner, no skirts, panels only at LOD0/1 (~1.25×); (2) the body mesh was 12 k triangles at LOD0 → per-tier body
grids (44×34 down to 9×7); (3) tube and lathe tessellation (arch beads, tyres, springs, chrome rings) → per-tier tables; (4) a NaN cylinder-segment
bug from my own LOD table silently produced zero-triangle parts until the breakdown flagged it; (5) grille and slat canvas textures merged into **one
256×128 trim atlas**; (6) the race-number roundel left the asset (the game overlays it at `roof_number`). The rule for every cut: keep the recognition
features, drop what a camera at that distance cannot resolve.

**Dentability is a budget, not a byproduct.** Dents move real vertices, so a panel must be dense enough to dent. `dent.resolution` fails the build if
mean paint-edge length exceeds 0.16 / 0.30 / 0.50 / 0.80 m for LOD0–3. It caught the front bumper and bonnet being too coarse. This is why LOD1 does
not go much below ~4.5 k without losing visible damage.

**Vs the Blender track** (last read 2026-09-30 10:52, still being iterated): 6,534 / 2,714 / 1,102 triangles plus a 390-quad deformation cage.
Blender is still ~1.7× leaner at LOD1; the kit's advantages are parametric LODs, unbounded runtime dents and fast, diffable iteration.

## 4. Contract and performance tooling, rebuilt for code-defined assets

| Blender-track tool | JS equivalent here | Notes |
|---|---|---|
| `finish_asset.py` + `write_sidecar.py` | `kit/contract.js` + `tools/bake.mjs` | glTF space (−Z forward), `jj_*` extras, semantic materials, colliders, anchors, sidecar |
| `validator/validate_asset.py` | `tools/validate_asset.mjs` — **36 rules × 4 LODs = 144 checks** | same rule ids where they still apply, plus procedural rules |
| `make_broken_fixtures.py` + `test_validator.sh` | `tools/selftest.mjs` — **26 injected defects** | each must trip its intended rule; the untouched asset must pass |
| `E-mesh-lint-rig/check_asset.sh` (one CI entry) | `tools/check_asset.mjs` (`--bake --selftest --fast`) | ~35 s full, < 1 s `--fast` |
| `mesh_lint.py`, `rig_check.py` | `rig.hinge_direction`, `rig.wheels`, `rig.detach`, `dent.resolution`, `uv.policy`, `vertex_colours` | lint on the exported file |
| `G-cruze-v2/physics/*_v2.mjs` | `tools/physics/gates.mjs` (vendored Rapier setup) | 10 pass/fail gates; static stability, underbody gap and debris damping are asserted |
| `B-lod-batching` bench | `tools/render_gates.mjs` | LOD IoU, reference IoU, rig smoke on the loaded GLB, 24-car grid |
| perf *hypotheses* (1–3 k close mesh) | `tools/budgets.json` **hard budgets** | triangles / primitives / bytes / textures / per-part share / LOD ratio |

**Parity check.** The original Python validator, run on this asset, passes 77 checks and fails only the four rules the procedural profile replaces on
purpose: `uv.present`, `uv.overlap` (no UV atlas; vertex colours carry paint), `morphs.present` (runtime vertex dents), `materials.paint_mask`
(tint × vertex colour). Running it also caught three real structural mismatches in my first export (mesh must be on the part node itself;
`bumper_front_trim` / `boot_trim` slots; node names identical across LODs), now fixed and guarded in the Node port.

**What the gates found in my own work** (they earn their keep): tread radius wrong at LOD2/3 so wheels floated 4 cm; front bumper and bonnet too coarse to
dent; a missing `spoiler` in the mass table; primitives of one mesh share a vertex buffer, so several of my own rules (and the selftest's editor) read or wrote
the wrong vertices; a hinge check measuring from the hinge line; detached wheels never sleep without damping; a 62 kg wheel and 36 kg door (masses now
realistic: door ≈ 22 kg, wheel ≈ 29 kg).

### Results (this Mac, Apple GPU, system Chrome; relative numbers only)

| Gate group | Result |
|---|---|
| contract + perf validator | 144 / 144 |
| physics (LOD1, Rapier 0.19.3, 120 Hz) | 10 / 10: 1200 kg, CoM y 0.6, static stability factor 1.37, 4/4 wheels grounded, 30 km/h in 3 s, stops in 2.1 m, turn radius 6.1 m, **no rollover to 70 km/h** (the Blender v2 asset rolled at ~55), door and wheel detach, bit-identical trajectory |
| GLB render gates | 33 / 33: silhouette IoU vs LOD0 ≥ 0.987 / 0.974 / 0.954; rig (steer, spin, doors, bonnet, boot, suspension, lights, paint, dent + exact reset, detach, LOD select, intact fast path) |
| replay determinism | same hit list → bit-identical vertices; template untouched |
| selftest | 26 / 26 defects caught; control passes |
| 24 cars, 3840×2160, from the GLBs | LOD1: **627 draws** with the intact fast path (1,416 without), 131 k tris, ~10 ms/frame; LOD2 500 draws, 59 k tris; LOD3 499 draws, 29 k tris |

## 5. What a title needs from the asset (delivered)

`cruze.lod{0..3}.glb` + `cruze.asset.json` + `bake-report.json`; contract nodes/extras/materials; mass fractions summing to 1; 14 collider proxies
(chassis + cabin hulls, panel boxes, bumper hulls, wheel cylinders, no material); wheels with a steer node → spinning wheel mesh; suspension top mounts
with travel; anchors (`cam_fp`, `cam_tp_target`, `com`, `exhaust_0`, plates, `roof_number`); emissive lamp materials; a **runtime rig** (`kit/rig.js`: paint tint,
lights, steer, spin, suspension, panels, dents, detach package, intact fast path, `pickLod` with hysteresis at 260 / 110 / 46 px); explicit budgets; the gate suite.

Recorded for the sim: debris needs damping (wheels never sleep otherwise); flush panels need a collision grace period at detach (`col_door_L` overlaps
`col_chassis` by 0.27×0.56×0.94 m); dents should be stored as records and replayed for late joiners.

## 6. Risks and limits

* **Looks:** LOD2/3 are lumpy (fine at their distances); a small fold remains where the greenhouse meets the shoulder by each mirror; glass is opaque; no interior. The bin is round-1 quality.
* **Triangles:** ~1.7× the Blender LOD1; dentable panels need vertices.
* **Physics parity:** JS Rapier here; the 0.2 sim is native Rust. The vendored Rapier vehicle setup is a snapshot of the Blender track's (mid-iteration); re-vendor when it changes. Physics gates run against LOD1 colliders.
* **Untested:** phone hosts, real driving feel, a title integration (nothing here is wired into the game yet), Firefox/Safari, the Rust port.
* The hinge and spin sign conventions are tested on the exported file, but not yet against the game's own rig code.
* Nothing is committed.

## 7. Owner-direction check

No arbitrary gameplay caps (dents unbounded, debris persists, LOD only chooses detail); debris stays dynamic; no runtime CDN (three and rapier come from
`node_modules`); no real brand marks; nothing touches networking or controls. The budgets are asset budgets, not player caps.

## 8. Reproduce

```
cd <repo root> && python3 -m http.server 8123 --bind 127.0.0.1 &      # localhost only
cd spikes/art-pipeline/H-primitive-kit
node tools/check_asset.mjs --bake --selftest        # bake + every gate (≈35 s)      | --fast: validator + physics only (< 1 s)
node capture_all.mjs && node capture_smash.mjs && node capture_bin.mjs && node capture_extra.mjs && node capture_video.mjs && python3 compose.py
python3 ../G-cruze-v2/validator/validate_asset.py asset/cruze     # original validator: expect only uv.present / uv.overlap / morphs.present / materials.paint_mask
```

---

## Appendix A — Deformation (unchanged since round 1)

| Behaviour | How |
|---|---|
| **Dents** | `dentGeometry()` moves the real vertices inside a radius along (impact direction blended with surface normal), with a crumple ripple, scuffs the vertex colour, recomputes normals. Position, direction and severity are recorded per part. No morph targets to author and **no cap on the number of dents**. |
| **Shell behind a panel** | The same dent (a bit larger and deeper, unscuffed) is applied to the body shell so a deep dent never pokes through to the dark bay. |
| **Hinge → detach** | 3-state machine per part: `fixed → loose` (doors, bonnet, boot swing ajar on a damped spring; wheels wobble) `→ detached`. |
| **Detach** | Re-parented to the scene keeping world pose; Rapier dynamic body with a convex-hull collider from the part's own dented vertices (cylinder for wheels), CCD on, inherits momentum. Lids release junk; a missing wheel drops its corner. |
| **Lamps / glass** | HP-based; lamps go dark and shed shards; glass shatters to persistent particles. |
| **Bin** | Knock-over, lid pop, junk spill, permanent squish (`crushBody`, a vertex function). |
| **Ink outline** | Inverted hull sharing the mesh geometry, so it follows dents and detached parts. |

## Appendix B — Where the reference imagery came from

**No new image generation was run in this spike.** The Codex (`image_gen`) outputs all come from the first art-pipeline spike: the orthographic
front/side/rear/top of a stock 2012 Cruze in `../refs/` (prompts in `../refs/generation-prompts.txt`), the chunky "Codex concept" tile (kept as
`refs/codex_concept_cruze.png`), and the bin concept art in `art/style/refs/wheelie_bin*.png`. I read those plus two of the owner's real photos for
identity cues. A snapshot of the Blender track's hero is kept as `refs/blender_v2_hero.png` for the comparison sheet only.

## Appendix C — Round-2 fix (belt-line pinch)

The body was two lofts meshed separately, i.e. a hard concave crease at the belt line, with doors cut in three patches across it. Fix: a **smooth-min
union** of the lower shell and greenhouse implicit surfaces (`LoftUnion`), the chassis marched from an axis with rays bunched at the flanks, and every
panel, glass and decal cut from that one blended surface. See the skill's pitfalls table.

---

## Appendix D — Round 4: recognition experiments (opt-in, not yet promoted)

**Ask:** the build looked good but did not give "instant recognition" of the owner's Cruze.
**Method change:** stop matching only the Codex orthographics (image-generated; they mis-drew the tail lamps as angular wedges) and compare against the
owner's **real photos at matched camera angles** (`recog_capture.mjs` + `compose_recog.py`: real photo row on top, then one row per variant).
Photos: `../refs/photos/` and the reference zip in the repo root (the two film photos `1496626-R1-*.JPG` show the lightbar and UHF aerial).

**What the photos showed the toy was missing:** (1) round chrome-ringed bulls-eye tail lamps with a chrome boot strip; (2) one bold dark grille in a chunky
chrome frame under a solid chrome bar with a big roundel, and round fog lamps; (3) gloss-black pillars/window surrounds so the glass reads as one dark band;
(4) two bonnet creases; (5) the owner's accessories: a small LED lightbar on a black plate bracket and a tall UHF whip aerial.

**Implementation:** `build({ rc: [...] })` / `?rc=tail,grille,glass,hood,mirror,lightbar,uhf|all` in `cruze.js` (`RC` set). Everything is behind the flag:
**with no flag the four GLBs are byte-identical to before**, 144/144 validator and 10/10 physics still pass (`node tools/check_asset.mjs --bake --fast`).
`lightbar` / `antenna` are new accessory parts (mass counted only while flagged).

| flag | LOD1 tris | note |
|---|---|---|
| glass | +302 | biggest "it's a sedan" read, especially top-down/chase |
| tail | +624 | rear is what a chase camera sees; flat-disc tier at LOD1, off at LOD2/3 |
| grille | +176 | weight and contrast, not new shapes |
| uhf | +172 | ~24 tris at LOD3, still a silhouette cue at every tier |
| lightbar | +90 | LOD0/1 only |
| hood | +160 | subtle; weakest cue |
| mirror | -136 | cheaper than base |
| **all** | **+1,388** (6,040) | LOD0 27,818 · LOD2 2,334 · LOD3 1,242. **Over the current LOD1 budget (4,800)**: budgets.json / spec.js / contract need a decision before promotion |

**Not promoted yet, on purpose:** the gates (`recog.*`, budgets, part list, silhouette IoU) know only the default asset. Promoting a cue means updating
`recog/spec.js`, `tools/budgets.json`, the contract's part list (accessories), then a full `--bake --selftest`.
**Tried and dropped:** a fender-to-tail character line (the oversized arches leave no room between wheel and belt line).
**Known, pre-existing (untouched, for the LOD pass):** X-shaped grille frame and a grey door wedge at LOD1; jagged notches on the rear-door glass bottom edge (body-shell wobble at the belt line).
**Untested:** whip flex/sway, dents on the accessories, physics with the whip (no collider), the frames under damage (door detach carries its frame; not exercised).

## Appendix E — Round 5: rear body as one convex shape, floating glass (opt-in `rc=shape`)

**Feedback (rear-quarter screenshot):** the windows/greenhouse still "pinch in" at the rear where they should be one smooth convex shape, and the windows seem to float.
**Diagnosis (parts rendered in isolation, `isolate.mjs`):** (1) the rear greenhouse is a boxy slab (half-width 0.685→0.52) sitting on a 0.94 m-wide haunch, so the outline goes convex → concave → convex and the smooth-min leaves a wrinkled diagonal across the C-pillar;
(2) the door glass is 7×5 samples (quarter light 5×3) and the door skin 8×11 at LOD0, so both chord straight across the curling roof edge and the liner/bay shows as grey shards.
**Fix (all behind `rc=shape`, tunables `?sh=a:1;k:0.8;w:0.84;yb:0.72;tb:0.2;pt:4;bunch:1.3;rows:1.35;gres:2`):** rear greenhouse stations blend (mid-cabin → C-pillar) to a section that starts at the belt at the tub's width with 0.2 tumblehome and rounder exponent, union blend 0.8; door glass/frames ×2 grid density; door rows bunched toward the roof edge (+35% rows), LOD0/1 only.
**Result:** dead-rear outline is one bell-shaped convex form; glass sits in the surface with no shards; the diagonal wrinkle is much softer (a soft highlight remains where haunch meets quarter).
**Cost (tris):** LOD0 +1,752 · LOD1 +364 · LOD2 +30 · LOD3 0. **Default bake unchanged:** the four GLBs are byte-identical, 144/144 validator, 10/10 physics.
**Not done / untested:** the quarter light is still the measured narrow teardrop (reshape it as a plain convex triangle if it still reads pinched); colliders and the physics gates were not run against the shaped body; door-detach with the denser glass; the shaped body against `recog.*` and silhouette IoU (they check the default asset). Sheet: `out/recog_r5_before_after.png`; tools `recog_shape.mjs`, `isolate.mjs`.
