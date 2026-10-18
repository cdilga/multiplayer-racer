# P1-V-au-hawk recognition receipt, round 2 (br-bwju.12): would a minimal-reasoning vision model name this car an AU Falcon?

**Result: met at LOD0 from the front, both front 3/4s, the rear 3/4 and the rear; NOT met at LOD1, LOD2 or in the in-game chase
view, and not from the side or the top.** In the receipt below (one call per image), an AU Falcon or a Ford Falcon is the first answer
in 14 of 25 images: LOD0 5 of 7 (5 of 5 for front, both front 3/4s, rear 3/4, rear), LOD1 4 of 7, LOD2 4 of 7, chase 1 of 4.
The bar was 90 % at every LOD from front, 3/4 front, rear 3/4 and rear: that is 5/5 at LOD0, 3/5 at LOD1, 3/5 at LOD2. Round 1 was
0 of 25. Single calls are noisy (below), so the repeated-sampling numbers in "Variance" are the better estimate of where it stands.

## How it was asked (unchanged from round 1 except the framing)

- **Model:** `claude-haiku-5-5`, `claude -p --model claude-haiku-5-5 --effort low --allowedTools Read` (Claude Code CLI on the Mac), one fresh call per image.
- **Prompt, exactly:** "Look at the image file %s . It is a render of a low-poly game car. What real-world car (make, model and generation) does it look like? Answer in one short line."
- **No hints:** each image is copied to a fresh temp directory as `render.png` (`tools/vehicles/recognition/ask.sh`).
- **Renders:** `tools/vehicles/recognition/render.mjs <id>` (the baked GLBs through the game's paint-key material, headless Chromium on eris, software GL, plain grey, the game's orange, 640x640; LOD0-2 x front, front 3/4 left and right, side, rear 3/4, rear, top) in `recognition/`.
  **Changed in round 2:** the camera now fits each car's bounding box to the frame (`view.js`, FILL 0.92) instead of standing a fixed 8.4 / 9.2 m away. The fixed distance cut the 5 m round-2 body's nose off at 3/4 views; the control was re-rendered with the same tool.
