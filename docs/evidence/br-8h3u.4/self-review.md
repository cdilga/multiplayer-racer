# br-8h3u.4: stray geometry beside the loops: self-review

Owner, playtest 3 (2026-10-24): "There are some weird geometry bits off the edges of the loop the loop."

## What emitted it

The loop's own mesh (`jj-map::looping::loop_mesh`, mirrored by `web/host/src/render/map/loop.ts`) is clean: deck and two
barriers as closed prisms from the entry to the exit, seen from six sides in every biome below. The stray pieces were
**roadside dressing standing through the loop**. `jj_procgen::loops::clear_footprints` took a piece off a loop's
footprint only when its *pose* was within 2 m. A building, a rock dome or a long rail whose pose was just outside
still reached through the deck and its barriers. Town seed 2 (`town-2-before.jpg`, before the fix) shows it: a
lot's building stands under the loop's arc, beside the exit.

## Fix at the source

`loops::clear_footprints(map, registry)` now removes any dressing or prop that **reaches** within 2 m of the footprint.
Reach is half the kit piece's registry footprint diagonal, the rule `setpieces::clear_footprints` already uses.
`loops::intrusions` reports what still reaches in. GENERATOR_VERSION is 36 and the goldens are re-blessed.

## Check across seeds (AC2)

`crates/jj-procgen/tests/loops.rs` `nothing_placed_beside_the_road_reaches_into_a_loop`: for every seed in the loop
bank (4 biomes x 16 seeds in release, quick in debug), `loops::intrusions` of the race-prepared map is empty.

## Captures (AC3)

`loop-views.mjs` (run from the repo root, Chromium on the Mac, local build) generates a seed with a loop. It loads it
in the real host, and draws one frame per view through the new `__jjRender.peek(eye, target)` hook: left, right,
front, back, above and low. The hook turns on the same terrain LOD layer a game camera does.

- `town-2-before.jpg` / `town-2-after.jpg`: the building under the arc (top view top-left, back view bottom-middle) is
  gone; the rest of the town stays.
- `rocks-4-after.jpg`, `outback-bitumen-4-after.jpg`: deck, barriers, road, terrain and domes all clean from every
  side.

I looked at every view. Not covered: an owner drive past a loop in a real race (playtest).

## Looked at

Every view in `town-2-before.jpg`, `town-2-after.jpg`, `rocks-4-after.jpg` and `outback-bitumen-4-after.jpg` (left, right,
front, back, above, low), 1600x900, Chromium on the Mac, local build, generator 36.

## Defects found and fixed

- A town lot's building stood under the loop's arc beside the exit (town seed 2): gone after the fix.
- The first captures showed "floating" boxes and no road: the capture camera hadn't turned on the terrain LOD layer. Fixed
  in `peek` (`useLod`), so they were the hook's artefact, not the game's.

## Remaining defects

None seen on the three seeds.

## Not covered

An owner drive past a loop in a real race; a real TV or GPU.
