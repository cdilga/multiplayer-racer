#!/usr/bin/env bash
# CI's Rust tests for the crates scripts/ci/plan.mjs selected (already closed over their dependents), or `all`.
#   - nextest runs every test binary of the selection in parallel (cargo test runs binaries one after another);
#   - doc tests, which nextest doesn't run (library crates only);
#   - jj-wasm-host's `testing` feature build, and the jj-map/jj-procgen WASM parity in Node, when selected.
# The job sets the opt level (CARGO_PROFILE_DEV_OPT_LEVEL); debug assertions and overflow checks stay on.
#
# Usage: scripts/ci/rust-test.sh all | <crate>...    (env JJ_PARTITION=k/n: one nextest partition, as CI's matrix runs it)
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ $# -gt 0 ]] || { echo "usage: rust-test.sh all | <crate>..." >&2; exit 2; }

all=0
[[ $1 == all ]] && all=1
crates=("$@")
has() { [[ $all == 1 ]] && return 0; local x; for x in "${crates[@]}"; do [[ $x == "$1" ]] && return 0; done; return 1; }

if [[ $all == 1 ]]; then
    sel=(--workspace)
    doc=(--workspace)
else
    sel=() doc=()
    for c in "${crates[@]}"; do
        sel+=(-p "$c")
        [[ -f crates/$c/src/lib.rs ]] && doc+=(-p "$c")
    done
fi

# A runner with a small job container (truenas-ci: 8 GB, shared with its browser slots) and a cold cache compiles
# asupersync among dozens of parallel rustcs and gets OOM-killed (CI runs 5414, 5495, 5531: no test ran). There, fewer
# compile jobs; the 12-16 GB rust runners keep cargo's default.
mem=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo max)
if [[ $mem =~ ^[0-9]+$ && $mem -lt $((12 * 1024 * 1024 * 1024)) && -z ${CARGO_BUILD_JOBS:-} ]]; then
    export CARGO_BUILD_JOBS=4
    echo "rust-test: job memory $((mem / 1024 / 1024)) MiB: CARGO_BUILD_JOBS=4"
fi
t() { local s=$SECONDS rc=0; "$@" || rc=$?; echo "rust-test: $((SECONDS - s))s exit $rc  $*"; return $rc; }
# JJ_PARTITION=k/n (the job's matrix): this job runs nextest's k-th hash partition of the selection's tests, and the
# last partition also runs the doc tests, the `testing` build and the WASM checks. Unset: everything (local runs).
part=() last=1
if [[ -n ${JJ_PARTITION:-} ]]; then
    part=(--partition "hash:$JJ_PARTITION" --no-tests=pass)
    [[ ${JJ_PARTITION%/*} == "${JJ_PARTITION#*/}" ]] || last=0
fi
rc=0
t cargo nextest run --locked --no-fail-fast ${part[@]+"${part[@]}"} "${sel[@]}" || rc=1
if [[ $last == 0 ]]; then exit $rc; fi
if [[ ${#doc[@]} -gt 0 ]]; then t cargo test --locked -q --doc "${doc[@]}" || rc=1; fi
if has jj-wasm-host; then t cargo nextest run --locked --no-fail-fast -p jj-wasm-host --features testing || rc=1; fi
wasm=()
for c in jj-map jj-procgen; do if has "$c"; then wasm+=(-p "$c"); fi; done
if [[ ${#wasm[@]} -gt 0 ]]; then
    t cargo test --locked --target wasm32-unknown-unknown "${wasm[@]}" --test wasm_parity || rc=1
fi
# W03's pinned Rapier behavior must hold in the browser simulation as well as natively.
if has jj-sim; then
    t cargo test --locked --target wasm32-unknown-unknown -p jj-sim --test rapier_api || rc=1
fi
exit $rc
