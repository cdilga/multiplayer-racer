#!/usr/bin/env bash
# Build the Cruz Missile v2 game asset end to end: geometry per LOD -> finish (materials, dents,
# UVs, mask bake, GLB) -> sidecar.  Output: art/vehicles/cruz-missile/
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
for L in 0 1 2; do
  blender -b -P build_cruze_v2.py -- out --lod "$L" 2>&1 | grep -E "CRUZE_V2_STATS|Traceback|Error" | cut -c1-120
  blender -b -P finish_asset.py -- --lod "$L" 2>&1 | grep -E "FINISH_OK|Traceback|Error" | cut -c1-160
done
python3 write_sidecar.py
