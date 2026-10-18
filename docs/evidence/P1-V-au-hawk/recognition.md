# P1-V-au-hawk recognition receipt (br-bwju.12): would a minimal-reasoning vision model name this car an AU Falcon?

**Result: NOT MET.** 0 of 25 renders were named an AU Falcon (the bar is 90 %, with LOD2 and the chase view passing). 13 of 25 were
named an Australian full-size sedan (a Holden Commodore, mostly; a Ford Falcon came up twice as an "also possible"). The control passes: the Hawk Dash was named
an AU Falcon in 0 of 25 renders. Everything below is the raw record, nothing is rounded up.

## How it was asked

- **Model:** `claude-haiku-5-5`, `claude -p --model claude-haiku-5-5 --effort low --allowedTools Read` (Claude Code CLI on the Mac), one fresh call per image, no system prompt of ours, no conversation.
- **Prompt, exactly** (`%s` is the image path):
  > Look at the image file %s . It is a render of a low-poly game car. What real-world car (make, model and generation) does it look like? Answer in one short line.
- **No hints:** each image is copied to a fresh temp directory as `render.png` first, so neither the file name nor the folder names the car. The prompt says "low-poly game car" and nothing else.
- **Tool:** `tools/vehicles/recognition/ask.sh <dir> <out.tsv>`; the answers are `recognition-answers-au-hawk.tsv` and `recognition-answers-control-hawk-dash.tsv` in this folder.
- **Renders:** `tools/vehicles/recognition/render.mjs au-hawk` (the baked GLBs through the game's paint-key material, three.js, headless Chromium on eris, software GL; plain grey backdrop; the game's orange; 640x640; front, front 3/4 left, front 3/4 right, side, rear 3/4, rear, top; LOD0, LOD1, LOD2) in `recognition/`.
  The chase views are the real host page (`tools/vehicles/recognition/chase.mjs au-hawk`: synthetic oval, one tile, the race chase camera, ANGLE/Vulkan on eris's RTX 2080 Super, 1280x720, the host's own colours and shaders) in `chase/`. The chase camera sits behind the car, so every chase view is a rear view.
- **Commit the renders come from:** the one this file is committed with (art/vehicles/au-hawk baked at 2612 / 876 / 574 triangles).

## Summary by view

| View | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| front | other | AU sedan | other |
| front-left | AU sedan | other | other |
| front-right | AU sedan | AU sedan | other |
| side | other | other | other |
| rear-left | AU sedan | other | other |
| rear | AU sedan | AU sedan | AU sedan |
| top | other | AU sedan | AU sedan |
| chase 1-4 | other, AU sedan, AU sedan, AU sedan | | |

Falcon = named an AU Falcon as its answer; AU sedan = named a Holden Commodore (or a Falcon only as an alternative); other = anything else.
By LOD, an AU Falcon named: LOD0 0/7, LOD1 0/7, LOD2 0/7, chase 0/4. An Australian sedan named: LOD0 4/7, LOD1 4/7, LOD2 2/7, chase 3/4.

## Control: the Hawk Dash (FG XR8 caricature), same model, same prompt, same renders and chase

### Hawk Dash answers (21 renders and 4 chase views, `control-hawk-dash/`)

