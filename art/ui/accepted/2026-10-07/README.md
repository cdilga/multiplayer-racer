# Accepted design set, 2026-10-07 (G-DESIGN, P1-U04)

The owner accepted the design POC as published at `https://jammers-preview.dilger.dev/poc/` on 2026-10-07
(round record: `docs/playtests/poc-2026-10-07.md`). This folder freezes what was accepted, taken from commit `532617856b88`:

- `GUIDE.md`, `tokens.json`: the UI guide and design tokens.
- `poc/`: the gallery (TV and phone mocks, world look, motion reel, derby Overview, engine synth, voice audition page),
  without `poc/vendor/` (third-party libraries, unchanged) and the voice clips (not committed, R89).
- `frames/`: the style frames.

Ports of the UI (P1-U06 onwards) build from `art/ui/` and check against these references; this copy never changes.
