# P1-U01.3 design-language rework: fresh-eyes review

Fresh-eyes review by a Sonnet subagent with no prior context, from the images only, 2026-10-03.

Looked at: compare-before.jpg, compare-after.jpg, and the full before (about 6020 px) and after (about 7110 px) component sheets, sliced and read in full. Section numbers (00-11) are the after sheet's.

## The six points

| # | Point | Before | After |
|---|---|---|---|
| 1 | Non-web feel, hand-made placement | Partly. Panels, badges and modals have wobbly outlines (02, 03, 05), but every section is a level table or two-column grid with plain headings. | Partly to yes. In 00 the panel is tilted and steps off the grid, the heading banner hangs over its corner, the car breaks the panel edge, tags and strips sit at angles. Every section heading is a slightly rotated torn banner. Sections 01, 04, 06-10 are still level grids. |
| 2 | Big images and renders | No. No picture anywhere, only icons. | Yes, but once. 00 has a large cyan low-poly car (about half the frame width, taller than the roster panel). 11 has no render, only flat tan and orange blocks. No other section has an image. |
| 3 | Contrasting backing banner behind headings | Partly. Headings are ink type with a saffron underline stroke. Small saffron tabs ("ROUND HIGHLIGHTS" in 02, "ROUND 3 COMPLETE" in 11). | Yes. Torn ink banners with paper type and one saffron word on all of 00-11, on the "NEXT RACE IN 42S" headline in 00 and 11, and shown as a component ("ROUND 3 DONE", "PICK YOUR CAR") with contrast ratios. |
| 4 | Still very compact | Yes. Tight rows, 48 px targets, short sheet. | Mostly yes. Component sizes are unchanged. The sheet grew about 18 percent, nearly all from 00. The 00 panel holds three players and two actions in a small footprint. |
| 5 | Slants, high contrast, alive | No. Only italic display type, level boxes. | Partly. Skewed tags and strips (00), rotated banners, cobalt burst ticks round Start race, a highlighter stroke under "NUMBER 7". Buttons, toasts, fields, toggles, modals (01, 04, 05, 08) are as square and level as before. |
| 6 | Colour behind some text | Partly. Coloured seat badges, status chips, tinted toasts. | Yes. Saffron, warning and teal tags ("THIS ROUND", "YOUR CAR", "SETTINGS"); green, cobalt, ink and saffron strips ("Result saved", "8 players in", "Host - R007", "+24 points") in 00. |

## Was reference content copied?

The big items were not taken. I see no vote cards, no track or mode names (Creek Run, Quarry Bowl, Sky Yard), no logo or wordmark, no kangaroo, windmill or painted desert, and no rally-car art. The car is a different, low-poly cyan car with pink and green stripes.

Smaller echoes are present, and the owner said "never their content":
- Player names and numbers: Dusty #7, Pip #12, Ash (#3 in 00, #108 in 11). The references show "#7 Dusty", "#12 Pip", "#3 Ash". These were already on the before sheet (09, 11), and section 00 repeats them.
- Room code "R007" (reference: "Room R007", "Jump in - R007"). Also on the before sheet.
- Headline pattern: "NEXT ROUND IN 42s" in 11 and "NEXT RACE IN 42S" in 00, plus "NEXT ROUND STARTS IN 42s" in 02. The references have "Next round in 42s" and "Next round starts in 42s".
- "ROUND HIGHLIGHTS" panel tag in 02 is the reference's screen title word for word.
- "+24 points" strip and "You're #7" in 00 copy the reference's "+30 points" and "You're #7, Dusty" format. These two are new in the rework.
- "JOIN THE RACE AS #7?" (05) echoes the reference's "Join the race" button. Also on the before sheet.
The sheet's own note in 00 says copy, vote cards, car art, mode and course names and logo were not taken. That holds for the last four. The copy line is not quite true: the names, "R007" and the "42s" headlines are reference text. They are placeholder-sized, but they are the references' words.

## Honest gaps

- The new language lives in section 00 and the heading banners. Sections 01 and 03-10 look the same as before apart from the banner: level tables, evenly spaced, same small rectangular buttons. Buttons are the most-used component and did not change.
- The references are full-bleed and busy: painted sky and desert, textured panels, a wide saffron call-to-action button, comic lettering. This sheet has flat colour blocks and no texture, grain or halftone. 00 and 11 read as tidy wireframes of the idea, not as a screen that feels alive.
- Slant is applied to labels, not to structure. Panel rows, buttons, toasts and modals stay square and level. Modals in 05 are barely tilted.
- The twelve section banners are the same shape at nearly the same angle, so they read as one stamp repeated, not hand-made variety.
- Density is uneven: dense in 00, loose elsewhere. Large empty areas in 01 (wide column gaps), 06, 10 (right half empty), the lower-middle of the 11 TV mock, and the right column beside 00.
- Clipping: the car's rear wing is cut off by the right edge of the 00 frame. The spec text says the car is "outlined in ink", but I see no clear ink outline on it.
- Readability: banner type uses uppercase, so "42s" becomes "42S" and reads like a typo (the references use lowercase s). "You're #7" in 00 is small, white on mid-orange, sitting in the corner, and is the weakest contrast on the page. Column sublabels in 01 ("shadow collapses, drops 5 px") and the 09-10 captions are very small grey text. The dimmed modal backdrops in 05 are meant to be low contrast, but "NEXT R... UR" cut-off text looks like a bug on first glance.
- Rounded corners are mostly gone, but pills remain (status chips, toggles, spinner) and the buttons keep a 4 px radius. That is defensible, but the owner's complaint was uniformity, and the buttons still look uniform.

## Verdict

The rework moves in the owner's direction on banners behind headings, colour behind text, and one big render. Section 00 is the real change and is convincing as a demonstration, and the heading banners lift the whole sheet away from the plain look. But it is mostly a restyled heading system plus one showcase panel. The component sections beneath it are almost unchanged, there is only one image, the slant never reaches buttons or panels, and the sheet is far less dense and less lively than the references. Some reference text (Dusty, Pip, Ash, R007, the "42s" headlines, "Round highlights", "+N points", "You're #7") is still in the sheet, against the "language not content" brief. Fix the content echoes first, then carry the slant and weight into the buttons and panels.
