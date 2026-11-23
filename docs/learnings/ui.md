
## P1-U06: the kit port

- `art/ui/lib/shot.mjs` only captures; there is no compare mode. The kit test compares per-button crops against the POC sheet
  (`art/ui/sheets/components.html`) with pngjs (`web/shared/ui/tests/lib/compare.mjs`). Same labels give the same seeded brush shape, so sizes
  and shapes match exactly; the 2-4% pixel floor is the sheet's dashed row guides and the spinner angle.
- Brush skins bake the outline width in, so `applyProfile` re-installs them when the profile or TV scale changes.
- `--outline` is a `calc()` on the TV profile; measure it (`outlinePx`) rather than parse it.
- The dcg hook refuses very long heredoc commands; write big files with the Write tool.

## Round screens (P1-R07)
- The host test page with no room server must not mount the round screens: the opaque Lobby covers the canvas. `main.ts` mounts them only with a room code.
- Kit tokens (`--fs-*`, `--sp-*`, `--outline`) are computed at `:root` from `--ui-scale`, so overriding `--ui-scale` on a child does nothing; the round screens re-declare the tokens on `.jj-round` from `--rk`.
- `fitGrid` (round/fit.ts) is the roster rule: richest tier that stays legible, a floorless last tier, never a cap or scroll. Cards fill column by column.
- Fixtures: `host/?roundfixture=lobby-32|race-99|results-32|countdown-8-3`; `__jjRoundFixture.set(room)` swaps any RoomView. Only races draw one tile per player; other fixtures use one tile so a 99-player lobby loads fast (a 99-tile world costs ~20 s in software GL).

## Derby reads and captures (br-bhkz.2)
- The derby's TV view is the Overview (one camera, the strip at the top), not the grid: a per-tile HUD change is unseen there. Health and hits are in both (`ui/overview/band.ts`, `round/hud.ts`), from the same `shared/src/derby.ts`.
- `__jjRender.peek(eye, target)` stops the frame loop; `frame()` draws one frame and does not restart it. After a peek, a camera change (Grid/Overview, ~300 ms) needs frames pumped over real time or the screenshot shows the old view.
- For a canvas-only still, hide the DOM (`html.peek body * { visibility: hidden } html.peek canvas { visibility: visible }`): an element screenshot of the canvas includes the HUD layered over it.
- Playwright's browsers are not installed on the Mac by default (`npx playwright install chromium`); `JJ_CHROMIUM_GPU=native` renders on Metal.

## Player feedback (br-1s9h, R142)
- The sheet is the owner's shared widget (`web/shared/src/feedback.ts` loads `games-feedback.dilger.dev/widget.js` on first use, never at boot: several journeys assert no request leaves the page's origin). Tests stub that host with `web/tests/journeys/lib/games-feedback-widget.js`; refresh the copy when the sheet changes.
- The TV's picture is of the canvases only (`canvas.jj-world`, and the reel on Results): the Lobby's paper and the HUD are page elements, so a Lobby picture shows the world under the paper. `world.invalidate()` before a capture makes a held or covered world draw the frame the picture takes.
- Phone and TV pages can pass notes without the sim: a string sent on `cmd` arrives as `onText` (`shared/transport/peer.ts`); binary frames are gameplay as before.
- To process what comes in: `node tools/feedback.mjs pull --game jammers` in the owner's `local-multiplayer-games` repo (its `docs/FEEDBACK.md`).
