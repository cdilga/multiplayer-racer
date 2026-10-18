# P1-V-au-hawk recognition receipt (br-bwju.12): would a minimal-reasoning vision model name this car an AU Falcon?

**Result: the automated bar (90 % of renders at every LOD and angle, chase included) is NOT met, and it can't be the judge.** The
shipped bake (2906 / 896 / 600 triangles, the standard 3000 / 900 / 600 budgets) is named a Falcon most of the time from LOD0's front
3/4 and rear 3/4 views in good windows, but not reliably at LOD1 or LOD2, nor from the side, the top or the in-game chase view.
And the measure itself drifts: the same images swing between runs. **Recognisability is therefore the owner's call** (the bead's
[ev:owner] criterion, the "AU Hawk" row in docs/playtests/owner-checklists.md section 2).

The numbers that support that summary:
1. **This bake's receipt** (3 calls per image, `recognition-answers-au-hawk.tsv`): a Falcon is named in 6/15 calls at LOD0,
   3/15 at LOD1 and 1/15 at LOD2 on the five bar views, 0/12 in the chase view (table below). LOD0's rear 3/4 is 3/3 and its
   front 3/4 right 2/3; its front 3/4 left, which was 3/3 in the round-2 receipt and 15/15 bar views in round 3's best window, is 0/3 here.
2. **Drift.** The same 15 bar-view images were named a Falcon in **33 of 45** calls in one window and **12 of 45** about an hour later
   (`recognition-answers-drift.tsv`). Identical pixels. Rates from different windows can't be compared; comparisons below were
   asked interleaved.
3. **Raising this car's far-LOD budgets was tried and measured (round 3), then reverted.** A per-vehicle override (`triBudgetOverride`
   in vehicle.json, the sidecar and jj-contracts, with fixtures and a test; commit d87401d5) took LOD1/LOD2 to 1396 / 892 triangles
   with LOD0's round body. Interleaved against the 888 / 596 bake, 7 calls per image: **LOD1 9/35 at 1396 against 15/35 at 888;
   LOD2 4/35 at 892 against 0/35 at 596** (`recognition-answers-lod-raise-compare.tsv`), for **+7.1 % triangles per frame at 24 tiles**
   (1,051,094 to 1,125,770, draws unchanged; `render.json`, `tools/vehicles/evidence/host-cost.mjs`, 3 AU Hawks in a 24-car mixed grid).
   No gain at LOD1, so the bake is back on 900 / 600 and the override was removed (no car used it; it can come back with evidence).
   Kept from round 3: the side glass laid on the greenhouse's own triangles (no orange sliver), grey reflector bowls in the lamps
   (readable on white paint), the LOD1 lamp lift, and the recognition renders' fitted framing.

## How it was asked

