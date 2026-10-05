#!/usr/bin/env bash
# Publish the design POC (art/ui/poc/) to https://jammers-preview.dilger.dev/poc/.
# CI runs this on every push touching art/ui/poc/ (.gitea/workflows/poc-deploy.yml, key in $POC_DEPLOY_KEY);
# by hand it uses your own ssh config. The preview edge bind-mounts the target folder at /srv/poc, so this is an
# rsync: no app update, no restart.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
dest="${POC_DEST:-chris@192.168.11.12:/mnt/vessel/apps/jammers-preview-poc/}"
ssh_cmd="ssh -o StrictHostKeyChecking=accept-new"
if [ -n "${POC_DEPLOY_KEY:-}" ]; then
  key="$(mktemp)"; trap 'rm -f "$key"' EXIT
  printf '%s\n' "$POC_DEPLOY_KEY" > "$key"; chmod 600 "$key"
  ssh_cmd="$ssh_cmd -i $key"
fi
# Never publish an LFS pointer in place of an image (a checkout without `git lfs pull` leaves ~130-byte stubs).
if grep -rl --exclude-dir=vendor '^version https://git-lfs.github.com/spec' "$root/art/ui" 2>/dev/null | head -3 | grep -q .; then
  echo "refusing to publish: art/ui still has LFS pointer files (run: git lfs pull --include='art/ui/**')" >&2; exit 1
fi
# The POC pages reach siblings of art/ui/poc/ (../brand, ../frames, ../sheets, ../GUIDE.md, ...), so the whole
# art/ui/ tree is mirrored, minus generation scratch; the edge serves /poc/ and those siblings from it.
# poc/audio/voice/clips/ (the P1-A01b audition audio) is never committed (R89, only the picked voice's exports are):
# it's excluded here, so --delete leaves an uploaded copy alone. The owner uploads it by hand when they want it
# public: rsync -az -e "$ssh_cmd" art/ui/poc/audio/voice/clips/ "${dest}poc/audio/voice/clips/"
rsync -az --delete --exclude '.DS_Store' --exclude '*.log' --exclude 'frames/prompts/' --exclude 'frames/ledger.jsonl' \
  --exclude 'frames/generate.mjs' --exclude 'brand/make.py' --exclude 'check.mjs' --exclude 'poc/vendor.mjs' \
  --exclude 'poc/audio/voice/clips/' \
  -e "$ssh_cmd" "$root/art/ui/" "$dest"
sleep 1
code=$(curl -s -o /dev/null -w '%{http_code}' "https://jammers-preview.dilger.dev/poc/")
echo "published $(git -C "$root" rev-parse --short HEAD) -> /poc/ (HTTP $code)"
[ "$code" = 200 ]
