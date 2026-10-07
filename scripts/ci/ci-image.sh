#!/usr/bin/env bash
# Build the CI job image (scripts/ci/ci-image.Dockerfile) on a runner host's Docker, or print its tag.
#
# Usage: scripts/ci/ci-image.sh --tag            print the tag the workflow must use (jj-ci:<hash of the Dockerfile>)
#        scripts/ci/ci-image.sh <ssh-host> [sudo] build it on that host (`sudo` when the login isn't in the docker group)
#
# The tag is content-addressed, so the workflow's `container: image:` and every host agree without a registry: when the
# Dockerfile changes, run this for each runner host (docs/infra/ci-runners.md lists them) before pushing the workflow.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
file="$here/ci-image.Dockerfile"
tag="jj-ci:$(shasum -a 256 "$file" | cut -c1-12)"
[[ ${1:-} == --tag ]] && { echo "$tag"; exit 0; }
host=${1:?usage: ci-image.sh --tag | <ssh-host> [sudo]}
pre=${2:-}
ssh -o BatchMode=yes "$host" "$pre docker image inspect $tag >/dev/null 2>&1 && echo 'present: $tag' || $pre docker build -q -t $tag -" <"$file"
