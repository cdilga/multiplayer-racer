# Visual QA loop (hybrid CV + vision-LLM)

Validated 2026-06-28. Three layers; Layers 1–2 hard-fail, Layer 3 is the judge.

## Layer 1 — spec & budgets (deterministic)
- **Khronos glTF-Validator** (`npm gltf-validator`) — fail on `errors`, warnings advisory.
- **glTF-Transform** (`@gltf-transform/cli`) — `inspect` for tri/material/texture/draw-call budgets.

## Layer 2 — geometry / CV gates (deterministic)
Computed from the model + fixed-camera renders:
- AABB after scale ≈ declared length; bottom-Y ≈ 0 (ground contact).
- Wheels resolve; **perpendicular-to-spin-axis offset < ε** across the rig animation (no orbiting).
- Collider visual coverage ≥ threshold; CoM below chassis center; rollover sim passes.
- Paint hue match (ΔE) on sampled body pixels; tyres near-neutral; left/right symmetry.
- Identity number inside AABB, above roof, legible at camera distance.
- Destruction: ≥N debris bodies, velocity inherited, gone after TTL; pool cap respected.

## Layer 3 — vision-LLM rubric judge (calibrated)
- **Render harness:** prefer **custom headless three.js + Playwright/Puppeteer** over
  `screenshot-glb`/`model-viewer` so you render with the PROJECT's shaders/post (model-viewer uses
  its own lighting → false "off-brand" verdicts). Fixed deterministic cameras → reproducible,
  diffable PNGs. Headless Chrome WebGL in CI needs `--no-sandbox --use-gl=swiftshader|angle`.
- **Angles/poses:** 8-frame turntable + diagnostics (front, rear, **top-down = gameplay camera**,
  steer-L, steer-R, mid-suspension, post-destruction).
- **Output:** forced JSON per `assets/rubric.template.json` — a binary-ish checklist, each item
  `{pass, confidence, note}`, plus an overall `verdict`.
- **Calibrate** against a human-labeled sample before trusting as a gate. Rubric-guided beats
  rubric-free, but vision models are noisy on fine geometric defects — Layers 1–2 own the
  measurements; Layer 3 owns "does it read as the right thing / on-brand".
- **Vendor-agnostic:** the judge can be any vision model (skill defines prompt + schema, not vendor).

## Sources / tools
- https://github.com/KhronosGroup/glTF-Validator
- https://gltf-transform.dev/cli
- https://github.com/Shopify/screenshot-glb
- https://modelviewer.dev/docs/
- https://github.com/bldrs-ai/headless-three
