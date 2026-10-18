# P1-V-au-hawk recognition receipt (br-bwju.12): would a minimal-reasoning vision model name this car an AU Falcon?

**Result: NOT MET, and the measure itself is unstable.** Round 3 raised this car's LOD1/LOD2 budgets to 1400/900 (a per-vehicle
override, `vehicle.json` `triBudgetOverride`) to carry the round body to the far tiers. In the receipt (3 calls per image, final
model, commit of this file) an AU Falcon or a Ford Falcon is named in **7/15 calls at LOD0, 5/15 at LOD1 and 2/15
at LOD2** on the five bar views (front, both front 3/4s, rear 3/4, rear), and **0/12 in the in-game chase view**; side and top
rarely. The target was 90 % across calls.

Two measurements below matter more than any single number:
1. **Drift.** The same 15 bar-view images (round 3, before the final lamp change) were named a Falcon in **33 of 45** calls in one
   window and **12 of 45** an hour later (`recognition-answers-drift.tsv`). Identical pixels; the model's answers moved. A rate
   from one window can't be compared with another window's: every comparison below is interleaved (both variants asked in the
   same run).
2. **The budget raise, interleaved against the round-2 LOD1/LOD2 (888 / 596 triangles), 7 calls per image:** LOD1 at 1396
   triangles **9/35** against 888 triangles **15/35**; LOD2 at 892 **4/35** against 596 **0/35**
   (`recognition-answers-lod-raise-compare.tsv`). The raise buys nothing at LOD1 and a little at LOD2. The earlier, sequential
   experiment that suggested it (LOD1 with LOD0's body: 9/21 against 3/21) ran across windows and is not evidence.

## How it was asked

- **Model:** `claude-haiku-5-5`, `claude -p --model claude-haiku-5-5 --effort low --allowedTools Read` (Claude Code CLI on the Mac), one fresh call per image, three calls per image for the receipt (`recognition-answers-au-hawk.tsv`: image, call, answer).
- **Prompt, exactly:** "Look at the image file %s . It is a render of a low-poly game car. What real-world car (make, model and generation) does it look like? Answer in one short line."
- **No hints:** each image is copied to a fresh temp directory as `render.png` (`tools/vehicles/recognition/ask.sh`).
- **Renders:** `tools/vehicles/recognition/render.mjs au-hawk` (the baked GLBs through the game's paint-key material, headless Chromium on eris, software GL, plain grey, the game's orange, 640x640, LOD0-2 x seven views; the camera fits the car's box to the frame) in `recognition/`.
- **Chase:** `tools/vehicles/recognition/chase.mjs` on a web build of this commit (eris, ANGLE/Vulkan on the RTX 2080 Super, 1280x720, the host's comic look and player colour) in `chase/`; every chase view is a rear view from behind and above.
- **A Falcon counts** when the answer names a Ford Falcon (any generation, AU or not) as its match; `score` greps the answer for "falcon", so an answer naming one only as an alternative also counts (rare; read the TSV).

## Receipt, final model (Falcon named / calls)

| View | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| front | 0/3 | 1/3 | 0/3 |
| front 3/4 left | 0/3 | 3/3 | 1/3 |
| front 3/4 right | 2/3 | 0/3 | 0/3 |
| rear 3/4 | 3/3 | 1/3 | 1/3 |
| rear | 2/3 | 0/3 | 0/3 |
| side | 0/3 | 0/3 | 0/3 |
| top | 0/3 | 0/3 | 0/3 |
| chase 1-4 | 0/3, 0/3, 0/3, 0/3 | | |

## Round 3: what changed and what it cost

- **Budgets:** LOD1 888 -> 1396, LOD2 596 -> 892 (LOD0 2586 -> 2906, under its 3000). Both far tiers now carry the tumblehome flank and the
  domed deck, lamp tails over the guards (LOD1), fog lamps (LOD1), round grille and badges.
- **Host cost** (`render.json`, `tools/vehicles/evidence/host-cost.mjs`: the real host page's synthetic mixed grid, 24 cars of which 3 are
  AU Hawks, 1920x1080, WebGL2 on eris's RTX 2080 Super; before = a web build with the round-2 bake, after = this commit; three runs each):
  triangles per frame 1 tile 171,512 -> 174,392 (+1.7 %), 4 tiles 192,974 -> 206,690 (+7.1 %), 24 tiles 1,051,094 -> 1,125,770
  (+7.1 %, about 1,040 per AU per tile); draw calls unchanged (160 / 484 / 2,644). Mean frame time is at the 60 Hz cap at 1 tile
  (16.7 ms) in every run; at 4 tiles 16.7 ms except one "after" run at 32.1 ms (the same reading recurred in an earlier "after"
  run of the previous bake: 2 of 6 "after" runs, 0 of 3 "before"; not explained, the GPU is shared); at 24 tiles before 18.8 / 21.7 / 17.5 ms,
  after 20.4 / 17.9 / 17.5 ms. The triangle counts are exact; the frame times are inside the shared GPU's run-to-run noise.
- **The contract:** `triBudgetOverride` in `vehicle.json` is copied into the sidecar by the bake and checked by `jj-contracts`: one budget per
  LOD, at most 3000 / 1800 / 1200, with a reason of at least ten characters and an approver; without it every car keeps 3000 / 900 / 600.
  Tests: `a_per_vehicle_override_raises_the_budget_when_explained` plus the `tri-budget-override-unexplained` and `-ceiling` fixtures.
- **Lamps on white paint:** a mid-grey reflector bowl inside each lamp (the pale lens alone vanished on `#f2f4f8`). Tried first: a
  blue-grey lens (the front views went from Falcon to Mondeo/Focus in its run) and a dark outline round the lamp (Focus); the reflector
  was asked interleaved against the plain pale lamp: 17/45 against 13/45.
- **The orange sliver** across the LOD0 front-door glass: the side glass is now laid on the greenhouse's own two triangles per span
  instead of a bilinear patch (the span behind the windscreen base is twisted, and the patch let the paint show through).

**Recommendation:** the raise costs 7 % more car triangles at 24 tiles and the interleaved runs show no gain at LOD1 and a small one at
LOD2; I would revert this car to 900 / 600 (the override mechanism can stay for a car that measurably needs it). Left as committed
because it was the coordinator's call to try it.

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

1. The 90 % bar is not met at any LOD in the final receipt; the best single windows reached 15/15 at LOD0 (bar views), but the same images fall to about a third in another window.
2. LOD1/LOD2 budgets: raised as directed; the interleaved measurement doesn't support keeping the raise (above).
3. The chase view (a small red car from behind and above) is rarely named.
4. Side and top: a roof and a profile carry no make.
5. Measured with one model at low effort; a more capable model, or the same model at higher effort, was not tried.
