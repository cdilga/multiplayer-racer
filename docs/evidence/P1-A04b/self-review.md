# Self-review P1-A04b

The vehicle sound lab on the engine page, checked on the deployed preview
(`https://jammers-preview.dilger.dev/poc/audio/engine/`, deploy of cdbdeaf) and locally. Tools: `node
art/ui/lib/live-check.mjs --viewports 412x915,915x412,375x667,1366x768,1920x1080 --fullscreen /poc/audio/engine/`
against the preview (all ok: no 4xx, no script errors, no horizontal overflow, no blank canvas), a Playwright drive of
the live page at 412x915 and 1920x1080, and `check.mjs` (SL1-SL9). Playwright Chromium, not the owner's phone or TV.
The P1-A04c self-review (`docs/evidence/P1-A04c/self-review.md`) covers the same page's transport, dash and layers.

## Looked at
- `live-phone-lab-hay-in-b.jpg`, 412x915 live: the Hay Hauler picked in slot B, "level-matched" shown, Profile rows
  stacked (name, value, reset; control; note), nothing cut off.
- `live-tv-lab-hay-in-b.jpg`, 1920x1080 live: the same in the desktop column; Engine section sliders with number boxes
  and units.
- `live-phone-lab-boost-not-fitted.jpg`, 412x915 live: the Cruz's Boost section "Not fitted", rows say "not fitted"
  with no controls.
- `live-tv-running.jpg`, 1920x1080 live: the page with the engine running.
- Local `docs/evidence/P1-A04/lab.png` (1280) and `docs/evidence/P1-A04/lab-phone.png` (390): the full lab with every section.
- `docs/evidence/P1-A04c/lab-boost-not-fitted.png` / `docs/evidence/P1-A04c/lab-boost-fitted.png`: fitting a turbo marks the
  section modified.

## Defects found and fixed
- The inherited check did not run (a syntax error) and two lab checks were wrong (SL3 hashed multi-layer renders, which
  are not bit-stable; SL7 called `document` from Node). Fixed; SL1-SL9 pass.
- On a 412 phone the lab rows overflowed: the value column, reset buttons and section border were cut off and the
  sliders squashed. Rows stack below 640 px; Profile rows got side padding.
- A profile without an optional section (the Cruz has no `boost`) crashed the lab's reads. Sections a car may leave out
  get a Fitted / Not fitted toggle; absent rows hide their controls rather than show another car's numbers.
- A/B between two different cars was only level-matched down to -12 dB; the Hay Hauler stub is 14.7 dB louder than the
  Cruz, so B was left too loud. The match now reaches -24 dB and SL9 asserts the applied gain is the measured ratio.

## Remaining defects
- None seen. Naming: the manifest is `assets/audio/engine/manifest.json` (the bead's contract called it
  `profiles.json`); same role, one file per car plus one line.
- Taste: the Hay Hauler is a demo profile for the lab, much louder than the Cruz; level matching covers A/B.

## Not covered
- The owner's real phone and TV (emulation only), and listening: the owner listens on the live page.
- File import through the picker on a real phone (SL4 imports through the page's API, not the OS file dialog).
