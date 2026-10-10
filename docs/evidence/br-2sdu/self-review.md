# br-2sdu visual self-review (owner tuning menu)

Captured by `node --test web/tests/journeys/pt1-tuning.test.mjs` with `JJ_CAPTURE_DIR=docs/evidence/br-2sdu` (headless chromium, Mac).
Every image below was looked at.

| Image | Shows |
|---|---|
| `tuning-open-1280x720.png` | Laptop size, mid-race: vehicle rows (Car group), Regenerate / Export footer, built readout |
| `tuning-changed-1280x720.png` | A changed vehicle value: the row is blue with its reset arrow, "1 changed" |
| `tuning-input-1280x720.png` | Input section open |
| `tuning-generator-refused-1920x1080.png` | TV size: generator rows, a refused value (min 5000 above max 820) in the red banner, the row back at 720 |
| `tuning-generator-built-1920x1080.png` | After Regenerate: "built: seed 2, 802.245 m long, 1.771 m relief" |
| `tuning-generator-reset-1920x1080.png` | One row reset (back to 1100, arrow gone), "9 changed" |

Defects found and fixed in this pass:
- Group headings for generator rows read "Generator.Biomes.Greybox.Terrain" (dots, long). Now "Generator > Biomes > Greybox > Terrain".
- The built readout was squeezed into the footer and wrapped over five lines. It is now its own line above the footer; Regenerate is saffron so it reads as the action.

Known and left: the 1920x1080 captures were taken in the Lobby (the generator journey stays in the Lobby), so the panel sits over the lobby, not a race; the panel is 360 px wide and scrolls, so the generator section is long (5 biomes x terrain and features). Biome groups start folded for the owner; the journey opens them.

AC1 (flag off, production build has none of the panel code): `a production build contains no tuning panel code` in `web/tests/journeys/pt1-tuning.test.mjs` builds with `JJ_PRODUCTION=1` and greps every js/css/html file for the panel markers (the flag-on build does contain them); `no owner flag: no panel and no tuning chunk` covers the runtime side.
