
## P1-U06: the kit port

- `art/ui/lib/shot.mjs` only captures; there is no compare mode. The kit test compares per-button crops against the POC sheet
  (`art/ui/sheets/components.html`) with pngjs (`web/shared/ui/tests/lib/compare.mjs`). Same labels give the same seeded brush shape, so sizes
  and shapes match exactly; the 2-4% pixel floor is the sheet's dashed row guides and the spinner angle.
- Brush skins bake the outline width in, so `applyProfile` re-installs them when the profile or TV scale changes.
- `--outline` is a `calc()` on the TV profile; measure it (`outlinePx`) rather than parse it.
- The dcg hook refuses very long heredoc commands; write big files with the Write tool.
