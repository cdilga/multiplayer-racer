# br-bbki.19 (P1-FL03.1): the Feel Lab scene picker

The owner tuning panel (`?tune`) gains a Scene row: pick a Feel Lab scene (every committed `maps/lab/<scene>.json`, `jj
lab`) and Load scene, and the next round runs on that scene's map; Generated tracks goes back to the generator. It rides
the round preparer (`web/host/src/procgen/prepare.ts` `loadScene`): the scene's map is validated like a dev map and handed
to the sim through MapReady with plan `lab:<scene>`, so the sim journals it as that round's world (R90) and the session
recorder's per-round worlds (`jj sim --replay`, F12) carry it.

## Tests

- `web/tests/journeys/fl03-1-scenes.test.mjs` (Playwright Chromium on eris, 32ddb325): for canyon-leap, hairpin-cut and
  off-road-climb, picked and loaded in the panel in a real room: the round's plan is `lab:<scene>`, the shown route is the
  scene's committed map (route point count), and a seated controller drives on it (moved > 2 m). 3/3. `tsc --noEmit` clean.
- A/B and presets mid-run: `fl03-feel-lab.test.mjs` (FL03).

## Looked at

- `panel-*.png` (1920x1080): the Scene row under the values (Generated tracks plus the three scenes, Load scene) above the
  session seed row; it reads, nothing overlaps.
- `scene-canyon-leap.png`: the dirt road into the canyon between the rock towers, lap 1/9 chip, the panel beside it.
- `scene-hairpin-cut.png`: tarmac into the hairpin with its chevron row.
- `scene-off-road-climb.png`: the dirt valley floor toward the climb.

## Defects found and fixed

- None in these captures.

## Remaining defects

- The picker sits on the Values tab, not the Feel Lab tab; it loads at the next round, not mid-run.

## Not covered

- A scene-specific `jj sim --replay` of a recorded session: the replay path is F12's (every round's world from its map
  bytes), which a scene round uses unchanged. WebKit.
