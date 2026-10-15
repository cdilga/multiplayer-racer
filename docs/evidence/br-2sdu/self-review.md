# br-2sdu visual self-review (owner tuning menu, the epic)

## What it is
The feature-flagged owner tuning menu on the host (`?tune`): live vehicle values (br-2sdu.1), control thresholds pushed
to every controller (br-2sdu.2) and track generator values with Regenerate (br-2sdu.3), all exported as data patches.
The children's own reviews: `docs/evidence/br-2sdu.1/self-review.md` and the stills below.

## Tests
- `web/tests/journeys/pt1-tuning.test.mjs` (headless Chromium, Mac): no owner flag → no panel and no tuning chunk; a
  `JJ_PRODUCTION=1` build contains none of the panel markers; `?tune` mid-race changes a vehicle value and an input
  threshold (the phone uses it within 1 s); generator length band and relief change the measured track on Regenerate;
  refused values; export.
- `crates/jj-wasm-host` `a_tuning_change_applies_at_a_tick_boundary_and_replays_bit_for_bit`; `crates/jj-tools`
  `vehicle::tests::tune_*`; the input-profile goldens and push/late-joiner/replay tests.

## Looked at
Captured by the journey with `JJ_CAPTURE_DIR=docs/evidence/br-2sdu`; re-read 2026-10-16 by AmberSpring for the epic close.
- `tuning-open-1280x720.png`: race tile with the panel open on the left (Car group, values readable), "built: seed 2,
  914.244 m long, 2.478 m relief" on its own line, saffron Regenerate and Export in the footer, "No changes".
- `tuning-changed-1280x720.png`: one changed vehicle value in blue with its reset arrow, "1 changed".
- `tuning-input-1280x720.png`: the panel over the world at the start line before a race; the Car group is what shows
  (the Input section sits further down the scroll), "No changes"; the panel overlaps the keys help card at top left.
- `tuning-generator-refused-1920x1080.png`: TV size in the Lobby: a refused length (5000 above the 820 maximum) in the
  red banner, the row back at 720; biome groups read "Generator › Biomes › Greybox › Terrain".
- `tuning-generator-built-1920x1080.png`: after Regenerate, "built: seed 2, 802.245 m long, 1.771 m relief", 10 changed.
- `tuning-generator-reset-1920x1080.png`: one generator row reset, its arrow gone.

## Defects found and fixed
- Generator group headings read "Generator.Biomes.Greybox.Terrain"; now "Generator › Biomes › Greybox › Terrain".
- The built readout was squeezed into the footer over five lines; it is its own line above the footer.

## Remaining defects
- The open panel covers the left third of a 1280 px screen and, in the Lobby, the room title's left end and the keys
  help card. It's an owner tool that closes with its tab; left as is.
- `tuning-input-1280x720.png` is named for the Input section but shows the Car group at the top of the scroll.

## Not covered
- The owner's 4K TV and a real phone receiving a pushed threshold (the journey uses emulated controllers).
