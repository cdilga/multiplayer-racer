# Visual self-review: look at your own work before anyone else does

> **2026-10-04 (owner):** several design rounds reached the owner with blank panels, overlapping tiles, broken images and
> pages that only worked after a full-screen toggle, so most of a page could not be reviewed. Every bead whose outcome is
> something you can *see* now includes a self-review loop. Passing tests is necessary; **looking at the result is the
> check that was missing.** The owner reviews taste, not breakage.

## Which beads

Every bead with the `visual` label: UI, screens, HUD, lobby, results, controller layouts, renderer output, vehicles,
tracks and items as they look, captions, design sheets, anything with a screenshot in its acceptance. If you're unsure,
it's visual. Visual beads carry an acceptance box "Visual self-review done and committed"; `scripts/beads/close.sh`
refuses to close a `visual` bead without the evidence below.

## The loop

1. **Build and deploy** the thing the owner will open (the preview URL, not only your local copy: deploys miss files).
2. **Capture a matrix**, not one screenshot:
   - the owner's real devices: phone portrait 412x915 and landscape 915x412, a small phone 375x667, TV 1920x1080,
     a laptop 1366x768; and at least one WebKit run for anything touch/iOS-shaped;
   - every state the bead names (empty, one, many, 32, a no-cap sample; loading, error, disabled, focus);
   - **before and after a full-screen toggle and a resize** (layouts that only fix themselves on full screen are bugs).
   `node art/ui/lib/live-check.mjs --viewports 412x915,915x412,1920x1080 --fullscreen <paths>` does the capture and
   catches 4xx, undecoded images, script errors, horizontal overflow and blank/flat canvases (`--local` for your
   checkout). Renderer and gameplay beads add their own captures (`jj` capture, Playwright journeys).
3. **Look at every image** with the Read tool on the PNGs. Not the JSON. Ask of each: is anything blank, clipped,
   overlapping, off the edge, unreadable, misaligned with the style frames and component sheet, wasting space, or
   something that looks tappable but isn't? Compare with the reference the bead cites.
4. **Fix and repeat** from step 1 until a full pass finds nothing you wouldn't be embarrassed to show.
5. **Write `docs/evidence/<P1-ID>/self-review.md`** and commit it with the screenshots you judged (webp/jpg, small):

   ```
   # Self-review <P1-ID>
   ## Looked at        (one line per image: file, viewport, state, what you checked)
   ## Defects found and fixed   (what you saw on each loop, what you changed)
   ## Remaining defects          (honest list; "none" only if true; each one a bead)
   ## Not covered      (devices or states you couldn't capture, and why)
   ```
6. Close. The owner's review is for taste and direction.

## Rules

- A check that passes on a page you didn't look at proves nothing. If a surface is GPU-only and the automated check
  can't see it, say so under "Not covered" and look harder.
- Label honestly: Playwright Chromium/WebKit emulation is not the owner's phone. Say what you used.
- Never fix a visual defect by hiding content or capping counts (no player, tile or car caps; R-rulings).
- Found a defect in someone else's area? File a bead; don't leave it for the owner to find.
