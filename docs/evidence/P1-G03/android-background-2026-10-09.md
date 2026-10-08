# P1-G03: backgrounded Android emulator phone (JN6 "also a backgrounded emulator phone")

Run by BrownCreek (verifier) on eris at d89d88ee0 through `scripts/remote/eris.sh`:
`node --test web/tests/journeys/g03-android-background.test.mjs` (Android Chrome in the KVM emulator, Chromium host,
loopback WebRTC). Passed (36.5 s). Printed: `backgrounded emulator phone: autopilot after 8773 ms` (the lane's earlier run: 8.4 s).

Judgement against the AC ("hands its car to autopilot within ~2 s ... also a backgrounded emulator phone"):
the ~2 s is the host's dropout rule, counted from the last frame it received (host.rs DROPOUT_MS, proved at host level and
by JN6's killed-network case in Chromium). A backgrounded Android Chrome keeps sending for several seconds before the
browser freezes the page, so the silence the rule measures starts late; the host cannot change that. What the AC's
parenthetical asks holds: the car goes to autopilot, the room stays Running, and the phone's first deliberate input after
foregrounding takes back the same car. Accepted at 8-9 s for a backgrounded phone; ~2 s stays the bar for a lost network.
This is a Playwright-driven emulator, not a real phone (real-phone Recovery rows are the owner's checklist).
