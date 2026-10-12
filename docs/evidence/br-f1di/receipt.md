# Owner feedback implementation — br-f1di / br-799j / br-bwju.7

2026-10-12, CyanBridge. Apple Silicon Mac; real jj-server and browser host; Playwright Chromium native GL and WebKit. One phone touchscreen, one host key cluster and one emulated standard pad. Browser viewports are not physical phone/TV/pad qualification.

`journey.txt`: Chromium 73.32 s / WebKit 15.37 s, 2/2 pass. Actual joins show remembered selections and require confirmation before Ready; pad Start joins, confirms, then readies. All four Host settings sections, catch-up default Light and Off/Light switching, mute, diagnostics, real manual-pause bit and Resume checked. Recover from a flipped, damaged car retains its vehicle and detached front; an out-of-bounds wreck restores every part and retains dynamic husk/debris after another 240 ticks.

Five host viewports: 375x667, 412x915, 915x412, 1366x768, 1920x1080. Phone rotates during choice; the host enters/exits actual fullscreen at TV size. Short source lists and menu panels scroll without count limits.

`fixture-host.txt`: affected Rust fixture/host suites through RCH; `ready-fixture.txt`: reliable Ready requires a confirmed existing source and toggles that source only. `ready-regressions.txt`: phone choice and host controls regressions. `clippy.txt`: affected crates/all targets/warnings denied. `typecheck.txt`: web TypeScript.

Deployed journey/live-check and clean containing CI are pending. The JN3 run on this Mac under concurrent rendering missed freshness/latency bounds; it is not claimed green. Repeat on the GPU lane before close. Owner couch check stays open on br-799j.
