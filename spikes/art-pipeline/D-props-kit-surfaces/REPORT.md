# Spike D — destructible props, track kit & surface textures (2026-09-29)

(Written by the Sonnet subagent; saved by the coordinator because subagents here can't write report files.)

**Verdict: GO.** All 6 tasks pass headlessly. The in-game proof caught two real contract bugs (below).

| # | Task | Result | Evidence (`out/`) |
|---|---|---|---|
| 1 | Wheelie bin destructible (green body, red hinged lid, wheels, collider, CoM; fractured pieces; rubbish: can, pizza box, banana peel, nappy) | PASS | `render_bin_intact.png`, `render_bin_fractured.png`, `render_bin_debris.png`, `wheelie_bin.asset.json` |
| 2 | Track kit piece (90° Red Centre dirt bend, fictional rock barrier, orthonormal snap points, separate colliders, per-face surface IDs, baked vertex AO) | PASS | `render_track_piece.png`, `track_piece_bend90.asset.json` |
| 3 | Surface set (packed red dirt, soft sand, tarmac via Codex imagegen; seamless 3×3) | PASS | `tile3x3_*.png`, `*.surface.json` |
| 4 | Draft schemas + stdlib validator; FAIL on 3 broken fixtures, PASS on real assets | PASS | `contracts/*.schema.json`, `validate_asset.py`, `out/BROKEN_*.json` |
| 5 | Sidecar-only Three.js proof: 4 kit pieces snap-chain into a closed 360° ring; bin intact / lid open / broken | PASS | `ingame_track.png`, `ingame_bin.png` |

Fracture: no Cell Fracture addon headless → iterative random-plane bisection (bmesh.bisect_plane); piece
volume sum / intact = 1.0000000029. Blockier than Voronoi; visual-quality follow-up recommended.

## Findings → contract changes
1. No headless Cell Fracture: vendor a headless fracture method or document bisection as baseline.
2. `export_vertex_color` defaults to "MATERIAL", silently dropping baked AO → always export "ACTIVE"; validator
   flags AO-in-Blender-but-no-COLOR_0-in-GLB.
3. Colliders round-trip as visible boxes (glTF has no hide_render) → consumers filter by `col_`/`jj_collider`;
   validator rule: no `col_*` node carries a material.
4. **Coordinate spaces (highest value):** raw Blender Z-up vectors copied into sidecars (snap forward/up, lid
   hinge axis/point) are wrong in glTF/Three.js Y-up → caused the vanishing-lid bug. Forbid raw vectors for
   anything that exists as a GLB node; read transforms from the loaded scene graph (as snap-chaining does).
   Where unavoidable, sidecars declare their vector space and the validator checks it.
5. Imagegen doesn't reliably hit power-of-two (1254² returned for 1024²) → always normalise on ingest.
6. Blender preview can look wrong on a correct asset (vertex-colour AO rewires Base Color) — document it.
7. Only 3 of 8 §11 surfaces textured → validator cross-check: every `jj_surface_*` used by a kit piece resolves
   to a surface_set or an explicit "untextured" allowlist.
8. Required `cultural_review.note` on kit pieces worked well as a cheap gate — keep it.

Timings: Blender builds ~3 s; renders ~2 s; 3 parallel imagegen ~130 s; validator <1 s; Playwright ~8 s.

Files: `build_wheelie_bin.py`, `build_track_kit_piece.py`, `render_contact_sheets.py`, `process_textures.py`,
`contracts/*.schema.json`, `validate_asset.py`, `ingame.html`, `capture.mjs`, `out/`.
