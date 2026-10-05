# Self-review br-dim.8: one caption style everywhere

The owner's pick (round 3): the intermission subtitle, the saffron brush strip on the replay. It is now the one caption
component, `.capt` (CSS in `art/ui/sheets/brush-button.js`, shared by the sheet, the TV mocks and the controller),
defined in `tokens.language.banner.caption` and GUIDE §5b. Variants: fill (saffron default, ink quiet, teal positive),
`flat` (no tilt, in a band), `one` (one line), size per profile via `--capt-size` (TV 30 px, 44 px over a replay or in a
cell; desk 20; handheld 18). Placements: in-video (replay annotation), a spare grid cell, the footer band, and on a
narrow footer its own row on top of the band.

Playwright Chromium with mobile emulation at the owner's bars-showing sizes (412 x 706, 806 x 325, DPR 2.625) and
1920 x 1080; not a device.

## Looked at

- `sheet-capt.jpg` (1600 x 900): the sheet's caption row: saffron, ink, teal, flat one-line in an ink band, two-line clamp.
- `captions_n_8-1920x1080.jpg`: announcer line centred in a spare cell at the cell size (44 px TV).
- `captions_n_8_layout_static-1920x1080.jpg`: static layout: flat, one line, in the middle of the footer band.
- `captions_n_13-806x325.jpg`: the caption wraps to two lines in a narrow spare cell.
- `captions_n_8-412x706.jpg`, `captions_n_8_layout_static-412x706.jpg`, `captions_n_13-412x706.jpg`: a phone as the host:
  the caption gets its own row on top of the footer and the grid ends above it.
- `results_n_8-1920x1080.jpg`, `results_n_8-806x325.jpg`: the replay annotation (the reference) as the same component.
- `lobby_n_8-806x325.jpg`: "Late joiners welcome" in the lobby footer.

## Defects found and fixed

1. The cell caption first rendered at the footer size (30 px), small in a whole cell: cells use the replay size (44 px).
2. On a portrait phone host the footer's middle is too narrow, and the flat caption collapsed to a small saffron square:
   a narrow footer (under 760 px) now gives the caption its own row on top of the band, and the grid re-lays out once
   when the footer's height changes after the caption is placed (`relayout.again`).
3. The old `.footcap`/`.cellcap` rules painted a saffron box and border under the strip: neutralised.
4. The sheet painted shapes before the brush CSS was injected, so a caption would be measured unstyled: the skins and
   caption CSS now install before the paint passes.
5. The tokens and guide first said a long caption "shrinks"; it is clamped at two lines with an ellipsis, and they now
   say so (caption copy stays short).

Checks: `node art/ui/check.mjs` ok, including the new pairs caption-on-saffron 9.06:1, caption-on-ink 14.81:1,
caption-on-teal 7.24:1; `node art/ui/poc/tv/grid-check.mjs` ok; `node art/ui/poc/tv/qr-space-check.mjs` ok;
`node art/ui/lib/live-check.mjs --local --tv --viewports 412x706,806x325,1920x1080`: 162/162 ok.

## Remaining defects

- The 0.2 code (`web/`) has no captions yet; the screens that show them are the restyle beads gated on the POC verdict,
  which adopt `.capt` from the accepted set. Nothing in `web/` was changed for this bead.
- The controller shows no captions (announcer lines are TV-only), so there is no handheld placement in use; the
  handheld size is defined for when one appears.

## Not covered

The owner's phone and the TCL (emulation only).
