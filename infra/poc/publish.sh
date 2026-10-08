#!/usr/bin/env bash
# Publish the design POC (art/ui/) to https://jammers-preview.dilger.dev/poc/ (R117: from Gitea Actions only,
# .gitea/workflows/deploy-poc.yml on the `jammers-deploy` runner). The preview edge bind-mounts the TrueNAS folder
# /mnt/vessel/apps/jammers-preview-poc read-only at /srv/ui. The runner's jobs get the TrueNAS host Docker socket, so
# this streams the tree into a throwaway container that has that folder mounted: no SSH key, no secret.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
dest="${POC_HOST_DIR:-/mnt/vessel/apps/jammers-preview-poc}"
owner="${POC_OWNER:-3001:3001}"  # the folder's owner on TrueNAS (chris)
# Never publish an LFS pointer in place of an image (a checkout without `git lfs pull` leaves ~130-byte stubs).
if grep -rl --exclude-dir=vendor '^version https://git-lfs.github.com/spec' "$root/art/ui" 2>/dev/null | head -3 | grep -q .; then
  echo "refusing to publish: art/ui still has LFS pointer files (run: git lfs pull --include='art/ui/**')" >&2; exit 1
fi
# The POC pages reach siblings of art/ui/poc/ (../brand, ../frames, ../sheets, ../GUIDE.md, ...), so the whole art/ui/
# tree is mirrored, minus generation scratch. poc/audio/voice/clips/ (the P1-A01b audition audio) is never committed
# (R89): excluded, so --delete leaves an uploaded copy alone.
excludes=(.DS_Store '*.log' frames/prompts/ frames/ledger.jsonl frames/generate.mjs brand/make.py check.mjs poc/vendor.mjs
  poc/audio/voice/clips/)
rs_ex=""; for e in "${excludes[@]}"; do rs_ex+=" --exclude '$e'"; done
tar -C "$root/art/ui" -cf - . | docker run -i --rm -v "$dest:/dst" alpine:3.22 sh -euc "
  apk add --no-cache -q rsync >/dev/null
  mkdir /src && tar -x -C /src
  rsync -rlt -og --chown=$owner --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r --delete $rs_ex /src/ /dst/"
sleep 1
code=$(curl -s -o /dev/null -w '%{http_code}' "https://jammers-preview.dilger.dev/poc/")
echo "published $(git -C "$root" rev-parse --short HEAD) -> /poc/ (HTTP $code)"
[ "$code" = 200 ]
