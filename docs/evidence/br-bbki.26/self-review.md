# br-bbki.26 self-review: a corner-entry slide on the TV (AC4)

Captured 2026-11-14 by BrightPelican on eris (headless Chromium, ANGLE on Vulkan, RTX 2080 Super; labelled: not a
device or the owner's TV), build `1a1359d4` (the shipped default profiles; the handling change is e286a915 and its
CI fix-forwards 688b78fd and 82e81545). Host `host?drive&test=live&tiles=1` at 1920x1080, one fake controller through
the test surface: full throttle for 300 ticks (24.6 m/s), then lift-off with full right steer held, then countersteer
and centre. Free drive on the greybox map, Cruz Missile.

Body slip from the sim's own state while the steer was held (heading against the direction of travel, `linvel`):
34, 29, 24, 30 and 27 degrees at ticks 640-928 (the AC2 envelope holds 15-35 degrees); speed fell 28.7 -> 11.0 m/s.
The fixture numbers (every roster car, 20/25/30 m/s) are in `README.md` and `after/`.

## Looked at

- `tv/tv-1-straight.jpg`: the Cruz at speed on the straight before the corner, chase camera behind.
- `tv/tv-2-lift-and-steer.jpg`: lift-off and full steer: the tail steps out, tyre smoke at the rear wheels.
- `tv/tv-3-sideways.jpg`: the car well sideways across the road, nose into the corner, smoke trail; the camera keeps
  it in frame.
- `tv/tv-4-caught.jpg`: countersteer then centre: the car straight again, driving on.

## Defects found and fixed

None in the slide itself. On the way, two host defects seen in playtests were fixed in the same session (separate
commits): the results list ran under the vote panel for six racers (b840dba9), and the world kept drawing at full
rate under the opaque Lobby (619f5c78).

## Remaining defects

- The free-drive page's Keys & Pads drawer covers the top-left of the TV (dev/test page only; a real room shows no
  drawer).

## Not covered

- The owner's own hands on a phone: whether the slide *feels* catchable is the couch test's call (P1-Q02).
- WebKit/Safari hosts; the two bikes (Rapier tyres, not the arcade controller, unchanged by this bead).
