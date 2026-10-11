# br-dx0e verification

Reproduced the original issue on macOS arm64 Playwright Chromium SwiftShader: start at laptop size, grow to 1920×1080, shrink to 412×915 with four emulated pads and keyboard options open. Before-phone.jpg and before-laptop.jpg show the original strip. A fresh portrait-only open did not reproduce it; resizing is part of the trigger.

The WebGL framebuffer at a strip pixel contains road RGBA [172,82,45,255], while the composited screenshot contains the page ink [21,32,58]. Hiding the aside restores the world; removing shadows, paint containment, isolation, a transform, clip-path or square borders does not. Changing the opaque aside's overflow from auto to hidden restores the world but loses scrolling. This isolates the defect to composition of the opaque scroll container over the canvas, rather than missing world geometry. We have not audited Chromium's internal compositor code.

The fix separates the opaque frame (flex column, overflow hidden) from a transparent inner scroller (min-height 0, overflow auto). Padding moves inside the scroller. The frame retains its original bounds, border and ordinary 3 px shadow; every input row, join QR and keyboard card remains in the scroll content. Existing drawer event delegation and source behavior are reused.

The regression compares actual screenshots with the frame visible and visibility:hidden (same layout), sampling a 24 px strip beginning 8 px below the frame. More than 1% of pixels differing by over four colour levels fails. The original pair changes 5,088/9,120 pixels; fixed software Chromium changes 0/123,792 across 12 checks, WebKit 0/101,520 across 10, native Metal Chromium 0/123,792 across 12. All include resize and top/bottom scroll states; Chromium additionally enters/exits actual fullscreen. Each viewport asserts the final keyboard card is reachable by scrolling. This is meaningful because DOM hit testing reported canvas even in the broken strip.

Commands/results:
- node --test --test-name-pattern='scroll drawer paint' web/tests/journeys/c12-many-controllers.test.mjs: Chromium and WebKit, 2 passed, 0 failed.
- JJ_CHROMIUM_GPU=native same test with Chromium pattern: 1 passed, 0 failed.
- Existing full-slot guidance / WebKit host drawer journeys: 2 passed, 0 failed; normal joins and independent numpad claim remain correct.
- npm --prefix web run typecheck: passed.
- art/ui/lib/live-check.mjs at five viewports with resize on local real server: all 5 rows passed, all 10 frames inspected.

Build: fresh web pages from this working tree based on 5191bdde; real local Rust server /tmp/jj-macos-server-w01, Mac Apple M1 Pro. Chromium 151.0.7922.34; bundled Playwright WebKit, not device Safari. Emulated pads, no physical controller or phone claim. JSON files preserve every pixel check; self-review.md names all inspected frames. Deployed preview check will be added before closing.
