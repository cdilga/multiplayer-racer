# Tradie Ute reference rebuild — 2026-10-25

Vehicle Model Validation: PASS for the reference/body rebuild. Full room/host integration and profile hash refresh belong to parent bead `br-rgw6`; this receipt does not claim a new driving, device or GPU benchmark.

Vehicle/parts: `tradie-ute`; existing eleven car part IDs plus existing interiors. Candidate is the working tree over `d44c9093`, identified by `measured-check.json` source hashes and `bake-check.log` baked hashes. Helper edits were confined to this vehicle and this evidence directory. No Asyar work.

Requirement sources: R81/R86/R90/R123, the existing `jj.vehicle.v1` contract and vehicle budgets; game-asset-reference-modelling, lowpoly-model-from-refs and vehicle-model-validation skills. Existing collision, pivots, anchors and handling remain the contract for this visual change.

## Authoritative evidence

The actual owner vehicle is the MQ dual cab, alloy tray, closed black canopy, roof rack/left awning, right snorkel and tow hitch. Read `art/vehicles/tradie-ute/refs/measured-reference.json`: it records source locations/hashes, tape measurements, frame transform and uncertainty. The two downsized owner photos alongside it were inspected; the rear plate is already blurred in the source repository's tracked copy.

The newer `triton.glb` was read as evidence (714,440 bytes, six meshes, fourteen nodes; `newer-mesh-inspection.json`). Its `build_triton()` source and `fleet.json units.triton` supplied measured sizes and estimated cab/rack proportions. No mesh from that GLB ships in the game. The code-built faceted model remains reproducible.

The old Muse contact sheets are historical stylized composites, **not acceptance references for the real ute**. Their invented bonnet scoop, pickup tub, rear window and canopy hardware are removed. Their old silhouette IoU is not carried forward as a likeness claim. The actual photos are dark, occluded perspective views without calibration; no photo silhouette IoU is claimed.

## Measured improvement

| Feature | Before | Revised | Oracle |
|---|---|---|---|
| Canopy | too wide/tall; painted lid, invented rear glazing/hardware | 1.500 × 1.772 × .845 m, deck 1.090 m, top 1.935 m; black lid/closed rear; two low side locks | owner tape + photos |
| Tray | painted pickup tub and tall corner lamps | separate 1.620 × 1.835 m alloy deck; under-deck space, guards/mudflaps/boxes, horizontal amber/red/white rear lamps | owner tape + photos |
| Cab | broad square roof, steep short windscreen | narrower tapered roof, longer windshield rake and dual-cab span | newer owner-model estimates and visible cab cues |
| Accessories | coarse tier lost awning/snorkel | left awning and right snorkel present at every tier | owner evidence |
| Repetition cost | LOD0 wheels 752 exported triangles | wheels 240 triangles; body form receives the budget | actual baked mesh counts |

LOD totals are **1402 / 896 / 586**, within unchanged **2400 / 900 / 600** qualified budgets. Before was **2039 / 860 / 582**. The detailed body is cheaper; LOD1/2 spend a few more triangles retaining actual accessory/tray cues. Per-part counts are in `bake-check.log`; interiors remain separate from the body budget, as in the existing contract.

## Checks

