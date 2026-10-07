#!/usr/bin/env bash
# The CI web builds' shared store (docs/infra/ci.md): Gitea's generic package registry, package `jj-web-build`, one
# version per build key, file `web.tar.zst`. Any job on any runner host reads a build from here in seconds, so the
# browser slots never wait for a build job when the inputs haven't changed, and no build is done twice.
#
# Usage: scripts/ci/web-store.sh has <key>          exit 0 if stored
#        scripts/ci/web-store.sh get <key> <file>   download (exit 1 if absent)
#        scripts/ci/web-store.sh put <key> <file>   upload, then keep only the newest 30 versions
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
cmd=${1:?usage: web-store.sh has|get|put <key> [file]}
key=${2:?key}
case $cmd in
has) curl -sf -o /dev/null -I "${auth[@]}" "$(url "$key")" ;;
get) curl -sf "${auth[@]}" -o "${3:?file}.part" "$(url "$key")" && mv "$3.part" "$3" ;;
put)
    # A version that already exists answers 409: someone else stored the same key first, which is just as good.
    code=$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" --upload-file "${3:?file}" "$(url "$key")")
    [[ $code == 201 || $code == 409 ]] || { echo "web-store: upload answered $code" >&2; exit 1; }
    curl -sf "${auth[@]}" "$server/api/v1/packages/$owner?type=generic&q=$pkg&limit=100" |
        python3 -c 'import json,sys; [print(p["version"]) for p in sorted(json.load(sys.stdin), key=lambda p: p["created_at"], reverse=True)[30:] if p["name"]=="'"$pkg"'"]' |
        while read -r v; do curl -sf -X DELETE "${auth[@]}" "$server/api/v1/packages/$owner/generic/$pkg/$v" || true; done
    ;;
*) echo "usage: web-store.sh has|get|put <key> [file]" >&2; exit 2 ;;
esac
