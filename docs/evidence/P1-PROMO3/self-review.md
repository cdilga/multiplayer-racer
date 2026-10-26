# P1-PROMO3 trailer: self-review

br-r1ma.3. Owner direction 25–26 Oct: race-led, the free shared Stevo voice, voiced and subtitled, a clear 64-car race,
generated tracks, a loop-the-loop, all seven vehicles, then "dynamically adding screens from 1 all the way to 64,
stopping at a few tweened, nice points to narrate", "rendered at 60fps with no lag", published on the POC page.

Trailer: `art/ui/poc/promo/bring-everyone-stevo-7454d16b.mp4` (58.76 s, 1920×1080, H.264 High 60/1 fps, AAC 48 kHz,
faststart, 61.3 MB), poster `.jpg`, captions `.vtt`, edit receipt `.json`, cadence receipt `-cadence.json`.
Watch: https://jammers-preview.dilger.dev/poc/#g-promo

## What it shows, and how it was made

| Time | Shot | Source |
|---|---|---|
| 0–20 s | The host grid grows 1 → 2 → 3 → **4** → 6 → 9 → 12 → **16** → 20 → 25 → 30 → 36 → 42 → 49 → 56 → **64**, held at 1, 4, 16 and 64 for the four lines | `capture-grow.mjs`: a real room, 64 synthetic controllers through Hello/Claim/Pick/Ready (every roster vehicle picked: 10 Cruz Missiles, 9 of each other), a real race on the room's generated track, the autopilot driving, the host's own grid layout and 300 ms reflow |
| 20–24 s | Seats 1–4 in their 2×2 grid further round the lap, the field around them | same run |
| 24–30 s | Four generated biomes: dirt, bitumen, town, rocks | `capture-tracks.mjs`, `jj procgen --recipe` |
| 30–36 s | A car carried round a generated loop (the host camera cuts to its side view) | `capture-loop.mjs`, `jj procgen --seed 1 --mix`; asserts the car goes inverted on camera (min up −0.999, frames 389–402) |
| 36–48 s | All seven vehicles, each named while it drives | `capture-roster60.mjs`, 1920×1080 |
| 48–54 s | Phone, pad-on-phone and keyboard controller pages | P1-PROMO2's phone and pad inserts; the keyboard is fresh (`capture-keyboard.mjs`: a real lobby, Keys A seated through its Add button, Host menu → Controllers, served as jammers.dilger.dev) |
| 54–59 s | End card over the 64-tile grid, jammers.dilger.dev | editor |

Every capture is frame-stepped: 2 sim ticks (120 Hz) and exactly 1/60 s of page clock per frame (`performance.now` is
virtual during the shots), so render interpolation and the grid tween advance with the sim and nothing depends on
how long a screenshot took. It is staged footage with the sim autopilot driving, not 64 people playing; the page says so.

Voice: Stevo (`stevo-australian-announcer-v1`, QUALITY pack `7c72946b…`), local FrankenTTS, $0. Eleven lines, all
pass the transcript/duration/clip/loudness screens (`voice-qc.json`; human listening not performed, as the manifest
states). "Sixty-four racers" was heard as "races" on two seeds, so the line became "Sixty-four drivers…". Mix: voice
over `race-2.ogg` ducked by the voice and the engine lap bed, final −16.2 LUFS, −1.5 dBTP.

## Looked at

- `review/final-grow-stops.jpg`: the final MP4 at 1.5, 5, 9 and 16.5 s: one tile, 2×2, 4×4 and 8×8, titles boxed
  below the game's chip row, subtitles clear of the host footer.
- `review/final-race-tracks-loop-cars.jpg`, `review/final-bikes-controllers-end.jpg`, `review/final-loop-inverted.jpg`:
  every remaining scene in the final MP4; the loop frame has the car upside down at the top.
- `review/grow-stepped-reflow.jpg`: settled layouts at 30, 36, 49 and 64 and one in-flight reflow (a run with the
  same stop plan as the final).
- `review/roster-1080.jpg`, `review/tracks.jpg`: capture inputs.
- `local/*.png`: the POC player in Playwright Chromium and WebKit at 412×915 and 1920×1080, poster and after a seek
  to 16 s; `local/playback.json` passes (no MP4 request before play, 1920×1080 media, 11 caption cues served as
  text/vtt, active cue at 16 s is the 64 line).

## Defects found and fixed

- A tile added on nearly every frame restarted the host's 300 ms reflow before it landed: tiles piled up and the DOM
  borders slid off their canvas tiles (`review/rejected-per-frame-reflow.jpg`). The moves now step through grid
  sizes, each held long enough for the tween to finish.
- The host's Overview is for derby arenas only; on a track the Camera button is disabled. The race scene uses the
  real 2×2 grid instead.
- The first "loop" search followed a car past a crash, not a loop. The loop has its own fixture and an inversion assertion.
- Titles collided with the game's own seat chips; vehicle names collided with subtitles. Moved and boxed.
- Roster footage was 1280×720 on the wall clock; recaptured at 1920×1080 on the virtual clock.
- The footer showed the capture server's `127.0.0.1` address; the capture server now names jammers.dilger.dev.
- Voice driver: ffmpeg's loudnorm JSON parse, a timeout under load, short lines missing the loudness target, digits
  in transcripts. Fixed in `tools/promo/stevo-voice.py`.
- The test surface had no lobby car pick; `{ pick }` frames now go through the real `controller_pick` encoder.

## 60 fps, no lag

`check-cadence.py`: r_frame_rate and avg_frame_rate 60/1, 3525 frames for 58.76 s, and `mpdecimate` finds **zero**
repeated frames outside the two deliberate stills (controller pages, end card); the detector does drop 223 of 360
frames over the still section, so it is sensitive. Encoded CRF 20 capped at 11 Mb/s.

## Owner review round 2 (26 Oct)

The owner rejected the floating rival name badges over the race ("NO such badges floating", derby only if at all):
R141. `world.nameplatesOn` is set from the room's mode and only a derby draws nameplates (grid tiles and the arena
Overview); race tiles, practice and replays draw none. The R13 identity journey checks the rings in a derby room
(switching to Grid with the real Camera button) and the synthetic 1/4/24-tile check asserts no nameplates outside a
derby. Grow and race shots were recaptured on the fixed build (`review/grow-no-nameplates.jpg`), everything else kept.
Also fixed: the keyboard insert's `127.0.0.1` room address (fresh capture, `review/keyboard-insert.jpg`). The earlier
`a8d821e0` render is in git history (8633d219).

## Remaining defects

- br-roit (pill leader lines leaving their tile) no longer shows in a race since R141; it can still occur in a derby grid.
- The trailer title box covers the top of the Controllers panel's heading in the keyboard insert.
- The 64-car pack is dense: many takedowns and wrecks in the opening shots. That is the real sim.

## Not covered

Physical phones or Safari (WebKit is Playwright WebKit), a human listening pass on Stevo, frame-rate on real host
hardware (this is a staged, frame-stepped capture, not a performance measurement).

## Deployed

Round 1: 8633d219 (a8d821e0). Round 2 replaces it with 7454d16b; `deployed/` is re-run after that deploy.
The public MP4 serves HTTP 200 video/mp4 with byte ranges and the committed file's SHA-256;
the VTT serves as text/vtt. `node docs/evidence/P1-PROMO3/check-playback.mjs --base https://jammers-preview.dilger.dev`
passes in Chromium and WebKit at 412×915 and 1920×1080 (`deployed/playback.json`, `deployed/*.png`).