- **Model:** `claude-haiku-5-5`, `claude -p --model claude-haiku-5-5 --effort low --allowedTools Read` (Claude Code CLI on the Mac), one fresh call per image, three calls per image for the receipt (`recognition-answers-au-hawk.tsv`: image, call, answer).
- **Prompt, exactly:** "Look at the image file %s . It is a render of a low-poly game car. What real-world car (make, model and generation) does it look like? Answer in one short line."
- **No hints:** each image is copied to a fresh temp directory as `render.png` (`tools/vehicles/recognition/ask.sh`).
- **Renders:** `tools/vehicles/recognition/render.mjs au-hawk` (the baked GLBs through the game's paint-key material, headless Chromium on eris, software GL, plain grey, the game's orange, 640x640, LOD0-2 x seven views; the camera fits the car's box to the frame) in `recognition/`.
- **Chase:** `tools/vehicles/recognition/chase.mjs` on a web build of this commit (eris, ANGLE/Vulkan on the RTX 2080 Super, 1280x720, the host's comic look and player colour) in `chase/`; every chase view is a rear view from behind and above.
- **A Falcon counts** when the answer names a Ford Falcon (any generation, AU or not) as its match; `score` greps the answer for "falcon", so an answer naming one only as an alternative also counts (rare; read the TSV).

## Receipt, the shipped bake (Falcon named / calls)

| View | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| front | 0/3 | 1/3 | 0/3 |
| front 3/4 left | 0/3 | 1/3 | 0/3 |
| front 3/4 right | 2/3 | 0/3 | 0/3 |
| rear 3/4 | 3/3 | 1/3 | 1/3 |
| rear | 1/3 | 0/3 | 0/3 |
| side | 0/3 | 1/3 | 0/3 |
| top | 0/3 | 0/3 | 0/3 |
| chase 1-4 | 0/3, 0/3, 0/3, 0/3 | | |

## Round 3, measured and reverted

- Budgets LOD1 888 to 1396, LOD2 596 to 892 under `triBudgetOverride` (ceiling 3000 / 1800 / 1200, a reason and an approver required).
- Host cost (`render.json`; 1920x1080, WebGL2 on eris's RTX 2080 Super, 24 synthetic cars of which 3 AU Hawks, three runs each):
  triangles per frame 1 tile 171,512 to 174,392 (+1.7 %), 4 tiles 192,974 to 206,690 (+7.1 %), 24 tiles 1,051,094 to 1,125,770 (+7.1 %);
  draw calls unchanged (160 / 484 / 2,644); frame times inside the shared GPU's run-to-run noise (24 tiles: before 18.8 / 21.7 / 17.5 ms,
  after 20.4 / 17.9 / 17.5 ms; two of six "after" runs read 32 ms at 4 tiles, unexplained).
- Recognition: interleaved, no gain at LOD1 (9/35 against 15/35), a small one at LOD2 (4/35 against 0/35). Reverted; override removed.
- Lamps on white paint: a blue-grey lens and a dark outline both turned the front views to Mondeo/Focus in their runs; the grey
  reflector bowl, asked interleaved against the plain pale lamp, scored 17/45 against 13/45 and was kept.

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


## Round 2: what moved the 3D model (sequential development runs, so subject to the drift above)

- The first round-2 build (IoU 0.964) was named an AU Falcon in 0 of 21: a Subaru WRX, a Holden Commodore, a Datsun GO. The fixed camera cut its nose off (now fitted).
- Bigger teardrop lamps with tails over the guards, a wider fish-mouth grille with a full-width bar, a lower belt and taller side glass: 3-7 of 21.
- Asked why, the model said the 3/4 front read as a **ute** (the sheet's wing on posts and the flat deck looked like a tray and tailgate): no wing, a higher boot deck.
- A blunter tail with bigger, darker corner lamps took the rear views to Falcon.
- The plain oval badge is the strongest single cue (the model calls it Ford's blue oval although it is a blank grey oval; R81's view on a blank oval is the owner's).
- A straight-on front is a Ford, but which Ford is close to a coin toss (Falcon AU, Focus, Mondeo, Taurus, Ka): the AU shares the oval language of the Fords of its years; the reference sheet itself was named a Taurus from the front.

## Control: the Hawk Dash (FG Falcon Sprint caricature), same prompt, renders and chase

One call per image, asked in the round-3 window (`recognition-answers-control-hawk-dash.tsv`): a Falcon is named as the match in 0 of
25 (one chase answer mentions "Ford Falcon-style" beside a Commodore and declines to choose); it is mostly a Mustang (11), a Subaru
WRX STI, a Lancer Evolution or a BMW M3. The prompt and renders don't push every orange sedan towards "Falcon".

| Image | Answer (verbatim) |
|---|---|
| `chase-1.png` | Looks like a stripe-liveried **Ford Mustang, roughly the S197 (2005–2014) or S550 (2015–2023) generation**, going by the rear-view profile and twin racing stripes. I can't pin the generation from this low-detail render. |
| `chase-2.png` | Looks like a 2015–2020 Ford Mustang (S550, 6th generation) with twin racing stripes, though the low-poly rear view makes the exact generation a best guess. |
| `chase-3.png` | It looks like a red, late-2010s/2020s Ford Mustang Shelby GT500-style muscle car, with black racing stripes, a rear spoiler and quad exhausts, though the low-poly model is loose enough that the exact generation is a guess. |
| `chase-4.png` | It looks like a 2010s-era Holden Commodore VF/VE-style sedan or the Ford Falcon-style rear... I'd rather not guess blindly, so here's my best read.  The render is a red, low-poly car seen from behind with a black racing stripe, a wide rear light bar with red tail lamps, and a dark roof and glass. That reads most like a **Ford Mustang (S197/S550-era fastback) with a Shelby-style stripe**, though the proportions are closer to a generic muscle coupe than any single exact generation. |
| `lod0-front-left.png` | Looks like a 2008–2014 Subaru Impreza WRX STI (GR/GV generation) sedan, based on the four-door body, rear wing and hood-stripe styling. It's a low-poly interpretation, so the match is approximate. |
| `lod0-front-right.png` | It looks like a 2010s-era Subaru WRX STI-style sedan (fourth-gen-ish body), with the rear wing, hood scoop vents and front bumper intake. |
| `lod0-front.png` | It looks like a low-poly orange Ford Mustang (S550 generation, 2015–2017 facelift) with black racing stripes, though the stylised form makes that a best guess. |
| `lod0-rear-left.png` | It looks like a low-poly, Mitsubishi Lancer Evolution-style sports sedan (roughly 2008–2015 era, e.g. the Lancer Evolution X), though the body shape is generic enough that it's a loose resemblance rather than a confident match. |
| `lod0-rear.png` | It looks like a low-poly take on a BMW M3 (G80 generation, 2021+), based on the quad round taillights, twin exhausts in the rear bumper, and the rear-deck spoiler. |
| `lod0-side.png` | It most resembles a Nissan Skyline R34 GT-R (fourth-generation, R32–R34 era), with its sedan body, rear wing and five-spoke wheels, though the low-poly build makes it a loose match. |
| `lod0-top.png` | Closest match: a 1970s–80s mid-engine wedge like the Lamborghini Countach (LP400 generation), though a top-down view makes that a low-confidence call. |
| `lod1-front-left.png` | Closest match: a Mitsubishi Lancer Evolution (roughly the Evo IX/X generation), though it's a stylised model, so the match is loose. |
| `lod1-front-right.png` | Loosely a 2015–2017 Ford Mustang (S550) coupe, with racing stripes and a rear wing, though it's a stylised caricature rather than an exact match. |
| `lod1-front.png` | It looks like a **Ford Mustang S550 (2015–2020)**, probably a Shelby GT500-style car, judging by the twin hood stripes, hood scoops and front splitter. |
| `lod1-rear-left.png` | Closest match is a 2008-2014 Subaru Impreza WRX STI sedan (GD/GR generation), though this is a low-confidence guess from a stylised low-poly render. |
| `lod1-rear.png` | BMW M3 / M4 of the G80/G82 generation (2021 onward), going by the tall twin-kidney grille with vertical slats and the angular red headlights. |
| `lod1-side.png` | It looks most like a Nissan Skyline R32 GT-R (second generation, 1989–1994): the fastback coupe profile, short overhangs and the rear wing read as R32-era. |
| `lod1-top.png` | Closest match is a late-1960s American muscle coupe, such as a 1969 Dodge Charger or Chevrolet Camaro, though the top-down view makes the exact make and generation uncertain. |
| `lod2-front-left.png` | It most loosely resembles a 2015–2017 Ford Mustang (S550) with racing stripes, though the low-poly simplification makes the match approximate. |
| `lod2-front-right.png` | Looks most like a stylised **Ford Mustang** (S550-era fastback coupe, with the hood stripes and grille), though the low-poly simplification makes the exact generation a guess. |
| `lod2-front.png` | It looks like a **Ford Mustang (S550, 2015–2017 facelift era)**, judging by the twin racing stripes, the horizontal-bar grille and the sloped headlights, though this low-poly front view is ambiguous enough that it could also be a Shelby GT350/GT500-style variant. |
| `lod2-rear-left.png` | Closest match: a 1993–2002 Chevrolet Camaro (4th generation), though the low-poly simplification makes it a loose match. |
| `lod2-rear.png` | Closest match is a 2015–2017 Ford Mustang (S550), though the low-poly front view makes this a low-confidence guess. |
| `lod2-side.png` | It most closely resembles a 1980s Mazda RX-7 (FB generation), in a stylised, wedge-shaped, rear-spoiler form. |
| `lod2-top.png` | Most likely a 1968–70 Dodge Charger (second generation), though the top-down view makes it a low-confidence guess. |

## What's left, honestly

1. The 90 % automated bar is not met at any LOD; the best single windows reached 15/15 at LOD0 (bar views), but the same images fall to about a third in another window. The owner's verdict in a preview is the recognition criterion.
2. LOD1/LOD2 at the standard budgets don't carry LOD0's round body (no tumblehome at LOD2); raising them was tried and didn't help LOD1 (above).
3. The chase view (a small car from behind and above, in the player's colour) is rarely named.
4. Side and top: a roof and a profile carry no make.
5. Measured with one model at low effort; a more capable model, or the same model at higher effort, was not tried.
