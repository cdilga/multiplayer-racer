#!/usr/bin/env bash
# Builds the host's sim worker for the browser (P1-S02): `jj-wasm-host` for wasm32 (release), then wasm-bindgen
# (--target web) into web/host/src/worker/pkg/ (generated; git-ignored). The worker imports it from there.
#
# Usage: scripts/build-host-wasm.sh [--dev]   (--dev: debug build, quicker, larger)
set -euo pipefail
cd "$(dirname "$0")/.."

profile=release
[[ ${1:-} == --dev ]] && profile=debug
flags=(--locked --target wasm32-unknown-unknown -p jj-wasm-host)
[[ $profile == release ]] && flags+=(--release)
cargo build "${flags[@]}"

target=$(cargo metadata --format-version 1 --no-deps | grep -o '"target_directory":"[^"]*"' | cut -d'"' -f4)
wasm-bindgen --target web --out-dir web/host/src/worker/pkg "$target/wasm32-unknown-unknown/$profile/jj_wasm_host.wasm"
ls -l web/host/src/worker/pkg/jj_wasm_host_bg.wasm | awk '{ print "jj_wasm_host_bg.wasm:", $5, "bytes" }'
