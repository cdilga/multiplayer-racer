#!/usr/bin/env bash
# check_asset.sh — Spike E task 3: single CI entry point.
#
# Runs mesh_lint (always) + rig_check (only if the asset actually declares jj_joint-tagged
# objects) + the existing spike validators (best-effort, if a matching sidecar is found), and
# prints one compact pass/fail line per stage plus total timing.
#
# Usage: check_asset.sh <file.blend|file.glb> [--tri-budget N] [--steps N]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_ROOT="$(cd "$HERE/.." && pwd)"
FILE="${1:?usage: check_asset.sh <file.blend|file.glb> [--tri-budget N] [--steps N]}"
shift || true
TRI_BUDGET=10000
STEPS=9
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tri-budget) TRI_BUDGET="$2"; shift 2 ;;
    --steps) STEPS="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ ! -f "$FILE" ]]; then
  echo "check_asset: no such file: $FILE" >&2
  exit 2
fi

BASENAME="$(basename "$FILE")"
STEM="${BASENAME%.*}"
DIR="$(cd "$(dirname "$FILE")" && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

T_TOTAL_START=$(date +%s.%N)
OVERALL_OK=0
PASS="PASS"; FAIL="FAIL"

run_timed() {  # run_timed <label> <out_var_name> -- <cmd...>
  local label="$1"; shift
  local t0 t1
  t0=$(date +%s.%N)
  "$@" > "$WORKDIR/${label// /_}.log" 2>&1
  local code=$?
  t1=$(date +%s.%N)
  printf '%s\t%s\t%.2f\n' "$label" "$code" "$(echo "$t1 - $t0" | bc)"
}

echo "=== check_asset: $FILE ==="

# ---- 1. mesh_lint (open .blend directly; import .glb inside the script) ----
if [[ "$FILE" == *.blend ]]; then
  LINT_LINE=$(run_timed "mesh_lint" blender -b "$FILE" -P "$HERE/mesh_lint.py" -- \
    --out "$WORKDIR/mesh_lint.json" --tri-budget "$TRI_BUDGET")
else
  LINT_LINE=$(run_timed "mesh_lint" blender -b -P "$HERE/mesh_lint.py" -- "$FILE" \
    --out "$WORKDIR/mesh_lint.json" --tri-budget "$TRI_BUDGET")
fi
LINT_CODE=$(echo "$LINT_LINE" | cut -f2)
LINT_TIME=$(echo "$LINT_LINE" | cut -f3)
[[ "$LINT_CODE" == "0" ]] && LINT_STATUS=$PASS || { LINT_STATUS=$FAIL; OVERALL_OK=1; }
if [[ -f "$WORKDIR/mesh_lint.json" ]]; then
  LINT_SUMMARY=$(python3 -c "
import json
d=json.load(open('$WORKDIR/mesh_lint.json'))
print(f\"errors={d['error_count']} warns={d['warn_count']} tris={d['triangles']}\")
" 2>/dev/null || echo "no summary")
else
  LINT_SUMMARY="mesh_lint produced no report (see $WORKDIR/mesh_lint.log)"
fi
printf '%-10s %-4s  %6ss  %s\n' "mesh_lint" "$LINT_STATUS" "$LINT_TIME" "$LINT_SUMMARY"

# ---- 2. rig_check, only if the asset declares any jj_joint objects ----
HAS_JOINTS=0
if [[ "$FILE" == *.blend ]]; then
  HAS_JOINTS=$(blender -b "$FILE" --python-expr "
import bpy
print('JJHASJOINTS=' + ('1' if any(o.get('jj_joint') for o in bpy.data.objects) else '0'))
" 2>/dev/null | sed -n 's/^JJHASJOINTS=//p' | tail -1)
fi
if [[ "$HAS_JOINTS" == "1" ]]; then
  RIG_LINE=$(run_timed "rig_check" blender -b "$FILE" -P "$HERE/rig_check.py" -- \
    --out "$WORKDIR/rig_check.json" --steps "$STEPS")
  RIG_CODE=$(echo "$RIG_LINE" | cut -f2)
  RIG_TIME=$(echo "$RIG_LINE" | cut -f3)
  [[ "$RIG_CODE" == "0" ]] && RIG_STATUS=$PASS || { RIG_STATUS=$FAIL; OVERALL_OK=1; }
  RIG_SUMMARY=$(python3 -c "
import json
d=json.load(open('$WORKDIR/rig_check.json'))
print(f\"fails={d['fail_count']} joints={len(d['joints_tested'])}\")
" 2>/dev/null || echo "no summary")
  printf '%-10s %-4s  %6ss  %s\n' "rig_check" "$RIG_STATUS" "$RIG_TIME" "$RIG_SUMMARY"
else
  printf '%-10s %-4s  %6ss  %s\n' "rig_check" "SKIP" "0.00" "no jj_joint-tagged objects on this asset"
fi

# ---- 3. existing spike validators, best-effort, only if a plausible sidecar exists ----
SIDECAR="$DIR/${STEM%.*}.asset.json"
[[ -f "$SIDECAR" ]] || SIDECAR="$DIR/$STEM.asset.json"
if [[ -f "$SIDECAR" ]]; then
  GLB="$DIR/$STEM.glb"
  if grep -q '"kind": "chassis"\|"contract": "jj.vehicle' "$SIDECAR" 2>/dev/null && [[ -f "$GLB" ]]; then
    V_LINE=$(run_timed "validate_vehicle" python3 "$SPIKE_ROOT/validate_vehicle.py" "$GLB" "$SIDECAR")
    V_CODE=$(echo "$V_LINE" | cut -f2); V_TIME=$(echo "$V_LINE" | cut -f3)
    [[ "$V_CODE" == "0" ]] && V_STATUS=$PASS || { V_STATUS=$FAIL; OVERALL_OK=1; }
    printf '%-10s %-4s  %6ss  %s\n' "validate" "$V_STATUS" "$V_TIME" "existing vehicle contract validator ($SIDECAR)"
  else
    printf '%-10s %-4s  %6ss  %s\n' "validate" "SKIP" "0.00" "sidecar found but not a recognized contract shape"
  fi
else
  printf '%-10s %-4s  %6ss  %s\n' "validate" "SKIP" "0.00" "no sidecar .asset.json next to this asset"
fi

T_TOTAL_END=$(date +%s.%N)
TOTAL=$(echo "$T_TOTAL_END - $T_TOTAL_START" | bc)
if [[ $OVERALL_OK -eq 0 ]]; then
  echo "=== RESULT: PASS  (total ${TOTAL}s) ==="
else
  echo "=== RESULT: FAIL  (total ${TOTAL}s) ==="
fi
exit $OVERALL_OK
