# P1-R05 · Fresh-eyes review of the camera captures (interim: against the current POC, not yet the accepted set)

**Captures:** `first-person-4.jpg` (4 seats, all first person) and `mixed-fp-tp-12.jpg` (12 seats, five in first
person), from `web/host/tests/camera.test.mjs` on the real host build (synthetic cars over the greybox). Opened at
gameplay size (1920×1080). **Reference:** the bead names the *accepted* mocks (G-DESIGN, br-p1-u04-cr8), which don't
exist yet; until they do, this note judges against the current POC framing captures
(`docs/evidence/P1-U05.2/captures/grid_n=4_fp=2.jpg`, `grid_n=8_fp=2,5.jpg`, `grid_n=32.jpg`), side by side in
`r05-vs-poc.jpg`. The accepted-set review is the open part of this bead.

**Present:** third person high behind the car with the road ahead, the car in the lower third at a steady size (the
preset's distance, not stretched by speed); first person over the bonnet with a slim strip of bonnet and the aerial,
the road most of the tile, and the rear-view mirror in the sky strip (segmented first person, R98); first- and
third-person tiles side by side in one grid; the join pill under the top row's mirror strip, clear of cars.
**Different from the POC:**
- More sky in third person than the POC TV mock shows: the framing data is the POC's own (`mid`: 8.4 m back, 4.4 m
  up, aim 17 m ahead at 0.3 m, 58° FOV, a 9.2° pitch), which puts the horizon about 35 % down the tile here; the mock
  lies lower. A G-DESIGN tuning call (`assets/profiles/camera.json`).
- The first-person eye sits 1.05 m forward rather than the POC's 0.45 m, because the baked Cruz Missile's bonnet is
  higher than the POC car's; at 0.45 m it took 40 % of the tile.
**Absent by design (other beads):** tile borders, names, positions and lap pills (P1-R06/R07), the comic look
(P1-R10), the map's biome dressing (M04–M07).
**First look:** reads as the POC's race tiles with plainer art. **Ambiguous:** none.
