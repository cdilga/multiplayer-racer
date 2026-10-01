# Planning and gallery validation

29 September 2026, after the r10 UX edits.

- Parsed 116 unique plan cut rows: 56 Minimum, 54 Full, one Stretch, two Optional tooling, one
  Removed, one Shelved, one Post-promotion.
- Expanded V2-121 to all other Minimum cuts and V2-99 to all other Minimum/Full cuts. DFS found
  zero cycles, zero unknown dependencies and no non-Minimum prerequisite for a Minimum cut.
- Every cut reference in flows.md resolves to an existing plan cut. This checks identifiers, not
  executable bead creation; the child-task expansion must still be validated at conversion.
- All 15 PNG entries in image provenance exist, have PNG signatures and positive image dimensions.
  Study Markdown links resolve. No production dependencies or CDN references were introduced.
- Browser-harness opened the local gallery in Chrome. Desktop viewport 1792×870 and emulated
  mobile viewport 390×844 both showed no document-level horizontal overflow. The example navigation
  is intentionally horizontally scrollable.
- Clicked H5 through its accessible button, checked revised image path; clicked Initial concept
  and checked the v1 path/pressed state; opened Pair another display and verified its dialog title;
  Escape closed the dialog. M2 and H4 loaded their actual PNGs (natural widths 941 and 1672).
- Inspected [mobile gallery capture](gallery-mobile.png) and
  [desktop gallery capture](gallery-desktop.png). These verify the gallery, not production-game
  layout or real-phone behavior. Image button hit targets remain illustrative.
- Compared canonical plan changes against the start-of-study snapshot; only intended UX contracts,
  relevant task acceptance/decomposition and the review record changed. Existing unrelated workspace
  changes were preserved. Study files, plan and companion brief are the only repository paths
  authored by this pass. No beads, game source, builds, commits or deployments were changed.
- The browser tab was opened locally and opening the gallery in the Codex side panel was requested;
  the app returned queued. No local web server or background task was created.

Synthetic inference results are in round-1.md and round-2.md. Later text wireframes have not received
a fresh blind review. Human newcomer completion, touch/TV readability, production identity consistency
and real failure behavior remain implementation qualification, with no invented pass.

