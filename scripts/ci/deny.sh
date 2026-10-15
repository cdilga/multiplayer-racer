#!/usr/bin/env bash
# Advisories, bans and sources for the workspace (deny.toml). Needs cargo-deny installed. Licences aren't checked (owner,
# 2026-10-16, R135).
set -euo pipefail
cd "$(dirname "$0")/../.."
cargo deny --locked --all-features check advisories bans sources
