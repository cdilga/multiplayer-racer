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
t "Music is score-only with no voice: manifest provenance and the calibrated no-voice check (P1-A02v)" bash -c 'python3 tools/audio/check_music_manifest.py && python3 tools/audio/test_check_music_manifest.py'
t "Engine synth bundle and profile copy are current (P1-A04)" node art/ui/poc/audio/engine/build.mjs --check
t "jammers-look recipes match the rendered code (P1-F11)" node .claude/skills/jammers-look/example/check-recipes.mjs
t "The surface-strips test map is what its generator writes (P1-S03a)" bash -c 'python3 tools/maps/surface_strips.py && git diff --exit-code maps/test/surface-strips.json'
t "The skidpad test map is what its generator writes (P1-FL04)" bash -c 'python3 tools/maps/skidpad.py && git diff --exit-code maps/test/skidpad.json'
t "Vehicle bakes are reproducible and committed; load in three.js (P1-V02, every art/vehicles car since br-bwju.3)" bash -c 'printf "%s\n" art/vehicles/*/ | xargs -P 8 -I{} sh -c "[ -f {}vehicle.json ] || exit 0; node tools/vehicles/bake.mjs --check {} >/dev/null || { echo \"bake --check failed: {}\"; exit 1; }" && node --test tools/vehicles/test/'
t "Design site Vehicles pages: generated from the roster, every Vehicles-contract item present for every roster vehicle (P1-D03b, R126)" bash -c 'node tools/vehicles/review/check.mjs && node --test tools/vehicles/review/'
t "The N08 qualification harness logic (tools/net)" node --test tools/net/qualify.test.mjs
t "The committed emulator receipts show what the beads cite (P1-F08)" node --test web/tests/emulators/
t "Deploy secrets appear only in deploy workflows (R117)" scripts/ci/check-deploy-secrets.sh
t "Native artifacts reject zero-filled and malformed executables (br-hytm)" node --test scripts/ci/native-check.test.mjs
t "Artifact fetch uses this run's build verdict (br-56d5)" node --test scripts/ci/fetch-web.test.mjs
t "Provider-neutral startup, CI repair claims and nonblocking handoffs (P1-OPS)" python3 scripts/agents/test_workflow.py -q
t "Preview publisher, record, retention and index (infra/previews, P1-D04..D06)" python3 -m unittest discover -s infra/previews/tests -p 'test_*.py' -q
exit $rc
