# br-gw74.3: a paused host is paused

Run: `scripts/remote/eris.sh --run pt1pause 'cd web && JJ_CAPTURE_DIR=$JJ_RUN_DIR node --test tests/journeys/pt1-pause-idle.test.mjs'`
on eris (Linux, headless Playwright Chromium 151, software GL; commit 60948263), 1280x720, two synthetic racers on autopilot.

| | Racing | Paused (5 s) | Resumed |
|---|---|---|---|
| Frames drawn per second | 8 | 0 | 9.5 |
| Sim ticks | advancing | 0 | advancing |
| Host page main-thread busy (s per s, CDP TaskDuration) | 1.03 | 0.008 | |

Frame rates are low because eris renders in software in headless Chromium; the ratio is the point. The worker's own CPU is
not in TaskDuration: its loop slows from 2 ms to 25 ms while paused with no resume countdown, and it steps nothing.
Not measured on the owner's laptop or a GPU; the couch test will show it there.