| Image | Answer (verbatim) | AU Falcon named? | An Australian sedan named? |
|---|---|---|---|
| `chase-1.png` | It looks loosely like a 2015–2017 Ford Mustang (S550) in red with Shelby-style racing stripes, though the low-poly form and rear-quarter view make that a low-confidence match.  | no | no |
| `chase-2.png` | It looks like a 2005–2009 Ford Mustang (S197 generation), with its red paint and twin black racing stripes, though the low-poly model is loose enough that it could also pass for a 2010–2014 S197 facelift.  | no | no |
| `chase-3.png` | Looks like a **Ford Mustang Shelby GT500 (S550, 2020–2023 facelift)**, judging by the rear view: red body with twin black stripes, quad exhausts, and a rear spoiler. Moderate confidence, since low-poly and the rear view hide a lot.  | no | no |
| `chase-4.png` | Most like a 2015–2017 Ford Mustang (S550) in red with racing stripes, though the low-poly rear view makes that a low-confidence guess.  | no | no |
| `lod0-front-left.png` | Looks like a Nissan Skyline GT-R (R33/R34 generation), based on the sedan-coupe profile, the hood vents and the rear wing. The silhouette is a loose low-poly approximation, so the exact generation is my best guess.  | no | no |
| `lod0-front-right.png` | It looks like a stylised Ford Mustang (S197/2005–2009 generation), with its fastback-style cabin, hood vents and sharp headlights.  | no | no |
| `lod0-front.png` | Looks like a **Ford Mustang (S550, roughly 2015–2017 facelift)**, judging by the twin hood stripes, hood vents, and wide horizontal grille; it's a low-poly approximation, so the match is loose.  | no | no |
| `lod0-rear-left.png` | Closest match is a mid-2000s Holden VE Commodore sedan, though the low-poly form is loose enough that it's a resemblance, not an identification.  | no | yes |
| `lod0-rear.png` | Most likely a BMW M4 (G82 generation, 2021 onward), though it's a low-confidence guess: the angular red tail lamps, wide rear and quad exhaust fit it, but the low-poly model is too coarse to be sure.  | no | no |
| `lod0-side.png` | Closest match is a stylised **Nissan Skyline R32 (four-door GTS sedan)**, though the two door cuts and the flat roofline are only a loose fit.  | no | no |
| `lod0-top.png` | Best guess: a late-1960s American muscle coupe, something like a 1967–68 Ford Mustang fastback or Dodge Charger, but a top-down view can't confirm the make or generation.  | no | no |
| `lod1-front-left.png` | It's a stylised take on a 1990s Nissan Skyline R32 GT-R-style four-door sedan, with the rear wing and wide arches; the nose is more Hawk-like than the real car.  | no | no |
| `lod1-front-right.png` | Closest is a 1990s–2000s Japanese sports coupe, roughly a Nissan Silvia S15 / 240SX, but it's a stylised generic shape rather than a faithful copy of any production car.  | no | no |
| `lod1-front.png` | It looks like a **Ford Mustang Shelby GT500 (S550 generation, 2020+)**, judging by the twin racing stripes, hood vents and wide front fascia. This is a front view of a low-poly model, so the match is a best guess.  | no | no |
| `lod1-rear-left.png` | Closest match: a Holden VE/VF Commodore sedan (rear three-quarter view), though the low-poly rendering makes it a loose match.  | no | yes |
| `lod1-rear.png` | This looks like a **BMW M4 (G82 generation, 2021 onward)**, based on the angular red headlights, the wide front fascia with twin kidney-style intakes, and the rear spoiler.  | no | no |
| `lod1-side.png` | It looks like a stylised Nissan Skyline R32 GT-R (2-door coupe, sharp roofline and side-window profile), with a rear spoiler and wide fender flares.  | no | no |
| `lod1-top.png` | Probably a 1970-era American muscle coupe, something like a Dodge Charger or Plymouth Road Runner, but a top-down view can't confirm the make, model or generation.  | no | no |
| `lod2-front-left.png` | Loosely a 2005–2009 Ford Mustang (S197 generation): fastback roofline, long hood, and dual racing stripes, though the low-poly model is approximate.  | no | no |
| `lod2-front-right.png` | Roughly a **Ford Mustang (S550, 2015–2017 generation)**, based on the long hood, two-stripe livery and coupe roofline; the low-poly style makes the exact generation a guess.  | no | no |
| `lod2-front.png` | Looks like a **Ford Mustang (S550, 2015–2017)**, based on the wide hood, the sharp headlamps and the twin racing stripes. It's a low-poly model, so the generation call is a best guess.  | no | no |
| `lod2-rear-left.png` | Most like a 5th-generation Chevrolet Camaro (2010–2015) coupe, though the low-poly model is stylised, so the match is approximate.  | no | no |
| `lod2-rear.png` | Most likely a **Ford Mustang (S197, 2005–2009 generation)**, judging by the twin hood stripes, the split central grille and the wide, low nose. This is a low-confidence read from a front-on view, since the render shows no side or rear profile to confirm it.  | no | no |
| `lod2-side.png` | Not a specific real car: it's a stylised 1980s wedge coupe, closest in spirit to a second-generation Mazda RX-7 (FC, 1986–91).  | no | no |
| `lod2-top.png` | A late-1960s American pony car, most like a first-generation Ford Mustang with its twin center racing stripes, though a plan view alone can't confirm the exact generation.  | no | no |

