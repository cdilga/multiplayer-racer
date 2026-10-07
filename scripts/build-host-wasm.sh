#!/usr/bin/env bash
# Builds the host's sim worker for the browser: `jj-wasm-host` for wasm32 (release), then wasm-bindgen (--target web).
# Two builds, both generated and git-ignored:
#   web/host/src/worker/pkg/   the shipped worker (P1-S02), no test code
#   web/host/src/testing/pkg/  the test chunk's worker (P1-F05b), with the `testing` feature
#   web/host/src/procgen/pkg/  the procgen worker's generator (P1-M08a)
#
# Usage: scripts/build-host-wasm.sh [--dev]   (--dev: debug builds, quicker, larger)
set -euo pipefail
cd "$(dirname "$0")/.."

profile=release
[[ ${1:-} == --dev ]] && profile=debug
flags=(--locked --target wasm32-unknown-unknown -p jj-wasm-host)
[[ $profile == release ]] && flags+=(--release)
target=$(cargo metadata --format-version 1 --no-deps | grep -o '"target_directory":"[^"]*"' | cut -d'"' -f4)
wasm="$target/wasm32-unknown-unknown/$profile/jj_wasm_host.wasm"

cargo build "${flags[@]}"
wasm-bindgen --target web --out-dir web/host/src/worker/pkg "$wasm"
cargo build "${flags[@]}" --features testing
wasm-bindgen --target web --out-dir web/host/src/testing/pkg --out-name jj_wasm_host_testing "$wasm"
# The controller's input facade (P1-N06/C02): encoding and the cmd protocol, no sim.
cargo build --locked --target wasm32-unknown-unknown -p jj-wasm-input $([[ $profile == release ]] && echo --release)
wasm-bindgen --target web --out-dir web/controller/src/pkg "$target/wasm32-unknown-unknown/$profile/jj_wasm_input.wasm"
# The procgen worker's generator (P1-M08a): prepare(seed, recipe) -> canonical bytes + map JSON + the ladder's log.
cargo build --locked --target wasm32-unknown-unknown -p jj-wasm-procgen $([[ $profile == release ]] && echo --release)
wasm-bindgen --target web --out-dir web/host/src/procgen/pkg "$target/wasm32-unknown-unknown/$profile/jj_wasm_procgen.wasm"
ls -l web/host/src/procgen/pkg/jj_wasm_procgen_bg.wasm | awk '{ print $NF ":", $5, "bytes" }'
ls -l web/controller/src/pkg/jj_wasm_input_bg.wasm | awk '{ print $NF ":", $5, "bytes" }'
ls -l web/host/src/worker/pkg/jj_wasm_host_bg.wasm web/host/src/testing/pkg/jj_wasm_host_testing_bg.wasm |
  awk '{ print $NF ":", $5, "bytes" }'
