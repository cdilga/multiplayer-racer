#!/usr/bin/env bash
# The `rust` lane's lint half (rust-test.sh is the other): format, check (native and the WASM facades), clippy, the
# committed data validating through the native jj, no Tokio (R2) and cargo deny. Always the whole workspace (cheap on a
# warm target dir). One script for CI's rust-lint job and the verifier's local runner (P1-F02).
#   scripts/ci/rust-lint.sh       (env: CARGO_TARGET_DIR)
set -uo pipefail
cd "$(dirname "$0")/../.."
rc=0
t() {
    local name=$1 s=$SECONDS; shift
    if "$@"; then echo "rust-lint: ok   $((SECONDS - s))s  $name"; else echo "rust-lint: FAIL $((SECONDS - s))s  $name"; rc=1; fi
}
t "Format" cargo fmt --all -- --check
# Compile gate: an aborted compile can print a green prefix, so nothing below runs if this fails.
if ! cargo check --workspace --all-targets --locked; then
    echo "rust-lint: FAIL  Check (native): compile gate failed; nothing else ran"
    exit 1
fi
echo "rust-lint: ok   Check (native)"
t "Check (wasm facades)" cargo check --locked --target wasm32-unknown-unknown -p jj-wasm-host -p jj-wasm-input -p jj-wasm-procgen
t "Clippy" cargo clippy --workspace --all-targets --locked -- -D warnings
t "Clippy (jj-wasm-host testing)" cargo clippy -p jj-wasm-host --features testing --all-targets --locked -- -D warnings
t "The greybox validates (jj validate)" cargo run --locked -q -p jj-tools --bin jj -- validate maps/greybox-loop.json
t "A generated map validates (jj procgen, P1-M03a)" bash -c 'cargo run --locked -q -p jj-tools --bin jj -- procgen --seed 42 --json >/dev/null'
t "The Cruz Missile's committed bake validates, and its profile still matches it (P1-V02, P1-S03a)" bash -c '
    git lfs pull --include="art/vehicles/cruz-missile/cruz-missile.*" &&
    cargo run --locked -q -p jj-tools --bin jj -- validate art/vehicles/cruz-missile/cruz-missile.asset.json assets/profiles/cruz-missile.json maps/test/surface-strips.json'
t "No Tokio (R2)" scripts/ci/no-tokio.sh
t "cargo deny" bash -c 'command -v cargo-deny >/dev/null || cargo install --locked cargo-deny; scripts/ci/deny.sh'
exit $rc
