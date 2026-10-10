# br-2sdu.1: owner tuning menu, part 1 (live vehicle tuning)

## What it is
- `?tune` on the host (remembered in that browser; `?tune=off` clears it) shows a **Tune** tab on the left edge. The
  panel lists every field of the car's tuning as the sim holds it, grouped by section; nothing is hand-listed, so a new
  profile field appears on its own. Mass and inertia say "next car" (a body takes them when it spawns).
- A change is a `SetTuning { field, value }` UI command: applied at a tick boundary and journalled like every UI
  command, so a tuned session replays. A bad field or value is refused and shown; the sim keeps the last good value.
- The tuned profile carries into every round's new world (the host keeps it; `reset_world` builds with it).
- **Export patch** downloads `jj.tuning-patch.v1` (`set`: field/value pairs in the order changed; a reset drops a field).
  `jj vehicle tune <patch.json> [--check]` writes it into `assets/profiles/<car>.json`, touching only `tuning` and
  re-parsing before it writes.
- A production build (`JJ_PRODUCTION=1`) has none of it: `__JJ_OWNER_TOOLS__` is false and the panel's chunk isn't
  emitted (checked: no `jj-tune`/`Owner tuning`/`tuning-patch` in the production build; the preview build has
  `assets/panel-*.js`).

## Tests
- `crates/jj-wasm-host` `a_tuning_change_applies_at_a_tick_boundary_and_replays_bit_for_bit`: the same tuned script
  gives the same state hash twice and differs from the untuned run; the sim and the menu read the new value; a bad
  field is refused.
- `crates/jj-tools` `vehicle::tests::tune_*` (4): writes the field and keeps the rest, `--check` writes nothing, an
  unknown field and a wrong contract leave the file untouched.
- `web/tests/journeys/pt1-tuning.test.mjs` (Mac, Playwright Chromium): no flag → no panel and the chunk is never
  fetched; `?tune` mid-race: engine force 0 reads back from the sim inside 1 s and the cars' mean speed falls
  17.2 → 3.1 m/s over 4 s; Reset restores it and drops it from the export; Export downloads the patch.

## Looked at
- `tuning-open-1280x720.jpg`: race tile, panel open over the left of the world, values at 6 significant figures.
- `tuning-changed-1280x720.jpg`: engine force set to 0 (row in blue with its reset), "1 changed", the tab clear of
  the seat badge and the boost bar.

## Defects found and fixed
- Values showed f32 noise (0.800000011): shown to 6 significant figures.
- The tab covered the tile's seat badge, then the boost bar: it is now a tab at mid-height on the left edge.

## Remaining defects
- The open panel covers the left third of the world on a 1280 px screen. It's an owner tool and closes with the tab;
  left as is.

## Not covered
- The owner's TV at 4K (the couch test). Parts 2 (control thresholds to phones) and 3 (generator values) are their own
  beads (br-2sdu.2, br-2sdu.3).
