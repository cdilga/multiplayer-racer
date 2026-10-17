# Art pipeline learnings (append-only)

## 2026-10-03 · `codex exec` image generation is unavailable on the ChatGPT account (P1-U01)

- `gpt-6.1-sol` (the configured default), `gpt-6-astra` (which made `art/style/refs/*`), `gpt-6` and
  `gpt-6.1` are refused with "not supported when using Codex with a ChatGPT account". `gpt-6-luna`,
  `gpt-5.6-terra` and `gpt-5.6-luna` run, but their exec sessions have no built-in `image_gen` tool. The
  imagegen skill's CLI fallback needs `OPENAI_API_KEY` (billed), so it needs the owner's approval.
- The models the account offers are cached in `~/.codex/*model*`. `codex exec -i <file>` takes several
  values, so end the image list with `--` before the prompt.
- (Superseded the same day: the frames now come from Muse Image, see the entry below.)

## 2026-10-03 · Style frames moved to Muse Image (P1-U01.2)

- The owner supplied a Meta Model API key (`MUSE_API_KEY` in the repo's git-ignored `.env`) with a $2.50 cap
  (250 images at a flat $0.01). `art/ui/frames/generate.mjs` calls `POST https://api.meta.ai/v1/images/edits`
  (`muse-image-1.0`, multipart, repeated `image` fields for references, `size=1536x1024` comes back 1920x1280)
  and keeps `ledger.jsonl`, which refuses a call past the cap. `generate.sh` (codex exec) is retired.
- Without a style lock the first frame came out as a glossy generic 3D render in an American wild-west town,
  with a title bar over the grid. Leading with "paint this in exactly the art style of the first attached
  image (H4)… not a glossy 3D render; not the American south-west" fixed both; the model then copies H4's
  windmill, bunting and sign almost verbatim.
- It invents chrome from H4's layout (bottom bars, QR codes, "Hide debris", counters, "32/32 joined" that reads
  as a player cap). Say "nothing else: no bottom bar, no QR code, no buttons, no counters" and check every pick
  for caps and invented features before using it.

- Muse returns **WebP** whatever the request says; the first frames were saved as `.png` by mistake (browsers sniff the bytes, so nothing looked wrong). `generate.mjs` now names files by their magic bytes.

## 2026-10-03 · Byte-stable vehicle bakes (P1-V02)

- **Node's zlib isn't byte-stable across machines.** Chromium's zlib (bundled with Node) picks deflate matches with
  CPU-specific hashing, so the same pixels can compress to different bytes on arm64 and x64.
  `tools/vehicles/png.mjs` writes its own fixed-Huffman DEFLATE (Sub-filtered rows, run matches only): about 65 KB for
  the 1024×512 atlas, and identical on the Mac and the Linux CI runners (run 1013).
- **An LFS pointer is a hash.** CI checks out without LFS, but a pointer's `oid sha256:` is the content's sha256, so
  `bake.mjs --check` compares a fresh bake against committed files without fetching anything. Validating the GLBs
  themselves needs a targeted `git lfs pull --include=<the asset>`.
- **Spike J's per-LOD pivots drifted.** Bounding-box-centre pivots move by millimetres between LODs because coarser
  tiers sample fewer rings, but the contract wants one pivot per part. Measure pivots once, on LOD0.
- **Polygon wheels float.** An n-gon tyre whose bottom is a flat sits `R(1 − cos π/n)` above the ground (3 cm at n = 8).
  Make the inscribed radius the wheel radius.

## 2026-10-16 · Two roster sedans from generated sheets (br-bwju.3)

- **Reference sheets come from Muse Image.** Run `art/ui/frames/generate.mjs <name> --prompt <file> --out <dir> --ref <sheet>`, passing the
  Cruz's `lod-plus-1.png` as the layout example. Three candidates cost $0.03. Feed the chosen sheet back as `--ref` for the 'lowest' sheet
  and the car stays identical. The generator copies the Cruz's UHF whip and LED bar from the example in two of three candidates, so pick
  one without them or say "no aerial" in the prompt.
- **`tools/vehicles/fit` is Spike J's fit loop for any `art/vehicles/<id>`.** The commands are `extract.mjs <id>`, then
  `capture.mjs <id> --out <dir>`, then `opt.mjs <id> lod1 5`. An optimiser pass takes about 2 min on the Mac.
- **The fit narrows and flattens the nose.** After fitting, the Hawk's slope from `zNose` to `zNose − 0.16` was 7 cm tall. Lamps placed on
  that slope at fixed heights stood up above the bonnet as horns. Put fascia details on the nose face, sized by
  `hwN = lerpCurve(P.hw, P.zNose)`, never by absolute x.
- **The optimiser buys IoU with shapes a car can't have:**
  - a glass top wider than its base (an overhanging greenhouse);
  - a crown below its shoulder (a sunken bonnet);
  - for a sedan whose wing sets the reference's height, a lower body and wing (a coupe).
  `opt.mjs` now penalises the first two. Judge the third by eye, and keep identity cues such as the Lion's tall wing even if they cost IoU.
- **The paint key fringes every livery edge** (br-vhtm). The mask is `step(0.985, min(rgb))` on the filtered sample, so any texel blended
  with paint, by linear filtering or by mipmapping, stays untinted grey. Dark stripes on paint read light grey at grid size.
  Fixed: the bake stores paint premultiplied (alpha = non-paint coverage, rgb = livery × alpha in linear light; pure paint is
  (0,0,0,0), which survives a browser premultiplying on decode) and every renderer draws rgb + (1 − alpha) × tint through
  `web/shared/render/paint-key.js`. Never key a colour on a filtered sample: key a coverage that filters linearly.

## 2026-10-16 · Code-built motorbikes (br-bwju.5)

- **A vehicle with `wheel_F` is a bike.** The contract (`jj_contracts::vehicle::part_set`), the bake (`partSet`), the pivot test
  and the review check pick the bike part set from that: core, front, back, rider, wheel_F, wheel_R, the two-wheel sim's order.
  Shared bike code lives in `art/vehicles/_kit/`; that folder has no vehicle.json, so nothing treats it as a vehicle.
- **Bike masks need their own rules,** set in `refs/sheets.json` and read by both the extractor and the fit page:
  - `segment.bright`, because helmets, racks and parcels are paler than the grey background;
  - a 2 px `open`, because a 5 px one cuts the forks;
  - `keep` 0.03, because the front assembly joins the body through a few pixels;
  - per-sheet view windows, because the generator lays bike sheets out differently.
- **Expect about 0.8 to 0.85 weighted IoU for a bike,** not a car's 0.95. Spokes, forks and limbs make the reference masks
  ambiguous. A 'lowest' sheet's spoked wheels may not even fill.
- **A tyre's side count must be a multiple of 4,** or no flat faces the ground and the tyre dips below it. A 10-gon sank 2 cm;
  `jj validate` origin-ground caught it, and the kit now refuses such counts.
- **A part's top edge must survive every LOD.** Front and back pivot on their LOD0 top edge, so dropping the top detail at LOD2
  (the Postie's parcels) breaks the hinge line.
- **The renderer shares one wheel type only across a car's left/right pairs.** A bike's wheel_R isn't a right wheel to mirror,
  and its wheels may differ in size.
