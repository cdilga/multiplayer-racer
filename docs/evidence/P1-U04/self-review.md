# Self-review P1-U04

The gate bead's own surface is the published gallery the owner accepted
(`https://jammers-preview.dilger.dev/poc/`). The mocks inside it were each self-reviewed by their own beads (U01–U03,
U05, and the round 3–5 `gate:g-design` beads); this pass checks the gallery as published, on 2026-10-07, from eris
(Playwright Chromium, not a real device): 13 linked pages x 4 viewports (412x915, 915x412, 1366x768, 1920x1080), each
before and after a resize. Log: `live-check.log`. The images below are full-page captures, downscaled and cropped to the
top 2200 px for the commit.

## Looked at

- `gallery-poc-1920x1080.jpg`: index at 1920x1080: every section, its one proposal and why, every state button present; the engine "Play the engine" button rendered (its probe passed).
- `gallery-poc-412x915.jpg`: index on a phone: buttons wrap, nothing clipped sideways, text readable.
- `gallery-poc-tv-1920x1080.jpg`: TV mocks contents page: every state link group (grid, HUD, lobby, results, footer, pause, captions) present.
- `gallery-poc-phone-412x915.jpg`: phone controller mock in portrait: header, Identify/camera/recover/menu row, boost bar, cone/front items, DRIVE and ACTION sticks, Mock button; nothing off the edge.
- `gallery-poc-world-1920x1080.jpg`: in-world look at 24 tiles: 24 live tiles, per-tile HUD in the corners, colours per seat, no blank or flat canvas.
- `gallery-poc-audio-engine-1366x768.jpg`: engine synth on a laptop: Drive it, Dash, Layers, Profile, Sound lab and Spectrum panels all render; the flagged "cut off" text is inside the sound lab's scroll box and at the fold.
- `gallery-poc-audio-voice-412x915.jpg`: voice audition on a phone: intro, caveat panel, section links, current lines list.
- `gallery-sheets-brand-html-412x915.jpg`: brand sheet on a phone: renders completely but is a fixed-width desk sheet, 1189 px wider than the viewport.
- `gallery-sheets-components-html-1920x1080.jpg`: component sheet at 1920x1080: design language, buttons in every state, panels, badges, toasts, confirmation, progress; all present.

The other 43 page/viewport captures (guide, motion, motion side, TV/phone/world at the other sizes, cvd and fonts
sheets) were looked at in the run directory and show the same content; they are not committed to keep the evidence small.

## Defects found and fixed

- None fixed in this bead: the accepted set is frozen (`art/ui/accepted/2026-10-07/` never changes), and the gallery
  defects below don't block a verdict the owner already gave.

## Remaining defects

- The design sheets (`/sheets/brand.html`, `fonts.html`, `cvd.html`) are fixed-width desk sheets: on a phone the page
  is 1189/573/569 px wider than 412 px (686/70/65 px at 915x412), so a reviewer pans sideways. Filed as **br-q7r4**.
- `live-check.mjs` flags "cut off by the screen edge" on long scrolling documents (index, guide, components) for
  elements that straddle the first viewport's fold; in the captures nothing is cut off. Noted on br-q7r4 for the
  checker owner to confirm.

## Not covered

- Real devices: no capture on the owner's TCL TV or phone (the owner's own review covered those, per the round record).
- WebGPU look pages on a real GPU: eris Chromium rendered the 24-tile world capture, but frame rate isn't judged here.
- Audio: playback isn't something a screenshot checks; the owner's verdict covers it.