- **Chase:** `tools/vehicles/recognition/chase.mjs` on a web build of this commit (eris, ANGLE/Vulkan on the RTX 2080 Super, 1280x720, the host's comic look and its player colour, red). Every chase view is a rear view from behind and above.
- **Commit the renders come from:** bd5b41dd (model f99ac37c), baked at 2586 / 888 / 596 triangles. The tree: `git archive` of that commit plus its LFS files, on eris (`/tmp/auhawk3`).

## Step 1: the concept, checked before modelling

Round 1 found the shortfall starts in the sheet, so round 2 regenerated it as a literal series-1 AU (prompts in `art/vehicles/au-hawk/refs/prompts/round2/`, every call in `art/ui/frames/ledger.jsonl`, chain in `refs/sheets.json`):

1. A calibration photograph of a real 1998 AU Futura (Muse Image; it carries Ford badges and a plate, so it was only used as the next step's reference and is not committed). Muse drew the XR-style lamp pods, not the base car's teardrops.
2. That photo redrawn as a flat-shaded orange low-poly render, twice: (A) as photographed, (B) with the base AU face: swept teardrop lamps, the oval fish-mouth grille, one body-colour bar, a **plain blank oval badge**. Both named an AU Falcon 3 of 3 (the blank oval reads as Ford, the model even calls it "the blue-oval badge"). B was taken: it is the face the owner's direction names.
3. Turnaround sheets from B in the Hawk Dash sheet's layout (4 sheets). Crops: hero 4/4 AU Falcon, side 4/4, top 2/4, front 1/4 (Taurus, Focus), rear 0/4 (Commodore, Accord: a full-width lamp band across the boot).
4. The rear redrawn (rounded corner lamps, the plain oval on the boot lid, no band): rear 4/4, hero 4/4; front still 0/4 (Taurus, Puma, Mondeo, Focus).
5. The face widened and clarified: front still Taurus 3/4, Mondeo 1/4; hero 4/4, rear 4/4. Sheet 4 (`lod-plus-1.png`) was chosen.
   A straight-on front is the weak view even for the sheet: the AU's face shares its oval language with the Taurus of the same years. An XR6-face variant (lamp pods) did no better (front: Puma, Falcon AU, Mondeo).
6. `lowest-lod.png` from it: front, hero, rear and side crops all named a Falcon AU (front "Ford Falcon (AU-style)", side "Ford AU Falcon sedan").

The chosen sheets' own answers: lod-plus-1 hero "1999-2002 Ford AU Falcon", rear "Ford Falcon AU sedan (1998-2002)", front "1996-1999 Ford Taurus"; lowest-lod front "Ford Falcon (AU-style)", hero "Ford AU Falcon", rear "Ford Falcon (AU-era) sedan", side "Ford AU Falcon sedan".

## Step 2: what moved the 3D model (development runs, `score.sh`-style: the same prompt, 2-3 calls per image)

- The first round-2 build (IoU 0.964) was named an AU Falcon in 0 of 21: a Subaru WRX, a Holden Commodore, a Datsun GO. The fixed camera cut its nose off (see above).
- Bigger, paler teardrop lamps with a swept tail over the guard, a wider fish-mouth grille with a full-width bar, a lower belt and taller side glass: 3-7 of 21.
- Asked why, the model said the 3/4 front read as a **ute**: the sheet's raised wing on its posts and the low flat deck behind the backlight looked like a tray and its tailgate. Removing the wing (the base AU has none) and raising the boot deck took LOD0's front 3/4s to Falcon.
- A blunter tail with bigger, darker corner lamps took the rear views to Falcon.
- The single biggest factor is the **body's roundness**: LOD1 with LOD0's body resolution (stations and the tumblehome ring point) was named a Falcon in 9 of 21 calls against 3 of 21 for the budget LOD1 (888 tris); its wheels at LOD0 resolution made no difference (1 of 21).
- A denser LOD0 (2802 tris: 11 arch samples, 5 nose stations) scored worse than 2586 (front 3/4 left "Nissan Maxima" three times), so density is not monotonic.

### Variance

The same images asked again give different answers. The LOD0 renders of the final model, asked three times each (development run q2, same model): front 3/3, front-left 3/3, front-right 2/3, rear-left 3/3, rear 3/3, side 0/3, top 1/3, so **14 of 15 (93 %) on the five bar views at LOD0**. LOD1 and LOD2 in the same run: 5 of 42 (front 2/3, front-right 2/3; rear-left LOD2 1/3; the rest 0). The single-call receipt below is luckier for LOD1 and LOD2 than that run; read it as "LOD1/LOD2 are sometimes named a Falcon", not as 4 of 7.

## Summary of the receipt by view (first answer)

| View | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| front | AU Falcon | AU Falcon | other (Commodore VE) |
| front 3/4 left | AU Falcon | AU Falcon | other (Impreza) |
| front 3/4 right | AU Falcon | other (Commodore VE) | AU Falcon |
| rear 3/4 | AU Falcon | AU Falcon | AU Falcon |
| rear | AU Falcon | other (350Z) | Ford Falcon (BF) |
| side | other (Camry) | AU Falcon | other (Eclipse) |
| top | other | other | Ford Falcon (XD) |
| chase 1-4 | other, AU Falcon, other (350Z), other (Silvia) | | |

## Did the AU need more than the LOD0 ceiling? No: LOD1 and LOD2 do

LOD0 meets the bar at 2586 triangles, under the qualified 3000, and more did not help (2802 scored worse). The gap is at LOD1 (900) and LOD2 (600): measured, LOD1 at 1442 triangles with LOD0's body is named a Falcon about three times as often as at 888 (9 of 21 against 3 of 21), and LOD2 at 596 has no room for the tumblehome at all. A higher **LOD0** level would not change that; meeting the bar at the far tiers would need LOD1 at roughly 1400 and LOD2 at roughly 900, which is the owner's call (they are budgets for 24 cars x 24 tiles). No extra LOD level was added.

## Control: the Hawk Dash (FG Falcon Sprint caricature), same model, prompt, renders and chase

A Falcon is the first answer for the control in 5 of 25 (round 1: 0 of 25): an AU Falcon from LOD0 front-left, LOD0 rear-left, LOD1 rear-left and LOD2 rear, a 1970s XB Falcon from the top. The Hawk Dash is itself a Falcon (FG Sprint) caricature with the same sedan body family, so a Falcon read is not wrong for it; mostly it is named a Mustang (12 of 25). The fitted framing shows both cars larger than round 1's fixed camera did, which helps both. The AU's 14 of 25 against the control's 5 of 25 is the margin the AU's own cues buy.

| Image | First answer = AU Falcon / Ford Falcon? | Answer (verbatim) |
|---|---|---|
| `chase-1.png` | no | Looks like a **Ford Mustang coupe, S197 generation (2005–2009)**, with Shelby-style stripes; low confidence, since it's a low-detail rear view. |
| `chase-2.png` | no | Looks most like a **2005–2009 Ford Mustang (S197), in Shelby GT500 livery**: red body with black centre stripes, from a rear three-quarter view. |
| `chase-3.png` | no | Most likely a 2015–2023 Ford Mustang (S550 generation) in Shelby GT350/GT500 style, judging by the red paint, twin black racing stripes and quad exhausts. It's a low-confidence call from a rear three-quarter view. |
| `chase-4.png` | no | Closest match is a 2015-2017 Ford Mustang (S550 generation), though the low-poly rear view is ambiguous and could also suggest a Holden Commodore or Ford Falcon. |
| `lod0-front-left.png` | AU Falcon | Closest match is a Ford Falcon AU-series four-door sedan (2000–2002), dressed up as a performance model with a rear wing, though the stylised body makes it approximate. |
| `lod0-front-right.png` | no | It looks like a stylised 2010s Ford Mustang GT-style sedan, though it's a low-poly approximation, so the match is loose. |
| `lod0-front.png` | no | A front-on view of an orange car with twin black stripes, hood vents and a wide bar grille, most like a **Ford Mustang S550 (2018–2020 facelift)**, styled like a Shelby GT350. It's a best guess from the front alone. |
| `lod0-rear-left.png` | AU Falcon | Closest match is a **Ford Falcon AU (2000–2002) four-door sedan**, though the wrap-around tail lamps and rear spoiler also suggest a Holden Commodore VX/VY. |
| `lod0-rear.png` | no | It looks like a BMW M3 (G80 generation, 2021 onward), going by the rear light shape, twin-stripe livery and quad-outlet diffuser. |
| `lod0-side.png` | no | Closest match is a **Mitsubishi Lancer Evolution VII–IX (CT9A-era) sedan**, with a Nissan Skyline R33 4-door as the runner-up. |
| `lod0-top.png` | no | Best guess: a 1970s Lamborghini Countach LP400 (low confidence, since the top-down view hides the wedge profile). |
| `lod1-front-left.png` | no | It looks loosely like a modern Ford Mustang (S550-era) in a stylised, body-kit form, with a large rear wing and racing stripes. The fastback-style roofline and the oval-ish grille suggest it's a caricature, so the match is approximate. |
| `lod1-front-right.png` | no | Loosely resembles a 2015–2017 Ford Mustang (S550) coupe, though the low-poly simplification makes it a low-confidence match. |
| `lod1-front.png` | no | Looks like a Ford Mustang S550 (2015–2017 generation), styled like a Shelby GT500 with the dual racing stripes, hood vents and front splitter. The front-end shape is the strongest clue, so treat the exact model year as a guess. |
| `lod1-rear-left.png` | AU Falcon | Looks like a Ford Falcon AU-series sedan (around the 2000–2002 BA/BF generation), with a boot-lid spoiler and wrap-around tail lamps. Confidence is moderate, since the low-poly model loses fine detail. |
| `lod1-rear.png` | no | It looks like a 2021+ BMW M3 (G80) or M4 (G82), judging by the twin vertical kidney grille, angular lamps and black lower bumper with square fog lamps. |
| `lod1-side.png` | no | It looks loosely like a 1989–1994 Nissan Skyline R32 GT-R coupe, though the wide arches and blocky shapes make that a rough match. |
| `lod1-top.png` | no | Looks most like a 1970s Dodge Challenger (E-body), judging by the twin racing stripes and the top-down profile. Low confidence, since the render is top-down only. |
| `lod2-front-left.png` | no | It most resembles a 2015–2017 Ford Mustang (S550), with its racing stripes and fastback roofline, though it's a loose caricature, so the match is moderate. |
| `lod2-front-right.png` | no | It most closely resembles a 2015–2017 Ford Mustang (S550), though the match is loose: it's a stylised low-poly car, and the grille and stripes are more generic than a real Mustang's. |
| `lod2-front.png` | no | Looks like a 2015–2017 Ford Mustang (S550), judging by the front-end shape, headlights and racing stripes. The low-poly front view makes the exact generation a guess. |
| `lod2-rear-left.png` | no | It looks most like a 2010–2015 (fifth-gen) Chevrolet Camaro coupe, though the low-poly simplification makes that a loose match. |
| `lod2-rear.png` | AU Falcon | Closest real-world match is a mid-2000s Ford Falcon (AU/BA generation), though it's a loose caricature and the front-view evidence is thin. |
| `lod2-side.png` | no | Closest match is a Mazda RX-7 (second generation, FC, 1986–1991), though the stylised low-poly form makes that a loose resemblance. |
| `lod2-top.png` | Ford Falcon | Closest match is a 1970s Ford Falcon XB GT-style muscle coupe, though a top-down view alone makes that a low-confidence call. |


## Every answer for the AU Hawk

| Image | First answer = AU Falcon / Ford Falcon? | Answer (verbatim) |
|---|---|---|
| `chase-1.png` | no | I can't identify a specific make, model or generation from this render. It's a rear view of a generic red low-poly hatchback or small sedan with no badge or distinctive feature, so any real-car name would be a guess. |
| `chase-2.png` | AU Falcon | Closest match is a late-1990s Ford Falcon AU-series sedan, though at this low-poly detail it could also pass for a Holden Commodore VS. |
| `chase-3.png` | no | It looks most like a **Nissan 350Z (Z33) coupe**, seen from the rear, though the low-poly abstraction makes that a rough match. |
| `chase-4.png` | no | Closest match is a late-1990s Nissan Silvia S15 (200SX) coupe, though the rear-only view makes that a low-confidence guess. |
| `lod0-front-left.png` | AU Falcon | Ford Falcon AU (1998–2002) sedan, judging by the oval grille with the bar and the teardrop headlamps. |
| `lod0-front-right.png` | AU Falcon | Looks like a **Ford Falcon AU (2000–2002) four-door sedan**, going by the body shape and the oval grille with bar, though the low-poly model makes the exact generation hard to pin down. |
| `lod0-front.png` | AU Falcon | It looks like a 2000s-era Ford Falcon (AU-style) sedan, the front end resembling the BA/BF generation, though the low-poly model is loose enough that this is a guess. |
| `lod0-rear-left.png` | AU Falcon | A boxy four-door sedan like the **Ford Falcon AU (1998–2002)**, though the low-poly model is loose enough that it could also pass for an EL Falcon. |
| `lod0-rear.png` | AU Falcon | Looks like a Ford Falcon AU sedan (2000–2002), going by the wraparound tail lamps, the tall rounded boot and the oval boot badge. It's a low-poly rear view, so treat that as a best guess. |
| `lod0-side.png` | no | Closest match is a late-1990s/early-2000s compact four-door sedan, like a Toyota Camry or Honda Accord, though the low-poly model and side-only view make it a loose resemblance. |
| `lod0-top.png` | no | Can't identify it confidently from this top-down view; it reads as a boxy 1990s-style hatchback, roughly Mazda 323 or Ford Laser territory, but that's a low-confidence guess. |
| `lod1-front-left.png` | AU Falcon | It looks like a **Ford Falcon AU sedan (1998–2002)**, based on the four-door body, the oval grille with a bar, and the teardrop headlamps. It's a low-poly interpretation, so the match is approximate. |
| `lod1-front-right.png` | no | It looks like a late-2000s Holden Commodore VE-style sedan (or similar Aussie four-door sedan), in orange with a fish-mouth grille. |
| `lod1-front.png` | AU Falcon | It looks like a 2000–2002 Ford Falcon AU (Australian-market sedan), going by the oval grille with centre badge and the hooded headlamps. |
| `lod1-rear-left.png` | AU Falcon | Closest match is a Ford Falcon AU sedan (1998–2002), though the low-poly model is loose enough that it could also pass for a Holden Commodore VT. |
| `lod1-rear.png` | no | Probably a 2003–2005 Nissan 350Z (Z33), though it's a low-confidence guess from a rear-only low-poly view. |
| `lod1-side.png` | AU Falcon | Closest match is a 1998–2002 Ford AU Falcon sedan, though the render is too low-poly to be certain. |
| `lod1-top.png` | no | Can't pin it down from this top-down view; the closest is a boxy 1970s-era coupe, possibly a Holden Torana, but that's low confidence without a side or front view. |
| `lod2-front-left.png` | no | It looks like a low-poly orange Subaru Impreza sedan (roughly the 2000s WRX/Impreza-era shape), though the render is generic enough that it could just as easily be read as a Toyota Corolla-style sedan. |
| `lod2-front-right.png` | AU Falcon | Most like a early-2000s Ford Falcon (AU/BA-era) four-door sedan, though the low-poly form is loose enough that it could also pass for a Holden Commodore. |
| `lod2-front.png` | no | Looks like a Holden Commodore VE/VF (2006–2017) from the front: the oval-ish grille with a bar and blank badge, and the rounded headlights fit that generation. It could also pass for a Ford Falcon FG, so this is a low-confidence call from a low-poly front view. |
| `lod2-rear-left.png` | AU Falcon | It looks most like a 2000–2002 Ford Falcon AU sedan, though the low-poly shape makes a Holden VT Commodore an equally plausible read. |
| `lod2-rear.png` | Ford Falcon | Looks most like a 2006–2008 Ford Falcon BF or a Holden Commodore VE from the rear, though a view this low-poly can't pin the exact generation. |
| `lod2-side.png` | no | It most resembles a 1990s-era sporty three-door coupe, roughly a 2G Mitsubishi Eclipse or Honda Prelude, though the low-poly shape doesn't pin down the exact make, model or generation. |
| `lod2-top.png` | Ford Falcon | Looks like a boxy 1980s sedan, most like a Ford Falcon (XD/XE-era), though a top-down view makes it hard to confirm. |


## What's left, honestly

1. **LOD1, LOD2 and the chase view** are under the bar. The chase camera looks down on a small red car from behind; it got "AU Falcon" once in four. Recognition there tracks the body's roundness, which costs triangles the LOD1/LOD2 budgets don't have (measured above).
2. **Side and top** are rarely named (Camry, Eclipse, a boxy hatch): a roof and a profile carry no make. The sheet's own side crop was named an AU 4 of 4, so the side is the weakest place where the model trails its sheet.
3. **A straight-on front** is named a Falcon at LOD0 and LOD1 but a Commodore or a Taurus-family Ford elsewhere; the sheet itself was named a Taurus from the front.
4. The plain oval badge is the strongest single cue (the model calls it Ford's blue oval although it is a blank grey oval). It carries no lettering, colour or brand mark; R81's call on whether a blank oval is acceptable is the owner's.
5. Recognition measured with one model (`claude-haiku-5-5`, low effort) only.
