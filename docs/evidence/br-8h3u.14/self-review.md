# Self-review br-8h3u.14 (bots and L-plates from the host)

Captured by `web/tests/journeys/bots-lplates.test.mjs` (Playwright Chromium on the Mac, a local build served by
`jj-server`, `JJ_CAPTURE_DIR` set), 2026-11-01. One synthetic controller seat ("Ava") and four or six bots.

## Looked at
- `bots-page.jpg`, 1920x1080, Host menu → Bots with four bots (Easy, Easy L-plater on Lots, Normal, Hard): rows,
  skill/learner/remove buttons, the L-plater's highlighted "L · Lots", Add a bot and Back.
- `host-menu-players.jpg`, 1920x1080, Host menu with "Bots 4" in Host settings and Ava's "L · Some" in Players.
- `lobby.jpg`, 1920x1080, lobby roster: Ava then four dashed bot cards with ink badges, skill chips and the L-plater's
  plate.
- `race.jpg`, 1920x1080, mid-race: Ava's tile L-plate (set from the host), the positions strip with every bot marked
  "Bot" among the seat.
- `results.jpg`, 1920x1080, results: bots in their places with "BOT" tags and no points, Ava with her points, the
  winner card for a bot.
- `bots-page-1366x768.jpg`, `host-menu-1366x768.jpg`, `lobby-1366x768.jpg`: laptop, six bots.
- `bots-page-915x412.jpg`, `host-menu-915x412.jpg`, `lobby-915x412.jpg`: phone-size host, landscape; the bot list
  scrolls inside the panel, two-column lobby.
- `bots-page-412x915.jpg`, `host-menu-412x915.jpg`, `lobby-412x915.jpg`: phone-size host, portrait.

## Defects found and fixed
- Loop 1, `race.jpg`: the "BOT" tag in the dark footer strip was ink-soft on ink, nearly invisible. It now takes the
  surrounding text colour at 72 % (readable on paper and on ink).
- Loop 1, `bots-page-412x915.jpg`: the L-plater's row wrapped Remove onto a second line (the extra L-plate mark). The
  Bots list drops the separate mark (its highlighted "L · Some/Lots" button says it); the journey now asserts every bot
  row is one line at each size.

## Remaining defects
- none seen in these captures.

## Not covered
- WebKit and real devices: Chromium emulation only (the host is a TV/laptop surface; the controller is unchanged).
- A derby with bots: their race marks are race-only (a derby's ledger ranks seats; bots already scored there,
  br-bbki.11).
- The 1920x1080 journey race is one lap on a generated track; in this run an Easy bot started at the front of the grid
  and won. The native test (`host_bots_race_at_their_skill_and_take_places_among_the_seats`) shows the skills spread
  on the greybox: Hard 1st and 3rd, Normal 2nd and 6th, Easy 4th and 5th.