- `node art/vehicles/tradie-ute/refs/check-measured.mjs`: PASS, current triangle geometry at all three LODs. UV-selected tray/canopy envelopes use independent owner dimensions, not candidate params. Also checks roof taper, neutral black canopy roof and accessory sides.
- Isolated pre-rebuild source at `/tmp/evidence/tradie-ute-before`: the same gate correctly rejects canopy/tray envelopes, cab roof width and painted lid at every LOD (`previous-measured-check.json`). It imports the old model successfully; rejection is not a failed load.
- Geometry defects: canopy raised 15 cm, tray widened 20%, cab roof widened 35%; all detected at all three LODs. These checks cover named errors, not complete likeness.
- `node tools/vehicles/bake.mjs --check art/vehicles/tradie-ute`: PASS, fresh bake exactly matches current output. A prior fresh bake supplied the bytes being checked.
- `target/debug/jj validate art/vehicles/tradie-ute/tradie-ute.asset.json`: PASS, `jj.vehicle.v1`, triangle budgets, no waivers (`contract-check.log`).
- All eleven collider POSITION buffers compare byte-for-byte with pre-rebuild baked GLB. Sidecar pivots/hinges/mass fractions, anchors and LOD budgets also compare identical (`frozen-physics-check.json`). `colliders.json` freezes the old points and the model freezes old pivots. No simulation mechanics changed.
- `node --test tools/vehicles/test/pivots.test.mjs`: PASS, 37 tests. The six refined body attachments compare source and sidecar exactly with original `d44c9093` pivot/hinge/mass/collider data. Narrower cab skins and separate tray now have different visual edges; moving the gameplay hinges to those edges would contradict this visual-only rebuild's frozen-physics scope. Defects reject centre/wrong-edge pivots, 1 mm drift on each axis, changed hinge axis and sidecar-only drift. All unlisted roster parts retain the visual hinge-edge assertions.
- `node tools/vehicles/view/capture.mjs ... --sheet ladder --ortho 3.2`, `--sheet colliders`, and `node tools/vehicles/evidence/run.mjs tradie-ute ...`: PASS through actual baked asset loader, Playwright Chromium 151.0.7922.34 on Mac, software-rendered review viewer. Every screenshot was opened and inspected.
- Measured-reference review page integration: the build copies the oracle/report and derives width/length/deck/canopy-height rows; item 1 now accepts this explicit evidence path and rejects missing files, nonfinite/missing rows, failed or missing LOD/check/defect data. Existing per-view IoU path is unchanged. Eight focused review tests pass, including Cruz/reference regressions.
- `art/ui/lib/live-check.mjs --local` on the ute review page at 412×915 and 1920×1080: captured and visually inspected; no failed requests, missing images, JS errors, blank canvas or horizontal overflow. The command exits 1 because its existing screen-edge heuristic flags text/the linked photo crossing the initial viewport bottom of this normally scrollable long page. Full-page captures in `review-page/` show the content intact. This heuristic failure is disclosed, not represented as a green automated check.

- PASS contract and byte-reproducible bake at unchanged budgets.
- PASS independent owner-tape envelopes and named photo cues at all LODs; old candidate and injected defects rejected.
- PASS frozen collider bytes, part contract and anchors unchanged.
- PASS standalone baked-loader visual review; no new host/device or driving measurement claimed.

## Visual evidence and limits

`before-ladder.png` and `ladder.png` use the same viewer/cameras and ortho half-frame 3.2 m. The ladder covers front, front 3/4, side, rear 3/4, rear and top for every LOD. `paints-strip.png` shows white and five player colours with neutral tyres/canopy/accessories. `damage-strip.png` and `damage-strip-overview.png` show intact, loose hinges, each detached part and stripped shell with the original part contract. `grid-1.png`, `grid-4.png`, `grid-24.png` show different LODs/colours at tile scale. `colliders.png` honestly displays the retained old collision shell; it intentionally differs from the refined visual shell.

The front/cab remains an interpretation with broad facets; the night photographs do not provide a calibrated front orthographic reference. Rack/bag maximum 2.20 m was only an earlier owner estimate; the photos confirm an awning but cannot resolve a roof bag, so none was invented. Published 3 m wheelbase/.802 m tyres are evidence, while existing game wheels stay at z ±1.45 m/radius .43 m to preserve handling. These are disclosed stylization/physics constraints, not claimed exact measurements.

The standalone evidence viewer poses damage and colours; it does not prove dynamic debris lifetime, gameplay recovery, phone controls or roof-number rendering. Existing engine profile, single material and batching code are unchanged; there is no new draw-cost or sound claim. The parent bead owns current host/scenario evidence and profile sync. Owner playtest is still the final judgment of likeness.
