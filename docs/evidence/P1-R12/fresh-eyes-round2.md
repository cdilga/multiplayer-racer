## Reviewer (date 2026-10-08)

Independent fresh-eyes visual pass. Judged from the 15 frames and the two tone references only. I read report.json for the family counts, as the brief allowed. I did not read code, self-review.md or fresh-eyes-round1.md.

## Looked at

- fury-road__tv.jpg (reference): warm orange and teal, thick navy ink outlines, halftone shadow, soft red tail lamps. No particles. This is the tone bar.
- dust-dirt-1tile: followed teal car on tarmac with two small tan puffs per rear wheel and white headlamp glow. Green and red cars on dirt have a few tiny faint tan puffs. Dust on dirt is barely there. Husk fire is not visible.
- tyre-smoke-1tile: pink car with grey-white discs at both rear wheels, orange car with tan discs. They read as smoke, but as flat translucent circles with a hard ground-clipped lower edge. Tail lamps glow pink.
- boost-blue-1tile: yellow car with two clear pale-blue flames (blue at full, readable). Far right on the road is a small yellow glow, the husk's fire, with no visible smoke.
- gravel-spray-1tile: green car pinned against a barrier. Red car with two blue boost flames. Teal car in the distance with a yellow boost. Only two very faint translucent discs sit at the bottom-left under the green car. I cannot see any gravel spray.
- impact-sparks-1tile: orange followed car with an ink-outlined white spiky flash and yellow spark dots on its roof and rear. Large translucent dust discs fill the bottom-left foreground and overlap the car's lower-left. A dark smoke column with an orange fire core rises from the husk on the road in the distance. Clear and comic.
- impact-sparks-1tile-reduced: same moment. The flash is gone and a few small spark dots remain. The husk fire is dimmer and has no white-hot core. Dust is lighter. Reduced motion clearly tones things down.
- landing-1tile: green followed car with warm yellow-white headlamps. A red car beside it throws a trail of tan dust discs to the right. Reads as a landing puff trail, soft and faint.
- detach-damage-1tile: the purple car has lost a panel, which lies on the road with its livery intact. The teal car beside it and two cars in the distance show ink-outlined white burst flashes with yellow sparks. Clear.
- wreck-fire-1tile: teal followed car in a big cloud of tan and white dust discs over the left half. Cars ahead trail dust. The husk fire and smoke sit at the extreme right edge and are cut off. Weak as a wreck shot.
- wreck-fire-4tiles: the husk is visible only in the top-left tile, at its right edge, and it is partly cropped. The other tiles show dust and smoke trails. The top-right tile has a grey disc over the magenta car's roof.
- wreck-fire-overview (top-down): a small yellow-white glow blob on the straight, no visible husk, smoke or fire shape. The cars are identifiable by paint. The overview does not communicate a wreck.
- driving-4tiles: tail and head lamp glows, grey tyre smoke on tarmac, small tan dust on dirt, blue boost on the bottom-left and bottom-right tiles. The husk fire appears as a yellow glow on the bottom-left tile. Reads well.
- hits-4tiles: dark smoke plume with a fire core over the husk (top-left and bottom-left tiles). Detached panel (top-right). Orange hit-spark dots scattered across the dirt. Large pale discs overlap the followed cars in the top-right and bottom-right tiles. Plume and dots read well.
- all-24tiles: at about 320px per tile, boost flames (blue, and orange or yellow on some tiles), dust and smoke trails, one dark husk plume (row 1, col 5 and row 4, col 4) and a detached panel are readable. Individual sparks are not distinguishable.
- real-race-crash-4tiles: a real race with Fury-road town and gates. Two cars touch, in the top-left and bottom-left tiles. I see no sparks, flash, puff or smoke at the contact point. Only tail lamps glow. The followed cars' paint and the road ahead are clean.

## Families vs tile counts

