#!/usr/bin/env bash
# R2: no Tokio in the shipping dependency graph (Playtest-1 plan §4.3). The server runs on Asupersync.
# Checks the normal and build edges of every workspace crate for every target (native and wasm);
# dev-dependencies don't ship. Exit 0 = clean, 1 = Tokio found (the path to it is printed).
set -euo pipefail
cd "$(dirname "$0")/../.."

# The targets 0.2 ships for (the same list as deny.toml's [graph] targets). `--target all` would also walk
# emscripten-only optional edges (wasm-bindgen-futures -> tokio, reached through Asupersync) that never build.
targets=(x86_64-unknown-linux-gnu aarch64-apple-darwin wasm32-unknown-unknown)
tree=$(for t in "${targets[@]}"; do
    cargo tree --workspace --locked --target "$t" --edges normal,build --prefix none --format '{p}'
done)
if grep -Eq '^tokio(-[a-z-]+)? v' <<<"$tree"; then
    echo "no-tokio: FAIL: Tokio is in the shipping graph (R2). Who pulls it in:" >&2
    for pkg in $(grep -Eo '^tokio(-[a-z-]+)? ' <<<"$tree" | sort -u); do
        for t in "${targets[@]}"; do
            cargo tree --workspace --locked --target "$t" --edges normal,build --invert "$pkg" >&2 || true
        done
    done
    exit 1
fi
echo "no-tokio: ok ($(sort -u <<<"$tree" | wc -l | tr -d ' ') packages, no tokio)"
