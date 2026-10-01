# Bundled copies (templates)
`kit/` and `tools/` are the generic kit and gate suite; `recog/spec.js`, `examples/*` are the Cruze worked example. Paths inside `bake.mjs`, `render_gates*.{mjs,js}` and `examples/app.js`
point at the spike (`/spikes/art-pipeline/H-primitive-kit/...` served from the repo root); when porting, change `BASE`/`ROOT` and the model module names. The canonical, runnable
version lives in `spikes/art-pipeline/H-primitive-kit/`; refresh these copies with `scripts/sync.sh`.
