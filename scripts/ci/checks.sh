#!/usr/bin/env bash
# The `checks` lane (always runs; the `tools` lane's checks are here too): one script for CI's checks job and the
# verifier's local runner (scripts/beads/batch-verify.sh), so the two can't drift (P1-F02).
#   scripts/ci/checks.sh      (needs node_modules at the root and in web/: npm ci)
set -uo pipefail
cd "$(dirname "$0")/../.."
rc=0
t() { # <name> <command…>: run, time, keep going, remember a failure
    local name=$1 s=$SECONDS; shift
    if "$@"; then echo "checks: ok   $((SECONDS - s))s  $name"; else echo "checks: FAIL $((SECONDS - s))s  $name"; rc=1; fi
}
t "UI tokens (P1-U01)" node art/ui/check.mjs
t "TV grid rule, equal tiles at any N (P1-U02.2, R95)" node art/ui/poc/tv/grid-check.mjs
t "Announcer cue sheet (P1-A00)" bash -c 'python3 tools/audio/check_cues.py tools/audio/cues-playtest1.tsv && python3 tools/audio/test_check_cues.py'
t "Engine synth bundle and profile copy are current (P1-A04)" node art/ui/poc/audio/engine/build.mjs --check
t "jammers-look recipes match the rendered code (P1-F11)" node .claude/skills/jammers-look/example/check-recipes.mjs
t "The surface-strips test map is what its generator writes (P1-S03a)" bash -c 'python3 tools/maps/surface_strips.py && git diff --exit-code maps/test/surface-strips.json'
t "Vehicle bake is reproducible and committed; loads in three.js (P1-V02)" bash -c 'node tools/vehicles/bake.mjs --check && node --test tools/vehicles/test/'
exit $rc
