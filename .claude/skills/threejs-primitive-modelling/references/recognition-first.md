# Recognition first (how to make a stylised model still read as *that* thing)

The lesson from the Cruze: the first two rounds invented a cute car with Cruze-ish details; the owner's steer was "identify the key elements
people recognise, keep them true, tone the flourish down". The method that worked:

## 1. Find the cues (5–8) and rank them
Ask: what would make someone say "is that actually a <thing>?" From a front/side/rear turnaround, typical vehicle cues are: **roofline and
greenhouse shape** (number and shape of side windows), **face** (grille shape + lamp shape + fog/intake arrangement), **tail lamps**, **wheel
design**, **stance/proportion**. Confirm with the owner which ones matter most; a real photo set is better for this than the turnaround.

## 2. Measure them from the reference (no eyeballing)
* Side orthographic → `recog/measure_side.py` (PIL only): metres-per-pixel from the known length, wheel centres, **top silhouette every 5 cm**, and
  the **daylight-opening polygons** by flood-filling the glass grey and hulling. Output: `side_spec.json`.
* Front/rear orthographic → `recog/grid_overlay.py front|rear` draws a 10 cm metric grid; read the lamp corners, grille trapezoid, intake, fog recess
  and plate off the grid (a vision model or a human), and write them as numbers.
* Put both in `recog/spec.js` as `REAL` (metres) and a `MAP` that scales them into the toy's proportions (`sz` length, `sx` width, remaps for fascia heights).
  `TOY` is what the model reads. Exporting `polyY(profile, z)` and the polygons lets the model, the validator and the tests share one truth.

## 3. Build from the spec
* Roof: make the greenhouse loft's centreline top *equal* the measured profile (stations from `polyY`), end stations taper to nothing so it blends in.
* Windows: glass = Coons patch of the measured polygon (top edge, bottom edge, front edge, rear edge), corners softened with `softCorners`. Door skins are
  cut with edge curves parallel to the roofline. Each side gets the same number of lights as the reference.
* Face/tail: each cue is a shape function `(a,b) → (x,y)` from the spec, ray-probed onto the body (`probed`), then rings/beads as tubes along the outline.
* Anything the spec doesn't mention is flourish: keep it small, low-contrast and gated by LOD.

## 4. Guard it
* Geometric gates on the *shipped GLB*: roofline within tolerance at N stations (vertical ray casts, not vertex sampling — coarse LODs have no centreline
  vertices), glass boxes per side vs spec polygons, lamp centres and widths, grille/intake/bar extents from the trim-atlas triangles, proportion ratios
  vs the real subject (wheel radius 1.05–1.5× real = chunky not silly).
* A **silhouette IoU vs the real reference** (orthographic, bbox-normalised so intentional proportion changes are allowed): a regression alarm with threshold =
  measured baseline − margin. And **LOD-vs-LOD silhouette IoU** so tiers don't pop.
* A **recognition sheet** for humans: reference and model side by side, cues named.

## 5. Tolerances that worked
Roofline 0.06–0.15 m by tier; window boxes 0.1–0.17 m; lamp centre 0.09 m; proportions: length 0.75–0.95×, height 0.95–1.1×, wheelbase/length 0.9–1.15×.

## 5. Round 4 lessons (recognition still missing after the measured build)
* **Compare against real photos at matched camera angles, not just image-generated orthographics.** Generated orthos can mis-draw cues (ours drew the tail
  lamps as angular wedges; the real car has chrome-ringed bulls-eyes). Build a capture script that renders the same named views (front 3/4, rear 3/4, side,
  the game's chase cam) and a composer that puts the real photo row on top of every variant row.
* **Look for identity accessories in every photo the owner has** (film shots, odd angles). A lightbar and a UHF whip are worth more recognition per triangle
  than any panel detail, and a thin vertical whip is a silhouette cue at every LOD.
* **A dark greenhouse band beats window shapes.** Gloss-black pillars/surrounds make the glass read as one graphic; body-colour pillars make it a slab on a roof.
* **Put every new cue behind an opt-in flag first**, keep the default bake byte-identical (hash the GLBs before and after), and report triangle cost per cue at
  the gameplay LOD so the owner picks by recognition-per-triangle. Tier each cue by LOD (torus/sphere at LOD0, stacked flat discs at LOD1, off below).
* **Thin coplanar patches on a wobbly shell tear.** Lift frames/strips 1-2 cm above the skin, densify them, and prefer matte over satin for black trim
  (satin catches the key light and shows as a bright sliver).
