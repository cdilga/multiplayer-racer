# P1-C12 implementation slice

2026-10-11, CyanBridge, Mac Apple M1 Pro (darwin/arm64). Parent br-twal stays open:
the native helper/installer (br-twal.1) and real device rows are still outstanding.

## Behaviour and checks

- Real Rust server `/tmp/jj-macos-server-w01`; real room/join URL and WebRTC.
  `c12-many-controllers.test.mjs` native GPU cohort passed all 24 unique drive signatures,
  one connection per joined endpoint, isolated unplug/held-seat/replug/manual resume,
  Leave/Remove/chord, and per-source bytes plus observed-applied age. Run 190.95 s;
  receipt `cohort-native-metal.json` names ANGLE Metal Apple M1 Pro and loopback topology.
- Cohort: host four pads/two clusters; two laptops six pads/two clusters each;
  two phone viewports one pad each. These are **Gamepad API emulations**, including the
  six-pad Chromium pages. No physical enumeration, WAN or physical rollover claim.
- Fresh UI run: Chromium guidance/live QR/three cluster legends/numpad runtime wire
  sequence, Firefox eight distinct pad seats, WebKit QR/legend matrix: 3/3 pass, 38.41 s.
  Five viewports plus real fullscreen enter/exit and resize; every capture inspected.
- `npm --prefix web run typecheck`: pass. Native `jj-wasm-host` tests: 48 pass in the
  preceding implementation run. WASM testing build through RCH/eris: pass after kit refresh.
- Cluster C has separate numpad codes; Enter remains a host key. Guidance names
  Firefox or another joined browser endpoint; it does not impose a scanner cap.
- The live-check tool now waits for document load/fonts instead of network idle:
  a room's intentionally open SSE stream never becomes network idle.

## Measurements and limits

The native receipt's 8.009 s window accounts for every source. Wire dispatch to first
observed applied sequence includes observation polling, so it is an upper bound;
local exact rolling sample-to-tick ages are separately labelled and may include setup.
Packet header attribution uses the actual record count in each packet. No traffic cap
or array truncation was added.

Full-resolution SwiftShader failed at pattern 2; quarter-resolution failed at pattern 3.
`software-failures.json` retains their state: all carrier inputs stale together,
neutral network cars and dropped local seats on autopilot. Reduced pixels did not
qualify this cohort. The 24-live-view test therefore runs at default resolution in
the GPU workflow (like R06); ordinary CI still runs all browser UI/source checks.

A subsequent native attempt reached `no-route` while both peers stayed in ICE
checking, with no restart/rebuild. A short direct join reproduced that state;
another joined normally. Explicit local-network permission did not prevent it.
This is an initial-connection recovery defect to investigate with br-b8lp;
the earlier passing receipt is evidence of that run, not a claim that this failure
is fixed. No retry or inflated deadline has been added.

Visual defects and unmeasured hardware are listed in `self-review.md`.
Deployed preview checking follows publication; this slice does not close the parent.

## CPU Firefox and GPU CI follow-up

CI3393's Firefox host did not reach room creation on a CPU runner. In an active Ubuntu CI container using the same image on triton, plain headless Firefox and force-enabled headless Firefox both returned no WebGL2 context. Headed Firefox under Xvfb with Mesa software rendering returned WebGL2 with renderer `llvmpipe, or similar`. Running the real eight-pad Firefox test that way passed in 9.90 seconds; the Mac Firefox test passed in 4.80 seconds.

The journey now creates an isolated Xvfb display for Linux CPU Firefox, forces Mesa software rendering and kills the display in finally. GPU/native Firefox keeps its normal path. Unsupported host capability now fails with the explanation immediately instead of waiting three minutes for a room that cannot exist.

GPU3403 at83eb6116 passed every selected journey, including the24-source cohort24.90s, Firefox eight-pad5.74s, Chromium/WebKit guidance and120-tile Identify. Browser-cache isolation fixed the stale interactive install lock; the workflow installs all three browsers from the pinned Playwright version. No fresh-context retries were added.
