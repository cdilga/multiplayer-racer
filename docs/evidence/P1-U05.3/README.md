# P1-U05.3: in-world graphics rework (chevron posts, guard rail, no checkpoints, race-banner finish)

The owner's POC round 2 items POC2-01 to 05 (`docs/playtests/poc-2026-10-03-round2.md`; rulings R104 to R106), on the
live in-world mock at `https://jammers-preview.dilger.dev/poc/world/#graphics`.

**Machine and browser:** Apple M1 Pro, Chromium 151 from Playwright, WebGPU backend. Re-run with
`JJ_EVIDENCE_DIR=docs/evidence/P1-U05.3/world JJ_STATES='graphics,grid&n=24,tv,overview&n=16' node art/ui/poc/world/capture.mjs`,
then `python3 docs/evidence/P1-U05.3/make_refs.py`.

## References

The bead asked for real photos first: the owner's guard-rail memory is the generated
`art/references/australia/generated/biome-outback-dirt-and-bitumen.png`, and none of the owner's photos in `raw/` show
road furniture. Five licensed Wikimedia Commons photos are now in `art/references/australia/raw/`. Sources, authors and
licences are listed in `art/references/australia/README.md`:
- three W-beam photos (CC BY 4.0, CC BY-SA 4.0): a run with a terminal and delineator in Brisbane, a close-up of the
  profile and block-outs in Fremantle, and a culvert bridge in Cecil Hills;
- two of rows of single-chevron posts on bends (CC BY-SA 3.0): Cunningham's Gap and Helensburgh.

They're resized to 2000 px and are reference only. Nothing is traced; the props are code-built.

## Decisions (one each, with why)

| Item | What | Why |
|---|---|---|
| POC2-01 chevrons | Rows of posts on the outside of every sharper bend, roughly every 10 m. Each post carries one yellow chevron (black, ink-edged) that points the way the road turns, facing the approaching cars | R104: the common Australian chevron alignment marker, not a multi-chevron board |
| POC2-02 guard rail | A galvanised W-beam with a real W profile, 20% over life size so it reads at chase distance, on posts. It has yellow delineators on every sixth post and flared terminals with rounded caps where each run starts and ends. It runs continuously on the outside of bends and on both sides of straights, where the tyre walls and rails were. Tyres are now only derby dressing | R105; the references show W-beam on posts with flared ends and delineators |
| POC2-03 checkpoints | The "Checkpoint N" gantries and their road paint are gone. Lap-validity checkpoints remain invisible gameplay (plan §8) until the owner decides; that's open in the round-2 doc | R106 |
| POC2-04 finish | A race banner across the track on a light truss frame, after `world-finish-gantry-tatts-finke.png`'s language. A long ink banner carries big paper type, "START · FINISH" with "FINISH" in saffron, and is wider than the road. A slanted saffron end panel carries our name, a slanted chequer panel closes the other end (R102's slants and contrast backing), a chequered flag stands on a pole by the line, and the chequered line is on the road. None of the reference's sponsors or words | R106 + R102 |
| POC2-05 paint | Unchanged: no change to the car paint, the atlas or the identity colours (the only "paint" lines removed are the checkpoint road markings) | Owner: keep |

There's no points graphic in the POC world. When one comes, it uses the same banner (R106).

## Acceptance

| AC | Result |
|---|---|
| POC2-01: corner chevrons are rows of single-chevron posts | `world/captures/1080p-graphics.jpg` (bottom left "Corner chevron posts"), `1080p-tv.jpg`, `1080p-grid_n=24.jpg`; next to the Cunningham's Gap photo in `refs-vs-world.jpg` |
| POC2-02: Australian W-beam guard rail; real reference photos added to `art/references/australia/raw/` | Five photos with their licences (above). The rail and a terminal are in `1080p-graphics.jpg` (top right, bottom right) and up close in `1080p-tv.jpg`; next to the Brisbane photo in `refs-vs-world.jpg` |
| POC2-03: no Checkpoint N gantries; the lap-validity question left open | `graphics.checkpoints` stays empty and no "CHECKPOINT" banner is built (`world.js`). The question stays open in the round-2 doc |
| POC2-04: the finish line (and any points graphic) in the race-banner gantry style with R102 | `1080p-graphics.jpg` (top left "Start-finish banner"), 4K too; next to the reference in `refs-vs-world.jpg` |
| POC2-05: paint colours unchanged | No paint, atlas or identity changes in the diff; `1080p-grid_n=24.jpg` and `1080p-overview_n=16.jpg` show the same liveries |

All eight captures (1080p and 4K) ran with no page errors and no external requests (`world/capture-report.json`).
