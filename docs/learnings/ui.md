
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
