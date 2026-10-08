---
name: jammers-visual-review
description: The visual self-review loop for Joystick Jammers 0.2 - capture a page or game state at the owner's real device sizes with art/ui/lib/live-check.mjs, look at every screenshot, compare it with the named reference (art/ui/accepted/<date>/, world-look frames, biome refs), fix, repeat, and write docs/evidence/<P1-ID>/self-review.md in the committed format close.sh checks. Use before handing off or closing any bead labelled visual (UI, screens, HUD, lobby, results, controller layouts, renderer output, vehicles, tracks, captions), when a page "looks off", or when someone asks for screenshots or a self-review.
---

# Jammers visual review (owner 2026-10-04: look at your own work before anyone else does)

The process is `docs/process/visual-self-review.md`; this skill is the working recipe. `scripts/beads/close.sh` refuses a
`visual` bead without a committed `self-review.md` that has the four sections and names screenshots that exist.

**Distilled from** steps repeated in two closed beads: **P1-U03** (phone mocks at real phone sizes: capture, look,
fix, self-review) and **P1-R07** (host HUD, lobby and results: the same loop on the host pages at TV, laptop and phone).

## The loop

1. **Capture the matrix where browsers run** (eris, not the Mac): `node art/ui/lib/live-check.mjs --help` for the
   flags. It opens each path at each viewport, fails on 4xx/5xx, undecoded images, script errors, horizontal overflow,
   text cut off by the screen edge and blank canvases, and saves a PNG per page and viewport. Default base is the live
   preview host; `--base <url>` for a preview, `--local` for `art/ui` from the checkout, `--tv` for every TV mock state,
   `--fullscreen` to re-check after a resize. Game states (lobby, race, results) come from the real pages: see the
   `jammers-ui` skill's tour.
2. **Look at every image** (Read the PNGs). Compare with the reference the bead cites (`art/ui/accepted/2026-10-07/`,
   the world-look frames, the biome refs).
3. **Judge each failure line.** `live-check` is strict on purpose: "cut off by the screen edge" means an element crosses
   the edge of the *first screen* (the viewport). The saved PNG is the whole page, so on a page that scrolls, open the
   image: if the quoted text is complete there, it was only crossing the fold, not a defect (the quotes run a label and
   its value together, e.g. "What it isbeads: …" is the "What it is" label plus its value). On a page that hides its
   overflow (the TV screens) the same line is a real cut.
4. **Fix and repeat** until a full pass shows nothing you'd be embarrassed to show the owner.
5. **Write `docs/evidence/<P1-ID>/self-review.md`** with `## Looked at`, `## Defects found and fixed`,
   `## Remaining defects`, `## Not covered`, naming every image file, and commit it with the images (small jpg/webp).

## Worked example (eris, about a minute): the live preview index at phone and TV sizes

```bash
scripts/remote/eris.sh --run visual-demo 'node art/ui/lib/live-check.mjs --viewports 412x915,1920x1080 --out $JJ_RUN_DIR/shots / ; echo "exit $?"; ls $JJ_RUN_DIR/shots'
scp 'eris:Work/runs/visual-demo/shots/*.png' <a scratch dir>/    # then Read each PNG
```

Stated result (2026-10-08): two full-page screenshots, `index_412x915.png` and `index_1920x1080.png`; `live-check`
reports `FAIL … cut off by the screen edge: "What it isbeads: tracker"` (412x915; at 1920x1080 also "Buildv0.2-revamp
eceaeeb", a "What changed" commit title and "Ran: room, join-webrtc, …") and exits 1. Opening the images shows every
quoted string complete, so these are fold crossings, not defects (step 3). The cards themselves change as previews
publish (playable, not playable with its reason, retired): that's data, not layout. The resulting `self-review.md` lists
both images under "Looked at", "none" under fixed and remaining defects, and under "Not covered" what this example
didn't capture (an empty register, a pinned row, expanded "What changed", WebKit).

Notes for the run: `eris.sh` syncs eris's clean clone to your **pushed** HEAD (uncommitted Mac changes never reach it;
it may print `RU_SYNC=skipped (runs in progress …)` when another run holds the clone, which is fine). Keep the command in
single quotes so `$JJ_RUN_DIR` (`~/Work/runs/<id>` on eris) expands there. Make the scratch dir before `scp`ing into it.

## Traps

`docs/learnings/ui.md` (fonts that only load from the edge path, full-screen-only layouts, WebKit differences) and
`docs/learnings/render.md` for canvases that read back empty (WebGL without preserveDrawingBuffer: judge the pixels in
the screenshot, not the read-back).
