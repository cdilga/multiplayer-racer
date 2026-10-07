#!/usr/bin/env bash
# CI's one web build (docs/infra/ci.md): the sim/input/procgen WASM, both npm installs, the Vite pages, the S02 harness
# and the native jj and jj-server the browser tests drive, packed as one tarball every browser slot unpacks. The build's
# own checks (worker typechecks, test code kept out of the shipped bundles, current tokens, the landing path free of the
# renderer, runtime origins) run here, so a tarball only exists for inputs that passed them.
#
# Keyed by its inputs (scripts/ci/build-key.sh) and kept in the shared store (scripts/ci/web-store.sh), which the
# browser slots read: a key already stored is never rebuilt, so a push that only changes tests or docs builds nothing.
#
# Usage: scripts/ci/build-web.sh    (env: CARGO_TARGET_DIR, JJ_STORE_TOKEN; host cache JJ_PREBUILT, default
#        /cargo-cache/jj-prebuilt)
set -euo pipefail
cd "$(dirname "$0")/../.."
cache=${JJ_PREBUILT:-/cargo-cache/jj-prebuilt}
key=$(scripts/ci/build-key.sh)
echo "build-web: key $key"
if scripts/ci/web-store.sh has "$key"; then
    echo "build-web: already in the store"
    exit 0
fi
mkdir -p "$cache"
if [[ -f $cache/$key.tar.zst ]]; then
    echo "build-web: in this host's cache; storing it"
    scripts/ci/web-store.sh put "$key" "$cache/$key.tar.zst"
    exit 0
fi

# A miss: the LFS objects the pages bundle (vehicles, brand, audio) and the pinned toolchain, then the build.
git lfs pull --include "art/vehicles/**,art/ui/brand/**,assets/audio/**"
scripts/ci/toolchain.sh >&2
export PATH="$CARGO_HOME/bin:$PATH"

t() { local s=$SECONDS; "$@"; echo "build-web: $((SECONDS - s))s  $*" >&2; }
t scripts/build-host-wasm.sh >&2
t npm ci --no-audit --no-fund --prefer-offline >&2
t npm --prefix web ci --no-audit --no-fund --prefer-offline >&2
t npx --prefix web tsc --noEmit -p web/host/src/worker/tsconfig.json >&2
t npx --prefix web tsc --noEmit -p web/host/src/testing/tsconfig.json >&2
t npm --prefix web run build >&2
t node scripts/ci/bundle-check.mjs web/dist >&2
t npm --prefix web run tokens:check >&2
t node web/landing/tests/bundle-check.mjs web/dist >&2
t npm --prefix web run qualify >&2
t node scripts/ci/origin-scan.mjs web/dist web/dist-qualify >&2
t npx --prefix web vite build --config web/host/tests/vite.config.ts >&2
t cargo build --locked -q -p jj-tools --bin jj -p jj-server --bin jj-server >&2
mkdir -p .ci-bin && cp "$CARGO_TARGET_DIR/debug/jj" "$CARGO_TARGET_DIR/debug/jj-server" .ci-bin/

tmp=$cache/.$key.$$.tar.zst
t tar -I 'zstd -T0 -3' -cf "$tmp" node_modules web/node_modules web/dist web/dist-test .ci-bin \
    web/host/src/worker/pkg web/host/src/testing/pkg web/controller/src/pkg web/host/src/procgen/pkg >&2
mv "$tmp" "$cache/$key.tar.zst"
t scripts/ci/web-store.sh put "$key" "$cache/$key.tar.zst" >&2
# Keep the newest 12 builds on this host.
ls -1t "$cache"/*.tar.zst 2>/dev/null | tail -n +13 | xargs -r rm -f
