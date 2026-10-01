#!/usr/bin/env bash
# Refresh the skill's bundled copies from the canonical spike (spikes/art-pipeline/H-primitive-kit). Run after changing the kit or the gate tools.
# The car/bin models and the Cruze spec are copied as WORKED EXAMPLES; everything under assets/kit and assets/tools is generic.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; REPO="$(cd "$HERE/../../.." && pwd)"; SRC="$REPO/spikes/art-pipeline/H-primitive-kit"
rm -rf "$HERE/assets"; mkdir -p "$HERE/assets/kit" "$HERE/assets/tools/physics" "$HERE/assets/recog" "$HERE/assets/examples"
cp "$SRC"/kit/*.js "$HERE/assets/kit/"
cp "$SRC"/tools/*.mjs "$SRC"/tools/*.js "$SRC"/tools/budgets.json "$HERE/assets/tools/"
cp "$SRC"/tools/physics/*.mjs "$HERE/assets/tools/physics/"
cp "$SRC"/recog/measure_side.py "$SRC"/recog/grid_overlay.py "$HERE/assets/recog/"
cp "$SRC"/recog/spec.js "$HERE/assets/recog/spec.js"      # example spec; validate_asset.mjs imports ../recog/spec.js
cp "$SRC"/cruze.js "$SRC"/bin.js "$SRC"/app.js "$SRC"/index.html "$SRC"/dev.html "$SRC"/replay_test.mjs "$SRC"/breakdown.mjs "$SRC"/compose.py "$HERE/assets/examples/"
cp "$SRC"/ASSET-CONTRACT-PROCEDURAL.md "$HERE/assets/"
cat > "$HERE/assets/README.md" <<'DOC'
# Bundled copies (templates)
`kit/` and `tools/` are the generic kit and gate suite; `recog/spec.js`, `examples/*` are the Cruze worked example. Paths inside `bake.mjs`, `render_gates*.{mjs,js}` and `examples/app.js`
point at the spike (`/spikes/art-pipeline/H-primitive-kit/...` served from the repo root); when porting, change `BASE`/`ROOT` and the model module names. The canonical, runnable
version lives in `spikes/art-pipeline/H-primitive-kit/`; refresh these copies with `scripts/sync.sh`.
DOC
echo "synced $(find "$HERE/assets" -type f | wc -l | tr -d ' ') files ($(du -sk "$HERE/assets" | cut -f1) KB) from $SRC"
