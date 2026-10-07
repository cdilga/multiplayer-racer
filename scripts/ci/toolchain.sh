#!/usr/bin/env bash
# The pinned Rust toolchain (rust-toolchain.toml). In CI: on the runner's persistent /cargo-cache, installed once per
# host and reused by every job there, with $CARGO_HOME/bin added to the job's PATH. Elsewhere (the verifier's local
# runner on eris, P1-F02): the machine's own rustup installs the pinned toolchain if it's missing.
set -euo pipefail
if [[ ! -w /cargo-cache ]]; then
    command -v rustup >/dev/null || { echo "toolchain: no /cargo-cache and no rustup on $(hostname)" >&2; exit 1; }
    rustup show active-toolchain >/dev/null 2>&1 || rustup toolchain install
    rustup show active-toolchain
    exit 0
fi
if [ ! -x "$CARGO_HOME/bin/rustup" ]; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain none
fi
echo "$CARGO_HOME/bin" >>"${GITHUB_PATH:-/dev/null}"
"$CARGO_HOME/bin/rustup" show active-toolchain >/dev/null 2>&1 || "$CARGO_HOME/bin/rustup" toolchain install
"$CARGO_HOME/bin/rustup" show active-toolchain
