# Style frames: fresh-eyes review against H4 (P1-U01.2, plan §13b.4), round 3 picks

## 1. Who, what, when
Sonnet 5.5 subagent, fresh context, did not make the frames, 2026-10-03. This is a re-review: I wrote the round-2 version of this file, then looked again at the regenerated frames. I compared the four frames in `art/ui/frames/` at full size with H4 (`docs/plans/ux-study-2026-09-29/images/H4-host-round-results-v2.png`), the README, the prompts' Subject paragraphs and Spike J's front and rear renders (`spikes/art-pipeline/J-cruze-lowpoly/out/grid_front.png`, `grid_rear.png`). I cropped and counted the grid HUD, lobby roster and derby cars. The three TV frames are 2048x1152 (16:9); the phone sheet is 1920x1280 (3:2).

H4 in one line: cream and navy sticker panels, thick rough ink borders, hand-lettered condensed type, saffron and cobalt accents, a painterly outback. Its cars are realistic painted utes, so low-poly cars are a deliberate step away from H4, not drift.

## 2. Against H4
**tv-race-grid**
- Chrome: now edge to edge, thin navy gutters, coloured sticker badge (number over name) top-left, cream "1st / Lap 2/3" stickers, slim boost bar in the player colour with no % figure. Reads as H4 family, a little cleaner and flatter.
- World: much better. Dust spray, flung stones, ink linework, buttes, gorge, windmill, bunting, General Store street, bitumen with power poles. Tiles 7 and 8 (both bonnet) are the same street.
- Cars: six chase tiles show the rear (wing, red tail lights, exhausts) and two bonnet tiles show only the bonnet, antenna and road, as briefed. Colours are distinct (teal, saffron, magenta, lime, red, violet, orange, sky blue). Faceted Spike J family. They carry a four-light bar on the rear bumper; Spike J's bar is on the front only.
- TV distance: badges, positions and bars are large and clear.
- Must-haves: eight tiles, the eight requested numbers, names, bars: present. Wrong: position stickers appear on 5 of 8 tiles. #3 Kai, #7 Dusty and #5 Sunny have none, and #108 Miko has two (5th top, 6th bottom). 2nd and 3rd never appear.

**lobby-32**
- Chrome: closest to H4. Wordmark reads JOYSTICK JAMMERS, saffron brush plate, rough ink borders, kangaroo, bunting, red-dirt footer, START RACE with a chequered flag. The QR now sits on its own white square with a margin.
- World: the best painting of the set: sun flare, cumulus, gums, tin shed, barrels, hay, tents, about eleven faceted cars on a red-dirt loop.
- Cars: Spike J family, wing and bull bar, decals. Good.
- Roster: 32 cards in 4 columns of 8, numbered 1 to 32 in order, each number once. READY text on 25, "choosing…" on 7.
- TV distance: names fine. The READY and choosing… captions are about 1.7% of frame height, still borderline.
- Wrong: all badges are the same blue or teal, not each player's colour.

**phone-controller**
- Chrome: neon, sparkles and halftone are gone. Flat comic colours, brushed navy and saffron borders, condensed italic type. Now on style with H4.
- Car: the still is the faceted Cruz-style hatchback with wing and lightning, on a cream panel. It is sky blue, not teal.
- Must-haves present: #7, Dusty, 3rd, Lap 2/3, Find my car, DRIVE and ACTION sticks, labels, boost meter, dice reroll, READY. Invented captions are gone.
- Wrong: the sideways panel is still about 1.3:1 (asked 2:1) with no phone body. "Steer" appears twice with no left or right, "Boost" appears twice, and each stick has a four-arrow cross that reads like a d-pad.

**tv-derby-overview**
- Chrome: just a "Derby" cream sticker and a round "1:42" timer. Nothing else. On style.
- World: tyre wall, hay, tin shed with "MORE SMASH LESS TALK" (H4's own sign), windmill, bunting, buttes, two parked utes. Real-looking utes, not faceted. Camera is nearer 35 degrees than 60, and the floor is a flat ring, not a bowl.
- Cars: 16 cars, as briefed. About ten are visibly battered (hanging doors, crushed fronts, holes). One yellow shell, centre top, is stripped and wheelless.
- Debris: plenty, all lying on the floor: panels, bumpers, loose wheels, shards. This now proves "stays where it fell".
- Nameplates: 15 of 16. Badge in car colour plus name, colours match their cars. #13 is missing, and the yellow shell has no plate.

## 3. Rule check
- **Counts:** lobby has exactly 32 cards, 1 to 32, no repeats, no empty slots. Race grid has 8 tiles. Derby has 16 cars and 15 nameplates.
- **Caps:** no "max", no "x/32", nothing truncated. "32 players" is a count, not a limit.
- **Header mismatch (lobby, top of roster):** it says "27 ready" but 7 cards say choosing…, so 25 are ready. The prompt asked for five choosing.
- **Invented text:** lobby plate "LOBBY · WARM-UP / Practice loop active · Red Dirt Track" (top left) and the "PRACTICE LOOP →" sign. H4's "OUTBACK DRIVES BRING PEOPLE TOGETHER" sign (lobby top right) is carried over. "R007" still reads as R-zero-zero-7.
- **Controls:** two sticks and a meter, no fire buttons. Find my car is a utility button, as briefed.
- **Brands, motifs, family:** none seen. Plates on the parked utes are too small to read. Wrecks show no gore.
- **Debris:** nothing hides, tidies or counts it down.

## 4. Defects by severity
Round 2 status: fixed are 1 (roster count and numbering), 3, 4, 7, 8 (invented phone text), 9 (QR), 10 (16:9 on TV frames), 12, 14 (utes). Mostly fixed: 2 (neon gone, car right, aspect and car colour remain), 5 (% and bar fixed, repeat remains), 6 (damage and debris fixed, one plate missing). Remaining: 8 (label clarity), 9 (H4 slogan), 11, 13, 15.

**High**
- None.

**Medium**
1. Race grid: position stickers missing on #3, #7 and #5, doubled on #108. No 2nd or 3rd.
2. Derby: 15 plates for 16 cars; #13 absent and the yellow shell is unlabelled. README still says "a nameplate over every car".
3. Lobby: header "27 ready" does not match the 25 ready cards shown (7 choosing).
4. Phone: the sideways panel is about 1.3:1, not 2:1, and is not a phone. The four-arrow crosses and duplicate "Steer" and "Boost" labels blur what a stick does.
5. README is stale: it still describes round 1 and 2 picks.

**Low**
6. Lobby: every badge is blue or teal, not the player's colour. READY captions are small for TV.
7. Lobby: unrequested text (warm-up plate, practice sign) and the H4 slogan sign; "R007" ambiguity.
8. Race grid: tiles 7 and 8 share one street; four-light bar on the car rear.
9. Phone: car is sky blue where the accent is teal.
10. Derby: camera angle and flat ring rather than a quarry bowl; parked utes are not faceted.

## 5. Verdict
All four are now fit to put in front of the owner as the style target: chrome, painted world and car family agree with H4, and the earlier cap-like roster and front-facing chase cameras are gone. Show the phone as a layout sketch (the sideways panel is not phone-shaped), and tell the owner about the "27 ready" mismatch and the unlabelled #13 car so nobody reads them as data.
