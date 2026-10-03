#!/usr/bin/env bash
# Licences, advisories, bans and sources for the workspace (deny.toml). Needs cargo-deny installed.
set -euo pipefail
cd "$(dirname "$0")/../.."
cargo deny --locked --all-features check
