# Project adapter — Joystick Jammers (replace this file when the skill is used on another game)

Everything project-specific lives here: where the style comes from, which contract/plan sections bind, budgets, naming, and how references were made.
The rest of the skill is deliberately generic.

## Where the style comes from (read these, in this order)

1. **Direction:** `docs/plans/v0.2-experience-direction.md` — *Outback comic motorsport festival*: sun-bleached cream, ink/navy, red earth, electric accents,
   chunky fictional vehicles, restrained Mad-Max metal. Not a generic dashboard, muddy realism, or neon-only. Owner steer for cars (2026-09-30):
   **cute, rounded, kart/derby-suited, but instantly recognisable as the real model** (e.g. golden Cruze); recognition beats flourish.
2. **Master style + blocks:** `art/style/MASTER_PROMPTS.md` (MASTER STYLE, GUARDS, and asset blocks VEHICLE, VEHICLE TURNAROUND, PROP, PROP TURNAROUND, ENVIRONMENT)
   with the verbatim text in `art/style/blocks/*.txt`. Every image prompt = MASTER STYLE + asset block + subject + GUARDS.
   Key style facts: cute chunky toy look, oversized wheels, generous bevels, low-poly-friendly, two-to-three-tone cel shading with warm key/cool shadow,
   base of warm ochres/red earth/cream, accents of cobalt/saffron/electric teal, **one bright player colour per vehicle**, a little sun-faded grit and friendly dents,
   painted-toy materials, small glowing emissives, roof space for a race-number roundel.
3. **Worked prompts and results:** `art/style/prompts/*.txt` (hero_cruz_missile[_v2], hero_tri_tonne_ute, wheelie_bin[_squished|_turnaround], red_centre_vignette, ui_lobby) and
   their outputs in `art/style/refs/*.png` (+ `.log`). The Cruze concept tile is also kept at `spikes/art-pipeline/H-primitive-kit/refs/codex_concept_cruze.png`.
4. **Orthographic turnarounds for measuring:** `spikes/art-pipeline/refs/{side,front,rear,top}.png` with their exact prompts in `refs/generation-prompts.txt`
   (flat mid-grey body, dark-grey glass, white background, no shadows, no logos; side first, then front/rear/top as "companions that match this exact car").
   Owner photos of the real car: `cruze reference images.zip` (identity cues, not for measuring).
5. **Guards (always):** no real brands/logos/badges/lettering, no real people, no landmarks or sacred sites, no Indigenous art/motifs, family friendly. Review image-gen
   output by eye: it adds unrequested motifs.
6. **Binding plan/policy:** `docs/policies/owner-direction-2026-09-29.md` (no arbitrary gameplay-count caps; debris stays dynamic; no runtime CDN; self-hosted),
   plan `docs/plans/v0.2-revamp-plan-2026-09-28.md` §8 (destruction: parts, hinged-then-detach, deformation, wheel loss = handling change), §12.3–12.5 (contracts, vehicle
   contract, per-car pipeline), §7.6 (roster). Existing skills: `game-model-prep`, `vehicle-model-validation` (JJ acceptance gate).

## How reference imagery is made (Codex image generation)
`codex exec` works headless on this machine; **omit `--model`** (gpt-5-codex is blocked on the ChatGPT account); ~2 minutes for a pair of images. Generate the side view first,
then front/rear/top as companions that "match this exact car"; state real dimensions and target pixel lengths so `measure_side.py` can recover metres. Strip badges in the
prompt *and* check the output. Redo the "top view correction" prompt style when an emblem sneaks in. No image generation was needed for the primitive-kit Cruze: it reused the
first spike's outputs.

## Contract (bind to these)
`spikes/art-pipeline/G-cruze-v2/ASSET-CONTRACT.md` (Blender profile) and `spikes/art-pipeline/H-primitive-kit/ASSET-CONTRACT-PROCEDURAL.md` (this skill's profile: same nodes,
extras, semantic materials, colliders, anchors; differences = runtime vertex dents, vertex-colour paint, one trim atlas, steer→spin wheel chain).
Part names: `chassis`, `bonnet`, `boot`, `door_L/R`, `door_rear_L/R`, `bumper_front/rear`, `glass`, `light_head_L/R`, `light_brake_L/R`, `mirror_L/R`, `wheel_FL/FR/RL/RR`, `susp_*`,
trims `bumper_front_trim`, `boot_trim`; anchors `cam_fp cam_tp_target com exhaust_0 lplate_front lplate_rear roof_number`. Space: glTF, forward −Z, metres, origin on the ground
between the axles. Budgets: `tools/budgets.json`.

## Where things are
* Reference implementation and evidence: `spikes/art-pipeline/H-primitive-kit/` (`gallery.html`, `REPORT.md`, `asset/cruze/` baked GLBs + sidecar, `out/` evidence).
* Blender track for comparison (another agent iterates it; read-only): `spikes/art-pipeline/G-cruze-v2/`.
* Never bind the dev server to all interfaces: `python3 -m http.server 8123 --bind 127.0.0.1`. Use `browser-harness` for any browsing; Playwright + system Chrome for captures.
