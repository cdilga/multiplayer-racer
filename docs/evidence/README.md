# Evidence

Each bead's evidence lives in `docs/evidence/<P1-ID>/` (receipts, captures, self-review). A receipt names what it ran on, honestly.

## Lane labels (plan §13.1)

A result carries the label of the lane that produced it; a lane that didn't run is reported as unavailable with the reason, never
claimed. `web/tests/journeys/harness/lanes.mjs` prints the inventory for the machine it runs on, and
`scripts/beads/batch-verify.sh run --matrix milestone` records each lane's label and machine in
`docs/evidence/P1-F10/matrix-<host>-<tier>.json`.

| Label | What it is | Not |
|---|---|---|
| Chromium (linux or darwin, Playwright) | Playwright's Chromium: host and controllers; SwiftShader WebGL unless `JJ_CHROMIUM_GPU` says otherwise (`1`: eris's RTX 2080 Super over ANGLE/Vulkan, headless) | a real GPU headed browser |
| WebKit (Playwright) | Playwright's WebKit build: controller journeys | Safari |
| Firefox (Playwright) | milestone only | |
| iOS Simulator | Mobile Safari in the simulator on the Mac | an iPhone |
| Android emulator | Chrome in the AVD on eris (KVM) | an Android phone |
| macOS Chrome headed (real GPU) | the perf receipt and judged captures, on the Mac, run by the owner | an unattended lane |
| macOS Safari, Windows, real phones, pads and the TCL | no lane: the owner checks them in Q02 | |

Rules: Playwright WebKit is "WebKit", never "Safari". A simulator or emulator run is never a "device". An auto-lowered render
(R111) is marked as such and doesn't count as native. A number copied from elsewhere is a reference until measured.

## Machines

- **eris** (Linux, i5-12400, RTX 2080 Super, KVM): WebRTC journeys, the Android emulator, GPU-backed headless Chromium.
- **the Mac** (Apple M1 Pro): the iOS Simulator and headed macOS Chrome. Playwright browsers on the Mac can't complete a loopback
  WebRTC connection (the matrix's probe records it), so WebRTC journeys run on eris; keep the Mac light.