AU Falcon named: 0/25. It answers Ford Mustang, Nissan Skyline, Chevrolet Camaro and the like, which is what the Hawk Dash is built to look like. PASS.

## Every answer for the AU Hawk

### AU Hawk answers

| Image | Answer (verbatim) | AU Falcon named? | An Australian sedan named? |
|---|---|---|---|
| `chase-1.png` | Most like a 2001–2004 Holden Monaro (CV8), though low confidence given the low-poly render.  | no | no |
| `chase-2.png` | Looks like a late-1990s Holden Commodore (VT–VX generation) sedan, going by the round lamps and slatted grille, though the low-poly detail makes that a loose match.  | no | yes |
| `chase-3.png` | Closest match is a late-1990s to early-2000s Holden VT–VX Commodore sedan, but this is a low-confidence guess from a stylised, low-poly front view.  | no | yes |
| `chase-4.png` | Looks like a Holden Commodore VE sedan (2006–2013), though the low-poly render is too coarse to confirm the generation.  | no | yes |
| `lod0-front-left.png` | Closest match is an early-2000s Holden Commodore (VT–VX) sedan, though it's generic enough to also read as a Ford Falcon (BA/BF).  | no | yes |
| `lod0-front-right.png` | Looks like a late-1990s/early-2000s Holden VT–VZ Commodore sedan, though the low-poly simplification makes it a loose match.  | no | yes |
| `lod0-front.png` | It doesn't clearly match one real car. The closest impression is a generic early-2000s small sedan or hatch, with no make, model or generation I can identify confidently from this front view.  | no | no |
| `lod0-rear-left.png` | It looks like a first-generation Holden Commodore (VE/VF-era sedan), though the low-poly form makes it a loose match.  | no | yes |
| `lod0-rear.png` | Rear view of an orange sedan that most resembles a Holden VE Commodore (2006–2013), a best guess with low confidence, since the low-poly model is generic.  | no | yes |
| `lod0-side.png` | Closest match is a boxy 1980s–early-'90s notchback sedan like a Mitsubishi Lancer (Mk3/4) or Nissan Pulsar/Sunny, though the low-poly form makes the exact generation uncertain.  | no | no |
| `lod0-top.png` | Probably a boxy 1980s hatchback, roughly Ford Escort Mk3 or Mazda 323 territory, but a top-down plan view can't pin down make, model or generation, so treat that as a loose guess.  | no | no |
| `lod1-front-left.png` | Closest match is a 2000s compact sedan such as a Subaru Impreza (GD/GG generation), though the low-poly simplification makes the exact model uncertain.  | no | no |
| `lod1-front-right.png` | Best guess: a 2000s Australian sedan, most like a Holden Commodore VY/VZ, though the low-poly model is too coarse to pin the generation with confidence.  | no | yes |
| `lod1-front.png` | It looks like a generic early-2000s Australian-style sedan, closest to a Holden VX/VY Commodore, but I can't pin down make, model or generation from this front-only view, so treat that as a loose resemblance.  | no | yes |
| `lod1-rear-left.png` | It's a generic low-poly mid-size four-door sedan, roughly 2010s Toyota Camry-like, but the geometry is too abstract to pin to a specific make, model or generation.  | no | no |
| `lod1-rear.png` | Closest match: a Holden Commodore VE sedan, seen from the rear (low confidence; the low-poly form is too abstract to pin down the exact generation).  | no | yes |
| `lod1-side.png` | Closest match is a 1980s wedge-shaped hatch/coupe, roughly in the Toyota Celica or Mitsubishi Starion vein, but I can't pin a specific make, model and generation from this low-poly render.  | no | no |
| `lod1-top.png` | Likely a 1970s–80s Australian hatchback or coupe, such as a Holden Torana or Gemini, though a plan view is too ambiguous to pin the exact make, model and generation.  | no | yes |
| `lod2-front-left.png` | Nothing specific: it's a generic low-poly sedan/hatchback that loosely resembles a 2000s compact like a Mazda3 or Ford Focus, but it's too abstract to name a make, model or generation.  | no | no |
| `lod2-front-right.png` | It looks most like a **Subaru Impreza WRX sedan (around the 2002–2007 GD generation)**, going by the sedan body, the single round headlamp and the slatted lower grille. It's a low-poly approximation, so this is a best match, not a certain ID.  | no | no |
| `lod2-front.png` | Closest guess is a 2000s-era Mitsubishi Lancer, but this is low confidence: the front view is too generic to pin the make, model and generation.  | no | no |
| `lod2-rear-left.png` | It most resembles a 2000s-era Holden Monaro coupe (VZ generation), but that's a low-confidence guess: the low-poly model is too generic to pin to one make and generation.  | no | no |
| `lod2-rear.png` | Rear view of a low-poly orange sedan with wide red tail lamps and a small lip spoiler. It most resembles a **Holden Commodore VE/VF sedan**, though the match is loose.  | no | yes |
| `lod2-side.png` | It doesn't match one specific production car. It reads as a generic 1980s wedge sports coupe, closest to a Lotus Esprit (S2/S3 era) or a Mazda RX-7 (FC).  | no | no |
| `lod2-top.png` | Can't pin it to a specific make, model and generation from a plan view alone. It reads as a boxy 1970s–80s coupe or hatch, roughly in the Holden Torana or Ford XB Falcon family, but that's a low-confidence guess.  | no | yes |

