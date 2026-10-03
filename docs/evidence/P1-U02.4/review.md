# Fresh-eyes review: warm-up, end of round, intermission (P1-U02.4)

**Verdict.** The three screens are a clear step up on the old ones. The warm-up now shows cars, the intermission fills its footer, and the torn-ink banners, saffron accent words and brushed tags are applied. Underneath, the layout is still a web page: hard-edged rectangles on a rigid row/column grid, a hard rule above the footer, and a web toolbar on the warm-up. Tilt and overlap appear only on banners and tags. There are no burst ticks anywhere. Sub-labels are too small for a couch, nothing respects TV safe margins, and the sparse cases (n=2, n=8) leave big dead areas. Warm-up at 32 and 140 players fails on tag clutter.

## Warm-up (POC1-15)
Asks: **cars visible: met** (live arena, about 70% of the screen). **A decided warm-up: met** ("Drive around while everyone joins"). **Works at any N: partly.** n=2 and n=8 are fine. n=16 is crowded. n=32 and n=140 are unreadable.
1. Non-web feel: **partly.** The banner and QR card tilt about 1°. The list panel, the 1332 px sidebar edge and the bottom toolbar are strictly aligned.
2. Big renders: **not met.** Cars are about 100 px at n=2 and 8 on a flat orange void, far under 30% of the screen.
3. Banner and tags: **met.** WARM-UP has a torn ink banner with a saffron "UP", and the "N PLAYERS" tag is brushed saffron.
4. Compact: **met.** Rows and gaps are tight.
5. Slants and ticks: **partly.** Banner and tag slant, but there are no burst ticks and Start race is buried.
6. Colour strips: **met.** One-line strips only. The ✓ in the tags is dark green on navy and likely fails AA.

## End of round (POC1-17)
Asks: **new style applied, content kept: met.** Podium, standings, countdown, QR and the three actions are all there. The old top-left logo is gone.
1. Non-web: **partly.** The podium cards tilt. The hero frame, standings panel and button stack are rigid.
2. Big renders: **met.** The winner render is about 37% of the screen and is in the right place.
3. Banner: **met.** "ROUND 3 **COMPLETE**" is saffron on ink, and STANDINGS is a tag.
4. Compact: **met.**
5. Slants and ticks: **partly.** The Start next round now button has a saffron halo, not burst ticks.
6. Colour strips: **met.** The R007 strip and the orange NEXT RACE tag are short lines.

## Intermission (POC1-16)
Asks: **maximise highlights: met** (the hero is about 41% of the screen). **Content on the sides of the replay: partly.** Only the right side is used, and the left of the hero is empty. **QR prominent: partly.** It shrank to about 200 px from about 295 px. The wasted footer space is now used.
1. Non-web: **not met.** There is a title row, a hero plus rail, and a footer, split by a hard rule. Nothing overlaps or breaks an edge.
2. Big renders: **met.**
3. Banner: **met.** "ROUND **HIGHLIGHTS**" and UP NEXT are on-style.
4. Compact: **met.**
5. Slants and ticks: **partly.** The caption strip is skewed. There are no ticks.
6. Colour strips: **met.**

## Problems, most important first
1. **Warm-up n=16 to 140: tags sit on the cars and on each other.** Dusty's tag covers Ash's car, and at 140 the tags hide almost every car and spill past the subtitle strip. Fix: n ≤ 8 gets name + number offset 28 px above the ring. n 9 to 32 gets a 22 px number-only chip. n > 32 gets no tags, only the ring colour and the number on the car roof. The list carries the names. Use ✓ #6BE38A on navy.
2. **Warm-up n=2/8: cars are tiny in an empty field.** Fit the camera to the player bounds with a minimum car size of 200 px at n ≤ 8. Add floor texture and tyre tracks so it is not flat orange. A hero car must clear 30% of the screen.
3. **Warm-up: the sidebar plus toolbar reads as a web app.** The list panel is about 55% blank at n=2 and 8. The room code and ready count each appear twice (QR card and bottom bar, list header and bottom strip). Fix: size the list to its content, tilt it -1°, let the QR card overlap the arena edge by 40 px, and delete the bottom bar's duplicates.
4. **Start race (about 185x60) is the one action and it is a toolbar button.** Make it 360x96, skewed -3°, with 3 orange burst ticks each side, and keep the fullscreen and menu icons small and away from it. No screen has burst ticks, so add them here and on Start next round now.
5. **Intermission and results: no safe margins.** The banner sits at y≈5, the QR at x=48, and "Return to lobby" touches the bottom edge (y≈1075). Keep 54 px top/bottom and 96 px left/right.
6. **Intermission: QR shrank.** Set it to at least 260 px and keep "Jump in · R007" at 80 px or more.
7. **Intermission: the up-next rail is rigid and its labels cover about 40% of each thumbnail.** Make it a skewed 26 px tag at the top-left of each thumbnail. Stagger the four by ±12 px and tilt them ±1.2°. Let the first one overlap the hero edge by 30 px. Put something on the empty left, such as a tilted "BIGGEST AIR" stat card over the hero's corner.
8. **Intermission: the hero shot contradicts its caption.** "BIGGEST AIR" shows grounded cars, and at n=32 a pink roof fills the frame. The replay camera must frame the subject at 40% of the frame height, in the air-time frames.
9. **Intermission: the podium chips are stair-stepped (two on top, one below) and small (36 px).** Put them in one tilted row, 1st larger, or in the hero's bottom corner as results does. The "Next round in 42s" strip at 28 px is too small. Make it a 56 px orange tag.
10. **Results n=8: the standings panel is about 45% empty.** Scale the rows to fill (56 px rows, 34 px text), add a totals column (it shows "+30" with no total), and tilt the panel -1°. In the hero, the winner card covers the car's bumper and the blue car is cut off at the left. The 3rd tile for Snag (black car) shows a green wreck.
11. **Small text.** The sub-labels ("Skips the timer", "Everyone stays connected", "Timer keeps running", the QR caption, "Highlights first, then the grid lines up") are about 20 px. Use at least 28 px or delete them. List names at about 26 px are borderline, so raise them to 30 px.
12. **Lists paginate at 32 and above.** At n=140 only 20 are listed, and the page rotation (7 pages x 6 s) hides ready states. Add a one-line "117 of 140 ready" progress strip with a bar and let the arena carry ready as ring state.
