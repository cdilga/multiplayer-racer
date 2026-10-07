# P1-F08 self-review (visual)

I looked at every capture in this folder. Labels: "Android emulator" (Chrome 145, API 37, on eris, landscape 2400x1080) and
"iOS Simulator" (iPhone 17, iOS 27.0, Mobile Safari 27.0, on the Mac). The Android captures are from the `eris.sh` run at commit
`20bf5a48c1cf` (`drive-android-eris-run.txt`).

| Capture | What is in it |
|---|---|
| `drive-android-playing.png` | Just after joining and skipping the tutorial, fullscreen (no browser chrome). Strip: "#1", the name truncated to "MA...", "Direct · 1 ms" (link readout). Tools row wraps onto two lines: Ready, Identify, Camera, Recover, Help, Settings, then Leave alone on a second line. DRIVE and ACTION zones with idle knobs, each fully inside its dashed border, labels clear of the knobs. The yellow "Tap Ready when you are" banner sits between the zones and clears everything. The boost meter is not shown. Clean. |
| `drive-android-c02.png` | The same screen after the two-finger hold ("Direct · 2 ms"). The fingers are lifted before the shot, so both knobs are back at rest: it shows no deflected stick. The deflection evidence is the page's own readout in the JSON (steer 0.50, throttle 0.64, a pointer in each zone). No dialog, no tutorial card, no overlap. |
| `drive-android-g03-returned.png` | Right after returning from the 7 s background. Chrome's toolbar is back (fullscreen was dropped), so the page is shorter (the URL reads `localhost:7463/j/5RQX`, the secure-context origin). **Layout problems visible here:** the "Tap Ready when you are" banner covers the Leave button, of which only a sliver shows above the banner; each stick base is taller than its zone, so the base circle runs over the DRIVE / ACTION label and out through the top and bottom of the dashed border; the strip, the tools and the zones are pushed tight against each other. The boost meter shows a solid yellow bar with no track, unlike the empty meter earlier. |
| `drive-android-g03-end.png` | After the handback hold, the same short-viewport state, identical to the previous capture (Leave covered by the banner, stick bases overlapping the zone borders and labels, solid boost bar). The captured frame looks the same as before the hold, because the finger is lifted again. |
| `drive-ios-local-sticks.png` | iOS Simulator, upright: two empty dashed zones on the navy page and Safari's compact toolbar ("localhost"). It is the **fixture**, not the controller, and shows nothing about the controller on iOS. |

## Findings for the controller bead (not fixed here, `web/controller/src` is out of scope)

1. With browser chrome showing (any phone Chrome/Safari that has left fullscreen), the landscape layout is too short: the
   banner hides Leave and the stick bases overflow their zones. Seen in `drive-android-g03-returned.png` and
   `drive-android-g03-end.png`. The viewport there is about 2400x~790 physical px (browser chrome showing); a real phone that
   leaves fullscreen after a background will look like this.
2. The first-run tutorial and Chrome's "Viewing full screen" dialog both sit over the sticks; the lane dismisses them (Skip tap,
   `uiautomator` on "Got it"). A player has to do the same.

Not captured, so not claimed: the iOS controller (blocked on connectivity, see `docs/learnings/emulators.md`), a frame with a
stick held down, and the host's TV view.
