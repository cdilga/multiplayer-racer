# P1-R09 · Retained highlights

Local validation on the Apple Silicon Mac, 2026-10-12, on `v0.2-revamp` after `cd6ec940`.
The Rust server, host WASM worker and two browser phone controllers use the real join path and WebRTC.
Explicit R90 commands detach Roo's front and Gazza's door, then move Roo out of bounds to trigger a real wreck.
These are deterministic setups, not claims about naturally occurring crash rates.

The recorder samples the 120 Hz simulation every four ticks (30 Hz), keeps 20 seconds of rolling history,
and retains complete quantised presentation frames around events (3 seconds before, 2 after).
It owns the map baseline, vehicle/paint identities, intact/loose/detached parts, debris, husks and rail poses.
Eviction applies to stored footage only. The player owns a separate world with no authoritative input callback.
Hide disposes it and expands standings. The director's intermission/countdown policy remains in charge.

## Checks

- `node --test web/host/tests/reel-frame.test.mjs web/host/tests/reel-recorder.test.mjs`: 9 pass (`codec-recorder.log`).
  Includes retained clips surviving ring eviction, pressure/oversize rejection, missing intervals, identity coverage,
  airborne suspension contacts, close finishes and the 60-second selection bound.
- `rch exec -- cargo test -p jj-wasm-host --all-features`: 51 pass (`native-host.log`).
- `scripts/build-host-wasm.sh`: pass (`wasm-build.log`).
- `npm --prefix web run build`: typecheck and Vite pass (`build.log`).
- Vehicle bake reproducibility/contract check: pass (`vehicle-contract.log`).
- Real two-round WebKit journey: pass, 22.953 seconds (`webkit.log`). Both detach identities and the wreck are retained;
  playback and Hide preserve the live hash/room; round two starts without a Start command and resets footage.
- Focused results browser checks: 5 pass, cohorts 1/2/8/32/99 and three aspects (`results-layout.log`).
  The two-player regression includes a 64px caption band, readable text >=12px and stationary Start bounds.
- Chromium run and local live-check captures are recorded alongside this receipt. The final deployed review below
  supersedes the earlier pending deployment.

WebKit's two-car run accounts 174,490 bytes (high water), below the 67,108,864-byte budget. Capture mean 0.093ms,
max 1ms in that run. Exact packed buffers and UTF-8 baseline bytes are counted; JS object/reference bookkeeping is
charged conservatively. This is an accounted replay-store budget, not a universal measurement of browser heap overhead.

## Reuse and limits

Reuses the canonical vehicle renderer/contracts, map renderer, interpolation, accepted UI kit and director policy.
No model/LOD/material generation, new player limit or live-debris eviction. The replay camera is a broadcast orbit;
the shared motion preference removes its orbit in reduced mode. The R90 surface exposes pause, seek and inspection.
Playwright Chromium/WebKit are automated browsers, not physical phones or Safari. WAN TURN and GPU performance are
outside this two-controller run. Newborn particles come from recorded damage transitions through the existing FX layer.

## Final deployed check · 2026-10-12

Preview `https://jammers-preview.dilger.dev/p/v02-04a9054b/`, containing green CI3583 and the portrait font correction.
The unchanged real two-controller journey passes in Chromium (131.65 s, software WebGL) and WebKit (22.84 s), including
both retained detaches and the wreck, actual playback, Hide, stationary Start bounds, readable >=12px standings,
and automatic round two. `deployed-final/{chromium,webkit}.txt` and each browser's `browser-run.json` record the run.
The measured recorder owns 174,490 bytes in each browser, within the retained 64 MB budget.
All 32 browser images and the four no-replay live-check images were visually inspected in labelled four-image sheets;
the WebKit 375x667 replay image was also opened at original size to judge small-phone typography. No clipping,
overlap, blank replay, broken QR, or resize-only layout repair was found. This run qualifies those tested viewports;
physical phones/TV, Safari, WAN and full-cohort GPU measurements remain outside it.
