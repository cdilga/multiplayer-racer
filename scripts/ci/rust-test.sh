#!/usr/bin/env bash
# CI's Rust tests for the crates scripts/ci/plan.mjs selected (already closed over their dependents), or `all`.
#   - nextest runs every test binary of the selection in parallel (cargo test runs binaries one after another);
#   - doc tests, which nextest doesn't run (library crates only);
#   - jj-wasm-host's `testing` feature build, and the jj-map/jj-procgen WASM parity in Node, when selected.
# The job sets the opt level (CARGO_PROFILE_DEV_OPT_LEVEL); debug assertions and overflow checks stay on.
#
# Usage: scripts/ci/rust-test.sh all | <crate>...
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

t() { local s=$SECONDS rc=0; "$@" || rc=$?; echo "rust-test: $((SECONDS - s))s exit $rc  $*"; return $rc; }
rc=0
t cargo nextest run --locked --no-fail-fast "${sel[@]}" || rc=1
if [[ ${#doc[@]} -gt 0 ]]; then t cargo test --locked -q --doc "${doc[@]}" || rc=1; fi
if has jj-wasm-host; then t cargo nextest run --locked --no-fail-fast -p jj-wasm-host --features testing || rc=1; fi
wasm=()
for c in jj-map jj-procgen; do if has "$c"; then wasm+=(-p "$c"); fi; done
if [[ ${#wasm[@]} -gt 0 ]]; then
    t cargo test --locked --target wasm32-unknown-unknown "${wasm[@]}" --test wasm_parity || rc=1
fi
exit $rc
