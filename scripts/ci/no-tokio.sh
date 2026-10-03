#!/usr/bin/env bash
# R2: no Tokio in the shipping dependency graph (Playtest-1 plan §4.3). The server runs on Asupersync.
# Checks the normal and build edges of every workspace crate for every target (native and wasm);
# dev-dependencies don't ship. Exit 0 = clean, 1 = Tokio found (the path to it is printed).
set -euo pipefail
cd "$(dirname "$0")/../.."

tree=$(cargo tree --workspace --locked --target all --edges normal,build --prefix none --format '{p}')
if grep -Eq '^tokio(-[a-z-]+)? v' <<<"$tree"; then
    echo "no-tokio: FAIL: Tokio is in the shipping graph (R2). Who pulls it in:" >&2
    for pkg in $(grep -Eo '^tokio(-[a-z-]+)? ' <<<"$tree" | sort -u); do
        cargo tree --workspace --locked --target all --edges normal,build --invert "$pkg" >&2
    done
    exit 1
fi
echo "no-tokio: ok ($(sort -u <<<"$tree" | wc -l | tr -d ' ') packages, no tokio)"
