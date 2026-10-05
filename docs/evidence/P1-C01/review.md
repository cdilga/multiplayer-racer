# Fresh-eyes review P1-C01 against U01's guide

Reviewed `phone-390x844.jpg`, `tv-1920x1080.jpg`, `laptop-1366x768.jpg` and the state captures against `art/ui/GUIDE.md`,
`art/ui/sheets/components.html` and the R102 language block in `art/ui/tokens.json`.

**Matches the guide**
- Palette and type come from the generated token CSS only: ink, paper cream, saffron primary actions, cobalt keyboard focus, Barlow Condensed italic for the actions and code, Barlow Semi Condensed for copy. Fonts are bundled from `art/ui/fonts`; no off-origin request in any test run.
- Primary buttons are saffron with ink label (9.06:1), thick ink outline and a hard unblurred sticker shadow, as on the component sheet. Error text is danger on danger-tint (5.33:1, a named pair). `node art/ui/check.mjs` passes.
- R102 hand-made language is present: skewed and tilted saffron tags ("On the big screen", "On your phone"), big cut-out car, world colours only in the background, compact density.
- The wordmark is the supplied `brand/wordmark.svg`, the car is the committed still, icons are the vendored Lucide set. No hero 3D, no Three.js.
- Profiles: handheld on phones, desk on laptops and tablets, TV scaled by output height; the TV capture has 64 px action type and 96 px touch targets.

**Differences from the guide (listed, not hidden)**
- Panels have no wobbled outline, and the torn ink heading banner is not used on this page (helper built, unused). The page reads cleaner and more "web" than the sheet's panels.
- The ink slip behind the single key action (guide: at most one per screen) is not used; Host and Join are both saffron buttons, so neither is singled out.
- Gamepad focus has the ring and lift but not the chevron tab.
- Copy uses "room" throughout (R112), which differs from the bead's older "game" wording and from some guide copy.

**Verdict:** consistent with U01's draft for colour, type, buttons, focus and contrast; less hand-made than the sheet because wobble and torn banners are not applied yet. Fine for the first preview; the owner's G-DESIGN verdict decides how far to push it.
