# Owner-flow CI repair, 2026-10-12

Local Mac, Node 26.10.0, Playwright Chromium with SwiftShader, real jj-server. Emulated touch viewports, one host and one phone through the real Join and vehicle-confirmation path. This is behavioural and layout evidence, not physical-device or latency qualification.

`node --test --test-name-pattern='short landscape|footer QR pauses' web/tests/journeys/c07-landscape-short.test.mjs web/tests/journeys/r07b-join-card.test.mjs` passes both selected journeys. The QR journey exercises the real pointer action; the menu click now waits on menu state instead of Playwright's unrelated navigation barrier. The loaded JN5 journey exercises keyboard activation of the same footer button (previous focused run with fourfold CPU throttling passed).

## Looked at

All five final `c07-short-landscape-{640x300,740x360,800x300,844x340,844x390}.jpg` frames were inspected individually. Ready, Identify, Vehicle and utility tools fit on one line, Marlene's name is readable, sticks fit their zones, and the launch bar retains its track.

## Defects found and fixed

Linux CI reported five pixels of horizontal toolbar scrolling. Compact button gaps reserve more space. Initial capture still showed the Locate icon clipping Identify's final letter; the redundant icon gives way at compact widths, preserving the full Identify label and existing touch target sizes.

## Remaining defects

No compact-layout defect seen in these final local frames. Containing Linux CI and deployed owner-flow qualification remain pending.

## Not covered

Real phones, TV, deployed pages, WebKit compact captures, fullscreen and resize qualification are covered by the broader owner-flow work and remain required before closure. Host-side signalling diagnostics were added to owner and R13 journeys; no transport repair is claimed by this receipt.
