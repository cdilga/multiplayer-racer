# Self-review P1-FL14 (br-bbki.13): phone control buttons look finished

Captured by `web/tests/journeys/fl14-buttons-look.test.mjs` (`JJ_CAPTURE_DIR=…`) on the Mac, 2026-10-16: the real
controller through the R90 state opener (`/j/ABCD#state=playing…`, no host), Playwright **Chromium** (`isMobile`, touch)
and Playwright **WebKit** (touch; WebKit, not Safari). Sizes 915x412, 412x915, 667x375, 640x300. Reference: the accepted
phone mock (`art/ui/accepted/2026-10-07/poc/phone`, captured beside the real one by `c02-style-compare`) and the
`frames/phone-controller.webp` style frame (chunky display-face labels, a READY slab).

## Looked at

- `before-race-915x412.jpg`, `before-lobby-915x412.jpg`, `before-lobby-pressed-915x412.jpg`, `before-lobby-412x915.jpg`:
  today's build. Strip tools 44 px tall in landscape (40/34 px wide on narrower phones), small body-face labels, Ready the
  smallest button in the strip, white "Identify" on light-blue seat colour (unreadable), a press barely visible, the
  launch bar *empty* when the launch is ready, portrait tools wrapping raggedly (2 + 4 + 3).
- `after-chromium-915x412-race-idle.jpg`, `after-webkit-915x412-race-idle.jpg`, `after-chromium-412x915-race-idle.jpg`, `after-webkit-412x915-race-idle.jpg`: strip tools 48x48+, labels in the display face, Identify ink
  on seat blue, launch bar full saffron. Nothing over the sticks, the pod or the HUD.
- `after-webkit-915x412-lobby-idle.jpg`, `after-chromium-412x915-lobby-idle.jpg` (and the other engine/size pair): READY saffron slab first and loudest, Identify, Change car (car icon + words), six icon tools.
  Portrait: worded buttons on one row, the six icon tools on the next.
- `after-webkit-915x412-race-pressed-identify.jpg`, `after-chromium-412x915-race-pressed-identify.jpg` (and the other engine/size pair), `after-webkit-915x412-lobby-pressed-identify.jpg`, `after-chromium-412x915-lobby-pressed-identify.jpg` (and the other engine/size pair), `after-webkit-915x412-lobby-pressed-ready.jpg`, `after-chromium-412x915-lobby-pressed-ready.jpg` (and the other engine/size pair): a held finger darkens the
  slab and pushes it 3 px down; readable while pressed. (Identify fires the Cooee flash after release, so it's captured
  last.)
- `after-webkit-915x412-lobby-disabled-ready.jpg`, `after-chromium-412x915-lobby-disabled-ready.jpg` (and the other engine/size pair): a disabled Ready is a grey ink slab with dim paper text, clearly different from a pressed
  (dark saffron) Ready.
- `after-webkit-915x412-ready-on.jpg`, `after-chromium-412x915-ready-on.jpg` (and the other engine/size pair): READY ✓ in green.
- `after-webkit-915x412-cooling.jpg`, `after-chromium-412x915-cooling.jpg` (and the other engine/size pair): launch bar ~40 % paper refilling, label dimmed, the paper cooldown ring on the drive knob.
- `after-webkit-667x375-race-idle.jpg`, `after-webkit-667x375-lobby-idle.jpg`, `after-webkit-640x300-race-idle.jpg`, `after-webkit-640x300-lobby-idle.jpg`: small landscape phones: every tool 48x48 and on screen, no
  sideways scroll; at <= 800 px wide the car button goes icon-only (spoken name kept) and the Identify icon drops.

## Defects found and fixed

1. Hit targets under 48 px: `layout-short.css` (44/40), `settings.css` (44), `fullscreen.css` (34 px icons, 44 px
   full-screen prompt) → all 48.
2. Identify label unreadable: the play screen set `--seat` but never `--seat-on` → set from the seat table; the journey
   asserts >= 4.5:1 contrast.
3. Weak labels and a tiny Ready → display face, uppercase italic; Ready min-width 104 (88/64 on short phones), 20 px.
4. No visible press on iOS-shaped browsers (`:active` needs a touch listener there) → `pointerdown` adds `.pressed`;
   pressed = darker + 3 px down.
5. Disabled Ready didn't look off; first fix (grayscale filter) still painted brown in WebKit's masked slab → disabled
   sets the slab fill to ink-soft instead.
6. Launch bar read backwards (empty = ready) → bar is readiness (full when ready, refills while cooling); a `cool=` state
   opener param draws the cooling state.
7. At 640x300 Leave was pushed off the edge and labels jammed against the brush edge → narrow strip: car icon-only,
   seat badge column 84 px.
8. Portrait ragged wrap → worded row + icon row.

## Remaining defects

None seen at these sizes. The icon tools stay line icons in slabs, as in the accepted mock.

## Not covered

- Real phones (owner's Android/iPhone): emulation only. The owner's couch test covers the hands-on feel.
- Live room: the captures use the state opener; the disabled Ready is set on the element (the real rule in
  `view.ts updateHud` sets it before a car is confirmed); the pod's cooling uses the `cool=` fixture value.
- The R130 Buttons layout itself (P1-FL13) doesn't exist yet; its buttons inherit these styles and get their own capture.
