# Self-review P1-C08.style

## Looked at

- hub-1100x700.jpg: 1100x700, six sources (ready keys, idle keys, connected pad, autopilot pad over a relay, unplugged pad, left pad); checked ink panel, recessed rows, brushed seat badges in the `--id-N` colours, brushed chips with icons, path and byte lines, unplugged dashed row.
- hub-1920x1080.jpg: 1920x1080 (TV profile), same six sources; checked scale, that paths are no longer cut ("Direct · 9 ms" in full), long chip "Left: press to rejoin" fits.
- hub-412x915.jpg: 412x915 portrait phone, same six sources; checked the narrow layout (path drops under the name, chips stay right, nothing clipped).
- hub-915x412.jpg: 915x412 landscape phone; checked the first rows fit the short viewport and the list scrolls.
- hub-identify-flash-1100x700.jpg: 1100x700, Pad 1 mid identify flash; checked the whole row fills in the seat colour, the saffron ring, only that row flashes, text stays readable.
- hub-many-1100x700.jpg: 1100x700, 12 sources including one very long name, connecting, idle, left and unplugged states; checked the long name truncates with an ellipsis, every source keeps its row.
- hub-many-412x915.jpg: 412x915, the same 12 sources; checked truncation of the long name to "A very long con…" and that the list scrolls under the head with no row hidden.
- phone-with-pad-844x390.jpg: 844x390, the phone's tray with two seats (This phone, Pad 1) over a hub page; checked the slim tray, seat badges, short chips, no overlap.

The unplugged pad state is the "Pad 3 / Unplugged" row in hub-1100x700.jpg and the others (orange warn chip with the wifi-off icon, dashed border, dimmed name and badge).

## Defects found and fixed

- First capture: the ink panel rendered as a paper panel (the controller's own `.panel` rule won); fixed with an explicit `.hub-panel.panel-ink` rule.
- The empty-seat marker was a tiny blob in a brushed dab; it is now a dashed recessed box with a dash.
- At 1920x1080 the path column was a fraction of the row and truncated "Direct · 9 ms" to "Direct · 9 ..."; the column now sizes to its content (capped at 14em, ellipsis beyond) and the page is a little wider (880px).
- The phone tray truncated "This phone" to "Thi…" with icons in; icons are hidden in the tray, so the name and chip fit.
- Chip text was caption-sized and hard to read on the TV; it is now the kit label size.
- Review by BrownCreek: the seat badges showed a bare number; they now read `#N` like every kit badge (a text change after these captures, not recaptured). A relay path showed the orange warning chip; relay plays fine (R79), so it is now the cobalt info chip, and only Reconnecting warns.

## Remaining defects

- The left seat bar and the row's rounded border meet with a small notch; cosmetic.
- A dimmed unplugged row on the yellow seat colour turns olive (the opacity applies to the badge); readable, and the Unplugged chip carries the state.
- The phone strip's connection badge (`[data-hud=conn]`, now a brushed chip with a wifi icon, in badge.ts and the end of hub.css) was not seen in a capture; see below.

## Not covered

- A live hub: the journey's harness ran (jj-server and a host page opened in Chromium on the Mac), but a pad's WebRTC join stayed on "Joining…" locally (503 from the relay fallback endpoint, no ICE path), so the rows in every capture are real hub code rendering fake sources injected into `__jjHub.hub` with its tick disabled; no real seats, host or path badge ("Direct · 12 ms" is a fixture string).
- The phone controller page with its strip and the real tray over the sticks: the tray capture sits on the hub page, and the strip's `[data-hud=conn]` chip was not captured (needs a live session).
- Keyboard and gamepad focus rings: the hub rows have no focusable controls, so there are none to show.
- WebKit, Firefox, real devices: all captures are Playwright Chromium on the Mac, not a device.
