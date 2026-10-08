## Reviewer (date 2026-10-08)

Independent fresh-eyes visual review, judged from the images only. Tone reference: `fury-road__tv.jpg`. I did not open the accepted `.webp` frame, so the tone judgement rests on the fury-road jpg alone. `report.json` was read only for which families it lists as alive.

## Looked at

- dust-dirt-1tile: the followed car on tarmac shows four tan-brown flat discs at the wheels. Dirt-surface cars at left show tan discs trailing behind. Headlamp glow (white/yellow) and red tail lamps are readable. Several discs are cut flat at the bottom by the ground plane.
- tyre-smoke-1tile: faint grey translucent discs under the rear wheels of two cars. It is very low contrast and the discs are tiny. The weakest frame for its family.
- boost-blue-1tile: two clear pale-blue flame sausages under the yellow car's bumper. Blue is readable on TV. The husk's yellow glow is visible on the road in the distance. Tail lamps glow pink/orange.
- gravel-spray-1tile: one pair of blue boost flames on the red car. Gravel is only a single white pebble by the green car's rear and a few specks. Gravel spray is essentially not readable here.
- impact-sparks-1tile: a big comic star-burst (cream petals, ink outline, gold spark beads) on the followed orange car's roof. Large dust trails run down the left of the frame. White pebble spray trails the teal car. A husk with a dark smoke column and fire glow sits at the horizon. Good comic look.
- impact-sparks-1tile-reduced: the same moment with the star burst gone and only 3 or 4 small gold sparks left on the roof. Flashes are clearly toned down. The dust and husk are unchanged.
- landing-1tile: tan round dust puffs spread to the right of the red car and in front of the purple car, with a few at the followed green car's feet. Readable, but they look like generic balls. The green car's headlamp glow is good.
- detach-damage-1tile: a white-and-gold star burst on the teal car. A second burst on a distant yellow car and one on an orange car. A purple body panel lies on the ground at the bottom. Faint grey damage smoke is visible.
- damage-smoke-1tile: heavy dark-grey ring-edged smoke discs on the purple car's left rear. A dropped panel lies beside it. The husk smoke column and fire sit at the right edge, cropped.
- wreck-fire-1tile: the husk is jammed against the right edge, so fire and smoke are cropped to a sliver. The frame is dominated by huge tan dust clouds over the left half and a dark smoke arc across the horizon. It does not show the fire family well.
- wreck-fire-4tiles: the husk's fire and smoke are visible only at the far right edge of tile 1. The other tiles show heavy dust and a dark smoke-ring arc across the horizon. No readable fire or glow.
- wreck-fire-overview: top-down. The husk shows only as a small yellow glow blob on the road. There is no smoke column. No dust or smoke is alive. Cars are small, with pink lamp dots.
- driving-4tiles: dust and dirt clouds in all tiles, tan on dirt, with grey-white tyre smoke on tarmac. Blue boost flames in two tiles (yellow and red cars). Tail lamps and headlamps readable. The overall colour is Mad Max warm.
- hits-4tiles: a husk with smoke column and fire glow in tiles 1 and 3, which reads well. Dark damage smoke on the purple and green cars, with a detached panel on the ground. Tiny orange spark dots and pebble sprays on the orange and purple cars. I cannot see an impact star burst in any tile.
- all-24tiles: lamps, dust, tyre smoke, boost flames (about 5 tiles), husk smoke and fire (2 tiles) and dark damage smoke (about 4 tiles) are all identifiable. Detach panels are visible in 2 tiles. I cannot find any comic impact burst, any identifiable spark or any identifiable landing puff at this scale.

## Families vs tile counts

| family | 1 tile | 4 tiles | 24 tiles | readable? |
|---|---|---|---|---|
| dust, tarmac (light) | yes, but tan-brown, not light | yes, grey-white | yes | partly: tarmac dust is not clearly lighter than dirt dust in the 1-tile shot |
| dust, dirt (red/tan) | yes | yes | yes | yes |
| gravel spray | barely (single pebbles) | tiny white dots on the purple and orange cars | not identifiable | weak at 1 tile, weak at 4, no at 24 |
| tyre smoke (drift) | faint, low contrast | yes (grey-white and dark arcs) | yes | yes at 4 and 24, weak at 1 |
| landing puffs | yes | ambiguous (tan puffs in tile 4) | no | 1 tile only |
| boost flame (blue) | yes, clear | yes (2 tiles) | yes (about 5 tiles) | yes |
| sparks on hits | yes (gold beads on the burst) | tiny orange dots only | no | 1 tile only |
| impact flash / puff scaled by impulse | yes, strong | not seen | not seen | 1 tile only, and no scaling shown |
| detach burst | yes | panel on ground; burst not seen | panel in 2 tiles; burst not seen | the panel reads, the burst does not at 4 or 24 |
| damage smoke | yes | yes | yes | yes |
| wreck fire and glow | cropped in the wreck shot, fine in impact and boost shots | yes (hits-4tiles) | yes (2 tiles) | yes |
| lamps (head/tail/brake) | yes | yes | tail lamps yes, headlamps small | yes |