## What this says, and what was tried

1. **The model knows the AU Falcon.** Calibration (generated with Muse Image, never committed, logged in `art/ui/frames/ledger.jsonl` as `au-calib` and `au-calib-lp`): a generated photograph of "a 2001 Ford AU Falcon XR6" was named "Ford Falcon AU (1998-2002) XR6 sedan" by this model. But that picture carries the blue Ford oval, an "XR6" badge and a number plate; the brand marks are in the picture and R81 forbids them here.
2. **A faithful stylised redraw is half-recognised.** The same photograph redrawn by Muse Image as a flat-shaded low-poly orange render (no text, no badges) was named an AU Falcon in 2 of 3 attempts ("Ford Falcon AU (1998-2002)", "Ford Falcon (AU/BA)") and a Commodore in the third. What those pictures keep: real proportions (a long flat bonnet, a tall upright glasshouse), a pair of round lamps in a bulging guard pod, a wide slatted grille across the bonnet's front edge, a low wide bumper with a big black intake.
3. **A caricature is not.** The caricature sheets (the first sheet, small round "smiley" grille and teardrop lamps; the second, lamp pods with a grille oval) were named Datsun GO, Ford Ka, Ford Focus, Ford Mondeo, Subaru Impreza and Mitsubishi Lancer, never an AU. The reference sheet this car is built to was named a Holden Commodore, a Mitsubishi Lancer, a Ford Mondeo or a Daewoo in about 35 attempts on crops of the candidate sheets alone (hero, front, side and rear crops of nine sheets; before any 3D model existed for them). So the shortfall starts in the concept the sheets give, and is not only the model's fidelity to them.
4. **The 3D model loses more.** At the poly budget the model reads as "an Australian-sedan-shaped orange car with two small lamps each side" (Commodore), and the side and top views, which carry no face, read as any 1990s sedan (Lancer, RX-7, MR2, Escort). Its IoU against the sheet is 0.949 / 0.947 / 0.945, so the silhouette matches the sheet; the sheet itself is what does not say Falcon.
5. **What would plausibly move it (not done; each needs an owner call):** (a) a blank oval grille plate or badge shape (the Ford oval is the strongest Falcon cue the model has; a plain oval is borderline under R81); (b) a larger, more literal AU: the real car's bonnet crease, the XR6's lower body kit and the boot-lid spoiler as the photograph has them, at a higher LOD0 budget than the 3000 qualified; (c) a different recognition bar: a model told "Australian family sedan" would pass, an unprompted one does not; (d) context in the in-game view (a Falcon-coloured car on an Aussie road tells a model more than a grey backdrop).
6. **Side and top views are structurally weak:** a roof, a bonnet and a boot say nothing about a make. Even the generated photograph, cropped to its side or roof, would not be named. That 90 % bar over seven angles including the top is the hardest part of this acceptance item.
