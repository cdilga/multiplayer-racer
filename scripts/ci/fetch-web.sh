#!/usr/bin/env bash
# A browser slot's copy of the web build for this commit (docs/infra/ci.md), unpacked into the checkout: from this
# host's cache, else the shared store (scripts/ci/web-store.sh). The slots start with the build job, not after it,
# so when the build is new they poll the store until it lands, and give up at once if the build job failed.
#
# Every archive is checked before it's used (zstd's own checksum; a store download also against the sha256 Gitea
# recorded). A corrupt cached copy is deleted and fetched again; a corrupt stored copy is dropped from the store and the
# slot builds in place (scripts/ci/build-web.sh with JJ_STORE=off). Run 2189's slot died on a corrupt cached archive.
#
# Usage: scripts/ci/fetch-web.sh      (env: JJ_STORE_TOKEN, GITEA_TOKEN, GITHUB_SERVER_URL, GITHUB_REPOSITORY)
set -euo pipefail
cd "$(dirname "$0")/../.."
key=$(scripts/ci/build-key.sh)
cache=${JJ_PREBUILT:-/cargo-cache/jj-prebuilt}
mkdir -p "$cache"
s=$SECONDS
file=$cache/$key.tar.zst

rebuild() {
    echo "fetch-web: $1; building in place" >&2
    # The build job's target dir (cargo's lock makes sharing it safe).
    JJ_STORE=off CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-/cargo-cache/target-jammers-wasm} scripts/ci/build-web.sh
    echo "fetch-web: build $key built in place in $((SECONDS - s))s"
    exit 0
}

if [[ -f $file ]] && ! zstd -tq "$file"; then
    echo "fetch-web: this host's cached $key is corrupt; deleting it" >&2
    rm -f -- "$file"
fi
if [[ ! -f $file ]]; then
    sha=$(git rev-parse HEAD)
    api="${GITHUB_SERVER_URL:-http://192.168.11.12:3001}/api/v1/repos/${GITHUB_REPOSITORY:-cdilga/multiplayer-racer}"
    corrupt=0
    for ((i = 0; ; i++)); do
        rc=0
        scripts/ci/web-store.sh get "$key" "$file" || rc=$?
        [[ $rc == 0 ]] && break
        if [[ $rc == 4 ]]; then
            # Once may be the transfer; twice is the stored copy.
            ((++corrupt < 2)) && continue
            scripts/ci/web-store.sh drop "$key" || true
            rebuild "the stored $key is corrupt (dropped from the store)"
        fi
        state=$(curl -sf -H "Authorization: token ${GITEA_TOKEN:-}" "$api/commits/$sha/statuses?limit=100" |
            python3 -c 'import json,sys; s=[x for x in json.load(sys.stdin) if x["context"].startswith("CI / build")]; print(s[0]["status"] if s else "")' || true)
        [[ $state == failure || $state == error ]] && { echo "fetch-web: the build job failed; nothing to test" >&2; exit 1; }
        ((i < 180)) || { echo "fetch-web: no build $key after 30 min" >&2; exit 1; }
        sleep 10
    done
fi
touch "$file"
if ! tar -I zstd -xf "$file"; then
    rm -f -- "$file"
    rebuild "unpacking $key failed"
fi
ls -1t "$cache"/*.tar.zst 2>/dev/null | tail -n +13 | xargs -r rm -f
echo "fetch-web: build $key ready in $((SECONDS - s))s"