Only one frame shows scaling by impulse: a single impact. No frame compares two impacts of different strength.

## Coverage rule (identity and road ahead) and reduced motion

- **Identity:**
  - Most effects sit behind or beside the followed car, and paint stays readable.
  - The impact star burst lands on the roof and rear glass of the followed orange car (impact-sparks-1tile) and the teal car (detach-damage-1tile). Body colour stays clear, but the burst is large.
  - Damage smoke drapes hard-edged dark discs over the purple car's whole left rear (damage-smoke-1tile) and the green car (hits-4tiles bottom-right). That hides roughly a third of the car. The colour is still identifiable, so I rate this minor, but it is close to the line.
- **Road ahead:**
  - In wreck-fire-1tile and wreck-fire-4tiles, a long arc of dark smoke rings and big tan dust discs hangs across the far track and horizon, on the road the player is driving toward.
  - The same arc is visible in tiles 2 to 4 of wreck-fire-4tiles and in all-24tiles. The road stays visible beneath it, so it is not fully blocked, but the track edge and corner exit are partly veiled.
- **Reduced motion:** impact-sparks-1tile-reduced removes the big star burst and cuts the sparks from 227 to 48 alive. It is clearly toned down, and nothing flashes. Pass.

## Defects

1. **Blocking.** hits-4tiles.jpg and all-24tiles.jpg: no readable impact flash or impact puff in any tile at 4 or 24 tiles, although report.json lists impact as alive (32). Sparks show only as a few 2 to 3 px dots. The impact and spark families are readable only in the single 1-tile shot, and a detach burst is not readable at 4 or 24 tiles. This breaks "each family readable somewhere at each tile count where the scene has it."
2. **Blocking.** all-24tiles.jpg: landing puffs, gravel spray and sparks are not identifiable. Each 320x270 tile has a small effect scale, and the effects do not grow to stay readable. The capture needs a frame where those effects fall in a visible tile, or the effects need a minimum screen size at tile scale.
3. **Minor.** gravel-spray-1tile.jpg: the shot named for gravel shows almost no gravel (one pebble at about (1075,938)). The family reads better in impact-sparks-1tile (white pebble spray on the teal car), so the file is mis-targeted.
4. **Minor.** tyre-smoke-1tile.jpg: the smoke is faint, small grey discs on dark tarmac, easy to miss on a TV. It reads better at 4 tiles.
5. **Minor.** dust-dirt-1tile.jpg: tarmac dust is tan-brown rather than a light, pale dust, so the "light on tarmac vs red on dirt" distinction is weak for the followed car. The puffs are also cut flat at the bottom by the ground plane at about (270,665) and (1480,980).
6. **Minor.** wreck-fire-1tile.jpg and wreck-fire-4tiles.jpg: the husk sits at the right frame edge, so fire and smoke are cropped. The wreck fire family is readable elsewhere, so this is a framing problem for the evidence only.
7. **Minor.** wreck-fire-overview.jpg: top-down, the wreck is just a small glow blob. There is no smoke column and no readable flame shape, and the 0 to 4 particles alive show it.
8. **Minor.** Style: smoke and dust are translucent "glass bubble" discs with a visible hard rim and no ink outline or toon ramp. Only the impact star burst has comic ink. Dust, smoke and boost clash with the inked, warm, toon-shaded Fury road look (the fury-road reference has no such bubbles). Dark damage smoke in particular looks like soap bubbles.
9. **Minor.** damage-smoke-1tile.jpg and hits-4tiles.jpg: damage smoke drapes over the followed or adjacent car's body (see the coverage section).
10. **Minor.** wreck-fire-4tiles.jpg and all-24tiles.jpg: the dark smoke-ring arc hangs across the horizon and track ahead (see the coverage section).

## Verdict: FAIL

The look is mostly on target: warm, inked comic clouds and cars, strong and readable blue boost, good comic impact star burst with detach panels at 1 tile, a clear fire and smoke column on the wreck, readable lamps, and reduced motion that genuinely tones the burst down. The acceptance as written requires each family to be readable at 1, 4 and 24 tiles, and that does not hold. The impact flash and sparks (and the detach burst) are seen only at 1 tile. At 4 tiles I find only a few tiny spark dots and no burst, and at 24 tiles none. Landing and gravel are not identifiable at 24 tiles. Several effects (gravel, tyre smoke) are weak even at 1 tile, and the bubble-style smoke disc style departs from the inked comic look while draping across the road ahead and over cars. Fix defects 1 and 2 (re-capture or rescale so impact, sparks, landing and detach read at 4 and 24 tiles), then this should pass, with the minor items as follow-ups.
