#!/usr/bin/env bash
# The CI web build's key (docs/infra/ci.md): a hash of every tracked file a build reads (everything except docs, tests,
# plans and tooling no build reads, and CI's own planning files). Same key, same tarball, on any host and in any run.
set -euo pipefail
cd "$(dirname "$0")/../.."
git ls-files -s |
    grep -vE $'\t''(docs/|spikes/|\.beads/|\.claude/|\.apr/|\.ntm/|\.gitea/|web/tests/(journeys|smoke)/|art/(audio|references|style)/|tools/(maps|vehicles|turn-guard)/|scripts/(beads|emulators|remote)/|scripts/ci/(plan\.mjs|run-slot\.mjs|targets\.mjs|durations\.mjs|durations\.json|fetch-web\.sh|web-store\.sh)$|[^/]*\.md$|.*\.md$|.*\.test\.mjs$)' |
    sha256sum | cut -c1-24
