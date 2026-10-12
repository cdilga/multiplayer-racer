# P1-F02 WebKit CI image repair

2026-10-11, CyanBridge. Playwright 1.62.1 / WebKit 2336, Linux Docker runners; these are WebKit checks, not Safari or device checks.

- CI run 3273 failed because the image lacked `webkit-2336/pw_run.sh`.
- After adding WebKit, run 3284 aborted: “libsoup3 symbols detected. Using libsoup2 and libsoup3 in the same process is not supported.” Ubuntu 22's system GStreamer WebRTC plugin links libsoup2, conflicting with bundled WebKit's libsoup3.
- The pinned Ubuntu 24.04 base keeps those plugins on libsoup3. The content-addressed image is `jj-ci:6df24842ee3e`; built on triton and TrueNAS before changing the workflow.
- On each host, a disposable image container rendered a page in WebKit, established a connection to Chromium and delivered `controller-input` through a real data channel. Both peer states were `connected`.
- In that image on triton, the existing `portrait-coach.test.mjs` WebKit journeys passed **2/2** (412×915 and 375×667), through the real jj-server and normal controller join. They assert rotate/tutorial exclusivity, resize and upright consent. Checkout/server artifacts came from CI run 3297; no browser download step was run.

All five CI workflow image references use the new tag. Green Gitea CI is still required before closing this bead.
