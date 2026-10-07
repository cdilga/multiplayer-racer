#!/usr/bin/env bash
# CI's one web build (docs/infra/ci.md): the sim/input/procgen WASM, both npm installs, the Vite pages, the S02 harness
# and the native jj and jj-server the browser tests drive, packed as one tarball every browser slot unpacks. The build's
# own checks (worker typechecks, test code kept out of the shipped bundles, current tokens, the landing path free of the
# renderer, runtime origins) run here, so a tarball only exists for inputs that passed them.
#
# Keyed by the inputs (every tracked file except docs, tests, plans and tooling no build reads, plus this script): a key
# already in the host's prebuilt cache is reused as is, so a push that only changes tests or docs never rebuilds.
#
# Usage: scripts/ci/build-web.sh <out.tar.zst>    (env: CARGO_TARGET_DIR; cache dir JJ_PREBUILT, default
#        /cargo-cache/jj-prebuilt; prints `key=<key>` and `hit=true|false` for $GITHUB_OUTPUT)
set -euo pipefail
cd "$(dirname "$0")/../.."
out=${1:?usage: build-web.sh <out.tar.zst>}
cache=${JJ_PREBUILT:-/cargo-cache/jj-prebuilt}

key=$(git ls-files -s | grep -vE $'\t''(docs/|spikes/|\.beads/|\.claude/|\.apr/|\.ntm/|\.gitea/|web/tests/(journeys|smoke)/|art/(audio|references|style)/|tools/(maps|vehicles|turn-guard)/|scripts/(beads|emulators|remote)/|scripts/ci/(plan\.mjs|run-slot\.mjs|durations\.mjs|durations\.json)$|[^/]*\.md$|.*\.md$|.*\.test\.mjs$)' |
    sha256sum | cut -c1-24)
echo "key=$key"
mkdir -p "$cache"
if [[ -f $cache/$key.tar.zst ]]; then
    cp "$cache/$key.tar.zst" "$out"
    touch "$cache/$key.tar.zst"
    echo "hit=true"
    exit 0
fi
echo "hit=false"

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
cp "$cache/$key.tar.zst" "$out"
# Keep the newest 12 builds on this host.
ls -1t "$cache"/*.tar.zst 2>/dev/null | tail -n +13 | xargs -r rm -f
