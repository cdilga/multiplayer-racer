# P1-F08 self-review (visual)

I looked at every capture in this folder. Labels: "Android emulator" (Chrome 145, API 37, on eris) and "iOS Simulator"
(iPhone 17, iOS 27.0, Mobile Safari 27.0, on the Mac).

| Capture | What I saw | Verdict |
|---|---|---|
| `drive-android-c02.png` | Controller in landscape after the two-finger hold: seat strip "#1 PEARL", six tool buttons, DRIVE and ACTION zones with their idle knobs, boost meter and the "Tap Ready when you are" banner. Fullscreen, no browser chrome, no system dialog, no tutorial card, nothing overlapping. | Layout fine. The fingers are already lifted, so it shows no deflected stick; the stick values come from the page's own readout in the JSON, not from this image. |
| `drive-android-g03-returned.png` | Same controller right after returning from the 7 s background: Chrome's toolbar is back (fullscreen was dropped by the background), landscape kept, URL `localhost:7602/j/66E5` (secure-context origin), controls intact and not clipped. | Fine. This is the state the handback touches ran in; before the rotation fix it came back in portrait with the "Turn sideways" card. |
| `drive-ios-local-sticks.png` | iOS Simulator, upright: two dashed zones on the navy page and Safari's compact toolbar at the bottom ("localhost"). Nothing else on the page. | It is the **fixture**, not the controller, and it is empty by design; the fingers are lifted. Says nothing about the controller's look on iOS. |

Not captured, and so not claimed: the iOS controller (blocked on connectivity, see `docs/learnings/emulators.md`), a frame with the
sticks held down, and the host's TV view.

Problems found by looking and fixed in the lane: the Chrome "Viewing full screen" dialog and the tutorial card covering the
sticks (dismissed by `settle()` and a real tap on Skip); the portrait return after HOME (rotation re-applied); both iOS
fingers landing in one zone (wrong interface orientation passed to the synthesizer).
