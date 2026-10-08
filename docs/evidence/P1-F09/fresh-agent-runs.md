<!-- evidence
bead: br-p1-f09-8p1
id: P1-F09
covers: AC1 AC2 AC3
observer: BrownCreek (four fresh Sonnet 5.5 agents ran the examples)
date: 2026-10-08
build: game 5dad71c on eris (the skills as committed in faee6fa)
-->
# P1-F09: one fresh-agent run per skill

Each skill's worked example was handed to a fresh agent (a new Sonnet 5.5 session with only the repo, told to read the
SKILL.md and run its worked example exactly as written, change nothing, keep the Mac light, and report the command,
the output and whether it matched the stated result). All four ran on eris through `scripts/remote/eris.sh` at game
commit 5dad71c, first try. What each newcomer found unclear was folded back into the skills afterwards (the notes on
`eris.sh` running the pushed HEAD, `$JJ_RUN_DIR`, making the scratch dir, where the outputs land, and the visual
review's account of live-check's "cut off" lines).

## jammers-game-probe

Command: `scripts/remote/eris.sh --run probe-demo 'cargo run -q --locked -p jj-tools --bin jj -- sim scenarios/straight-throttle.json; echo "exit $?"; cargo run -q --locked -p jj-tools --bin jj -- sim --set max_engine_force=4000 scenarios/straight-throttle.json; echo "exit $?"'`

    pass straight-throttle (720 ticks, state a9180304738c…, replay matches) → target/jj-runs/sim-straight-throttle
        ok  car 0 @   240 forwardSpeed = 10.032 in [5, 20]
        ok  car 0 @   720 forwardSpeed = 23.038 in [15, 35]
        … (seven ok lines)
    exit 0
    FAIL straight-throttle (720 ticks, state f21cec0c22a1…, replay matches) → target/jj-runs/sim-straight-throttle-tuned
      tuned: max_engine_force=4000
        BAD car 0 @   720 forwardSpeed = 13.169 NOT in [15, 35]
    exit 1

Matched the stated result on every item (pass + seven ok + exit 0; FAIL, tuned line, exactly one BAD at 13.169, the
outcome signature, exit 1).

## jammers-visual-review

Command: `scripts/remote/eris.sh --run f09-visual 'node art/ui/lib/live-check.mjs --viewports 412x915,1920x1080 --out $JJ_RUN_DIR/shots / ; echo "exit $?"; ls $JJ_RUN_DIR/shots'`, then `scp` the PNGs and Read them.

    FAIL / 412x915 -> …/f09-visual/shots/index_412x915.png
         cut off by the screen edge: "What it isbeads: tracker"
    FAIL / 1920x1080 -> …/f09-visual/shots/index_1920x1080.png
         cut off by the screen edge: "Buildv0.2-revamp eceaeeb", "What it isbeads: tracker", "P1-G02: JN5 waits for th", "Ran: room, join-webrtc, "
    exit 1
    index_1920x1080.png
    index_412x915.png

The agent looked at both images (the 412 capture is the full 412x2363 page: header, four cards including a not-playable
and a retired preview; the 1920 capture a centred column of three-column cards) and judged every failure line a false
positive, because each quoted string is complete in the image. It wrote a self-review.md with the four sections (both
images under "Looked at", none fixed or remaining, and the uncovered states). Two differences from the skill: the
1920 line listed four strings, and the skill's "fold" wording didn't fit a full-page capture. The skill now says
exactly that (step 3 and the stated result).

## jammers-ui

Command: `scripts/remote/eris.sh --run f09-ui 'node .claude/skills/jammers-ui/ui-tour.mjs https://jammers-preview.dilger.dev/p/v02-eceaeeb8/ $JJ_RUN_DIR/tour'`

    captured …/f09-ui/tour/tv-1920x1080-lobby-empty.png
    captured …/f09-ui/tour/phone-412x915-join.png
    captured …/f09-ui/tour/phone-412x915-joined.png
    captured …/f09-ui/tour/phone-915x412-join.png
    captured …/f09-ui/tour/phone-915x412-joined.png
    captured …/f09-ui/tour/tv-1920x1080-lobby-two.png
    captured …/f09-ui/tour/tv-1920x1080-race.png
    captured …/f09-ui/tour/phone-412x915-race.png
    captured …/f09-ui/tour/phone-915x412-race.png
    ui-tour: PASS

Looked at: the TV race (two tiles, #1 Davo red "1st Lap 1/3", #2 Shazza blue "2nd Lap 1/3", the footer with Pause, the
QR, room code A56J, players, Diagnostics); the portrait phone (#1 DAVO, "Direct · 0 ms", the button row, BOOST, the
"Turn sideways" card over the sticks); the landscape "joined" phone (#2 SHAZZA, the STEP 1 OF 7 tutorial card over the
sticks). Matched every stated item; the tutorial card is now in the stated result.

## jammers-emulators

Command: `scripts/remote/eris.sh --run f09-emu 'node web/tests/journeys/harness/lanes.mjs; JJ_EVIDENCE_DIR=$JJ_RUN_DIR node web/tests/journeys/harness/matrix.mjs --tier milestone; echo "exit $?"'`

    lanes on eris (linux/x64, 12th Gen Intel(R) Core(TM) i5-12400)
      available   chromium             Chromium (linux, Playwright)
      unavailable webkit               … isn't installed for Playwright here …
      unavailable firefox              … isn't installed for Playwright here …
      unavailable ios-simulator        iOS Simulator: iOS Simulator runs on macOS only
      available   android-emulator     Android emulator
      … (macOS Chrome headed, macOS Safari, Windows, real devices: unavailable with reasons)
    loopback WebRTC: connects
    passed       chromium
    passed       android-emulator
    receipt: /home/cdilga/Work/runs/f09-emu/matrix-eris-milestone.json
    exit 0

Matched every stated item. The lane list prints twice (lanes.mjs, then the matrix); the skill now says so.