| family | 1 tile | 4 tiles | 24 tiles | readable? |
|---|---|---|---|---|
| dust on tarmac (light) | yes, small | yes | yes | yes, a little faint |
| dust on dirt (red/tan) | faint, tiny | yes | yes | yes at 4 and 24, weak at 1 |
| gravel spray | not identifiable | not identifiable | not identifiable | no |
| tyre smoke on drift | yes | yes | yes | yes, but flat discs |
| landing dust puffs | yes (trail) | partial | not distinguishable | marginal |
| boost flame (blue at full) | yes | yes | yes | yes |
| sparks on scrapes/hits | yes | yes | not distinguishable | yes at 1 and 4 |
| impact flash scaled by impulse | yes, one size only | yes | not distinguishable | yes, but scaling is not shown |
| part-detach burst | yes | yes | marginal | yes |
| smoke from badly damaged cars | only the husk plume | only the husk plume | only the husk plume | no running damaged car is shown |
| fire and glow on wrecks | edge-cropped | yes (husk partly cropped) | yes, two tiles | yes at 4 tiles, weak at 1; overview is a blob |
| emissive head/tail/brake lamps | yes | yes | yes | yes |

## Coverage rule (identity and road ahead) and reduced motion

- Identity: mostly held. Paint stays readable on every followed car. Exceptions are the translucent discs that sit over car bodies. They fall on the roof of the magenta car (wreck-fire-4tiles top-right), the purple roof (hits-4tiles top-right) and the green roof (hits-4tiles bottom-right). The pale blob in hits-4tiles bottom-right covers about a quarter of that tile's lower right. These are partial and translucent, so the colour still reads, but the rule says never cover.
- Road ahead: held. The dust and smoke trail behind or beside the cars. In wreck-fire-1tile the left foreground has heavy dust, but the lane ahead stays clear.
- Reduced motion: held. The flash, the bright fire core and the dust are all visibly reduced in impact-sparks-1tile-reduced.
- Comic style: the impact flash, the burst and the panel carry ink outlines and fit the Fury-road look. The dust, smoke and tyre-smoke discs have no ink outline, no toon ramp and visible hard rims, so they read as soap bubbles beside the outlined cars. They clip flat at the ground where they pass through geometry. The tail-lamp glow blooms sit a little below the red lamp rectangles (see defect 7).

## Defects

1. Gravel spray is not identifiable (gravel-spray-1tile). Report.json lists only "dust" for that shot. It shows two faint discs and no gravel pieces or sprayed stones. A required family is missing in the 1, 4 and 24 tile captures. **Blocking.**
2. Smoke from badly damaged, still-running cars is not demonstrated in any frame. The only damage smoke is the husk plume. report.json reads "damage-smoke": 0 for the early shots. **Blocking.**
3. real-race-crash-4tiles, top-left and bottom-left tiles (cars touching): no spark, flash or puff at contact. The one real-race frame provided shows no particle response to a hit. This is not proof of a bug, because the frame may fall outside the effect window, but it is not evidence that the effects work in a real race. **Blocking** as an evidence gap.
4. Impact flash scaled by impulse is not shown. Every flash is one size, and there is no small versus large pair. **Minor.**
5. Dust, smoke and tyre-smoke discs have hard rims, look like soap bubbles, are not ink-outlined and clip flat at the ground (tyre-smoke-1tile orange car, dust-dirt-1tile green car). They do not match the accepted comic look. **Minor.**
6. Translucent discs sit over followed-car roofs and bodies: wreck-fire-4tiles top-right (magenta car), hits-4tiles top-right and bottom-right (purple and green roofs), and the large pale blob in hits-4tiles bottom-right. **Minor.**
7. The tail-lamp glow blooms are offset below the red lamp rectangles on the followed car (dust-dirt-1tile, tyre-smoke-1tile), so the lamp and its glow read as two objects. **Minor.**
8. The husk is edge-cropped in wreck-fire-1tile and wreck-fire-4tiles, so the 1-tile wreck shot does not show the fire or glow clearly. The overview shows only a tiny yellow blob with no husk, smoke or fire shape. **Minor.**
9. Landing puffs are indistinguishable from drive dust. At 24 tiles landing, sparks and impact are not distinguishable from each other. This is expected at tile size, but "readable at 24" is only met for boost, smoke and the husk plume. **Minor.**

## Verdict: FAIL

The families that are shown look good where they appear: blue boost, the ink-outlined impact flash and detach burst, the husk smoke and fire plume, the lamps, and a reduced-motion version that tones the flash down. Identity and the road ahead stay mostly clear. Three required items are not demonstrated, though. Gravel spray cannot be seen in any frame. No running badly-damaged car shows smoke, only the husk. The only real-race crash frame shows no hit response. The dust and smoke discs also sit outside the comic look and partly overlay car roofs, but those are minor on their own. Re-capture a visible gravel spray, a damaged car trailing smoke, and a real-race contact with its flash and sparks, and this should pass.
