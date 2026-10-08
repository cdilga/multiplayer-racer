#!/usr/bin/env bash
# The CI web builds' shared store (docs/infra/ci.md): Gitea's generic package registry, package `jj-web-build`, one
# version per build key, file `web.tar.zst`. Any job on any runner host reads a build from here in seconds, so the
# browser slots never wait for a build job when the inputs haven't changed, and no build is done twice.
#
# Usage: scripts/ci/web-store.sh has <key>          exit 0 if stored
#        scripts/ci/web-store.sh get <key> <file>   download (exit 1 if absent, 4 if the copy is corrupt: its sha256
#                                                   isn't the one Gitea recorded, or zstd's own check fails)
#        scripts/ci/web-store.sh put <key> <file>   check the archive, upload, then keep only the newest 30 versions
#        scripts/ci/web-store.sh drop <key>         delete a stored version (a corrupt one)
# Env: JJ_STORE_TOKEN (package read/write for the owner; falls back to GITEA_TOKEN), GITHUB_SERVER_URL.
set -euo pipefail
server=${GITHUB_SERVER_URL:-http://192.168.11.12:3001}
owner=cdilga
pkg=jj-web-build
# The first token that can read the owner's packages: the store secret, else the job's own token.
auth=()
for tok in "${JJ_STORE_TOKEN:-}" "${GITEA_TOKEN:-}"; do
    [[ -n $tok ]] || continue
    if curl -sf -o /dev/null -u "$owner:$tok" "$server/api/v1/packages/$owner?type=generic&limit=1"; then
        auth=(-u "$owner:$tok")
        break
    fi
done
[[ ${#auth[@]} -gt 0 ]] || { echo "web-store: no token can read $owner's packages (JJ_STORE_TOKEN, GITEA_TOKEN)" >&2; exit 3; }
url() { echo "$server/api/packages/$owner/generic/$pkg/$1/web.tar.zst"; }
cmd=${1:?usage: web-store.sh has|get|put|drop <key> [file]}
key=${2:?key}
case $cmd in
has) curl -sf -o /dev/null -I "${auth[@]}" "$(url "$key")" ;;
get)
    # A unique temp name (mktemp, not $$: jobs are containers sharing one cache dir, and their PIDs collide).
    part=$(mktemp "${3:?file}.XXXXXX")
    trap 'rm -f "$part"' EXIT
    curl -sf "${auth[@]}" -o "$part" "$(url "$key")" || exit 1
    want=$(curl -sf "${auth[@]}" "$server/api/v1/packages/$owner/generic/$pkg/$key/files" |
        python3 -c 'import json,sys; print(next((f["sha256"] for f in json.load(sys.stdin) if f["name"]=="web.tar.zst"), ""))' || true)
    got=$(sha256sum "$part" | cut -d' ' -f1)
    if [[ -n $want && $got != "$want" ]]; then echo "web-store: $key downloaded with sha256 $got, stored as $want" >&2; exit 4; fi
    zstd -tq "$part" || { echo "web-store: $key fails zstd's integrity check" >&2; exit 4; }
    mv -f -- "$part" "$3"
    ;;
put)
    zstd -tq "${3:?file}" || { echo "web-store: refusing to store $key: the archive fails zstd's integrity check" >&2; exit 4; }
    # A version that already exists answers 409: someone else stored the same key first, which is just as good.
    code=$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" --upload-file "$3" "$(url "$key")")
    [[ $code == 201 || $code == 409 ]] || { echo "web-store: upload answered $code" >&2; exit 1; }
    curl -sf "${auth[@]}" "$server/api/v1/packages/$owner?type=generic&q=$pkg&limit=100" |
        python3 -c 'import json,sys; [print(p["version"]) for p in sorted(json.load(sys.stdin), key=lambda p: p["created_at"], reverse=True)[30:] if p["name"]=="'"$pkg"'"]' |
        while read -r v; do curl -sf -X DELETE "${auth[@]}" "$server/api/v1/packages/$owner/generic/$pkg/$v" || true; done
    ;;
drop) curl -sf -X DELETE "${auth[@]}" "$server/api/v1/packages/$owner/generic/$pkg/$key" ;;
*) echo "usage: web-store.sh has|get|put|drop <key> [file]" >&2; exit 2 ;;
esac
