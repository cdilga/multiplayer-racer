#!/usr/bin/env bash
# Runs the lanes a plan selected, on this machine, with the same scripts CI runs (P1-F02): the verifier's local runner
# (scripts/beads/batch-verify.sh run) calls it on eris through scripts/remote/eris.sh, or here with --local.
#
#   scripts/ci/verify-lanes.sh <plan-outputs-file> <out-dir>
#
# <plan-outputs-file> is `node scripts/ci/plan.mjs … --github-output <file>` (key=value lines). Writes
# <out-dir>/lanes.jsonl (one {"lane","machine","exit","seconds","log","summary"} per lane) and a log per lane.
# Compile gates come first: if rust-lint's `cargo check` fails, its tests are not run (an aborted compile can print a
# green prefix). The `image` lane needs the TrueNAS Docker host, so it's reported as not run here (CI's image job).
set -uo pipefail
cd "$(dirname "$0")/../.."
plan=${1:?usage: verify-lanes.sh <plan-outputs-file> <out-dir>}
out=${2:?usage: verify-lanes.sh <plan-outputs-file> <out-dir>}
mkdir -p "$out"
get() { sed -n "s/^$1=//p" "$plan" | head -1; }
lanes=$(get lanes)
crates=$(get crates)
slots=$(get slots)
machine=$(hostname -s)
export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-$HOME/.cache/jj-verify/target}
export JJ_STORE=off JJ_PREBUILT=$out/prebuilt

record() { # lane exit seconds log
    local summary
    summary=$(grep -E ': (FAIL|ok)|slot-timing: .* FAIL|^error(\[|:)|test result: FAILED|^    FAIL ' "$4" 2>/dev/null | grep -v ': ok' | head -5 | tr '\n' ' ' | cut -c1-400)
    printf '{"lane":"%s","machine":"%s","exit":%d,"seconds":%d,"log":"%s","summary":"%s"}\n' \
        "$1" "$machine" "$2" "$3" "$(basename "$4")" "$(sed 's/["\\]/ /g' <<<"$summary")" >>"$out/lanes.jsonl"
    echo "verify-lanes: $1 exit $2 in $3 s on $machine"
}
run_lane() { # lane log command…
    local lane=$1 log=$2 s=$SECONDS rc; shift 2
    "$@" >"$log" 2>&1; rc=$?
    record "$lane" "$rc" $((SECONDS - s)) "$log"
    return $rc
}
has() { [[ ",$lanes," == *",$1,"* ]]; }

: >"$out/lanes.jsonl"
echo "verify-lanes: lanes [${lanes:-checks only}] on $machine at $(git rev-parse --short HEAD)"
run_lane checks "$out/checks.log" bash -c 'npm ci --no-audit --no-fund --prefer-offline >/dev/null && npm --prefix web ci --no-audit --no-fund --prefer-offline >/dev/null && scripts/ci/checks.sh'
if has rust; then
    command -v cargo-nextest >/dev/null || curl -sSfL https://get.nexte.st/0.9.146/linux | tar xz -C "$HOME/.cargo/bin"
    if run_lane rust-lint "$out/rust-lint.log" bash -c 'scripts/ci/toolchain.sh && scripts/ci/rust-lint.sh'; then
        (
            export CARGO_PROFILE_DEV_OPT_LEVEL=1 CARGO_PROFILE_TEST_OPT_LEVEL=1 CARGO_TARGET_DIR=$CARGO_TARGET_DIR-o1 JJ_COTURN_REQUIRED=${JJ_COTURN_REQUIRED:-0}
            run_lane rust-test "$out/rust-test.log" scripts/ci/rust-test.sh $crates
        )
    else
        printf '{"lane":"rust-test","machine":"%s","exit":2,"seconds":0,"log":"","summary":"not run: the rust-lint compile gate failed"}\n' "$machine" >>"$out/lanes.jsonl"
    fi
fi
if has web || has e2e; then
    if run_lane build "$out/build.log" scripts/ci/build-web.sh; then
        # Every packed slot's targets, one after another (CI spreads them over its browser runners).
        all=$(node -e 'const s=JSON.parse(process.argv[1]);console.log(JSON.stringify({1:Object.values(s).flat()}))' "$slots")
        run_lane browser "$out/browser.log" node scripts/ci/run-slot.mjs 1 "$all"
    fi
fi
if has image; then
    printf '{"lane":"image","machine":"%s","exit":-1,"seconds":0,"log":"","summary":"not run here: needs the TrueNAS Docker host (CI image job)"}\n' "$machine" >>"$out/lanes.jsonl"
fi
! grep -q '"exit":[1-9]' "$out/lanes.jsonl"
