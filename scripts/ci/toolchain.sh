#!/usr/bin/env bash
# The pinned Rust toolchain (rust-toolchain.toml) on the runner's persistent /cargo-cache, installed once per host and
# reused by every job there. Adds $CARGO_HOME/bin to the job's PATH.
set -euo pipefail
test -w /cargo-cache
if [ ! -x "$CARGO_HOME/bin/rustup" ]; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain none
fi
echo "$CARGO_HOME/bin" >>"$GITHUB_PATH"
"$CARGO_HOME/bin/rustup" show active-toolchain >/dev/null 2>&1 || "$CARGO_HOME/bin/rustup" toolchain install
"$CARGO_HOME/bin/rustup" show active-toolchain
