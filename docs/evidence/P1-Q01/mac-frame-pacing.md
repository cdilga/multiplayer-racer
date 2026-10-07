# P1-Q01: headed Mac frame-pacing receipt (owner step)

This is the one Q01 receipt an agent can't take: it needs a real display, a real GPU and no other GPU work. The Mac has to be
quiet, so it's an owner step, listed in the P1-Q02 checklist. The helper refuses a headless run and refuses to start while another
browser's GPU process or another perf run is using the GPU (`web/tests/journeys/harness/perf.mjs`), so a polluted run can't produce
a receipt.

## Before you start

1. Close every other Chrome, Chromium and Playwright window, and anything else drawing hard (video, games, other agents' browser
   tests). Plug the Mac into power. Disable the display sleep for the run.
2. For the 4K rows the display must really be 3840x2160 at 1x, or the run will report the browser's own resolution; the
   receipt names the pixels it actually rendered either way. On the TCL, mirror or extend to it and drag nothing across.
3. Build the host at the commit under test:

   ```
   git pull && npm --prefix web ci && npm --prefix web run build
   ```

## The command

```
node web/tests/journeys/harness/perf.mjs frame-pacing --tiles 1,4,8,12,16,24,32 --sizes 1080p,4k --frames 600
```

It opens Google Chrome headed (`--channel chromium` for Playwright's Chromium instead), once per size and tile count, waits 120
warm-up frames (shader compile and upload happen there), then samples 600 steady frames. It writes
`docs/evidence/P1-Q01/frame-pacing-<hostname>.json` and prints one JSON row per cell.

Expect a few minutes. Don't touch the keyboard or mouse while it runs; leave the windows alone.

## What the receipt must show

Per row (size x tiles): `steady.p50/p95/p99/max` in ms, `hitches` (count, by kind, the five worst), `draws`, `triangles`, the
actual `renderPixels` against `nativePixels`, and `resolutionSource`.

Checklist:

- [ ] `evidenceKind` is `ev:hardware` (not `supplementary`), and `browser` says headed Google Chrome.
- [ ] `machine.gpu` names the Mac's GPU, and `build` is the commit you meant to measure.
- [ ] Every row has `resolutionSource: native` and `countsAsNative: true`. A row marked `auto-lowered` means the host's frame
      budget guard lowered the render size during the run (R111): that row does not count as native evidence. Note it, and
      report the tile count where it started. A `user-lowered` or `browser-limited` row is likewise not native.
- [ ] `nativeRowsOnly` is `true`, or each non-native row is called out in the Q02 notes with the next step (never hidden by a
      cap).
- [ ] 1080p and 4K both present for 1, 4, 8, 12, 16, 24 and 32 tiles (14 rows).
- [ ] p99 and max are read, not just p50: a 60 Hz display wants p95 under ~16.7 ms; a max over ~50 ms is a hitch to investigate.
      The `hitches.byKind` line says where to look: `shader-compile-or-upload` means warm the shaders before a round,
      `gc` means allocation in the frame loop, `main-thread-js` means snapshot decode or sim work on main.
- [ ] Commit the JSON and add a short line to `docs/evidence/P1-Q01/README.md` (or the Q02 checklist row) with the verdict.

## Optional second pass

Run again with `--sizes 4k --tiles 24,32 --frames 3000` for a longer soak; hitches that appear only after a minute are the ones
that matter on a TV.

## Not covered here

Real phone hosts and a weaker laptop are separate P1-Q02 rows. The GTX 1080 runner on triton is a second GPU if it's enabled;
run the same command there headed under a real display session and label the receipt with its host name.
