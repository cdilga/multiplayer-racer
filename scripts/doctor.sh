#!/usr/bin/env bash
# Toolchain versions against the repo's pins, one line each. Run by CI and when setting up a machine
# (P1-F02 wires it into CI); agents don't run it mid-session. Exit 0 all good, 1 a required tool is
# missing or off its pin.
#   scripts/doctor.sh            this machine
#   scripts/doctor.sh --remote eris   the same checks in eris's clone (via scripts/remote/eris.sh)
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")/..")"
if [[ ${1:-} == --remote ]]; then exec scripts/remote/eris.sh scripts/doctor.sh; fi

bad=0
line() { printf '%-9s %-14s %s\n' "$1" "$2" "$3"; [[ $1 == ok || $1 == note ]] || bad=1; }
check() { # name want have
    if [[ -z $3 ]]; then line missing "$1" "want $2"
    elif [[ $3 == "$2" ]]; then line ok "$1" "$3"
    else line MISMATCH "$1" "have $3, want $2"; fi
}
ver() { "$@" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1; }

rust_pin=$(sed -n 's/^channel *= *"\(.*\)"/\1/p' rust-toolchain.toml)
check rustc "$rust_pin" "$(ver rustc --version)"
if rustup +"$rust_pin" target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
    line ok wasm32 "target installed"
else line missing wasm32 "rustup +$rust_pin target add wasm32-unknown-unknown"; fi
check wasm-bindgen "$(sed -n 's/^wasm-bindgen *= *"=\(.*\)"/\1/p' Cargo.toml)" "$(ver wasm-bindgen --version)"
check node "$(tr -d ' v\n' <.nvmrc)" "$(ver node -v)"
command -v git-lfs >/dev/null && line ok git-lfs "$(ver git lfs version)" || line missing git-lfs "install git-lfs"

# Tracker tools live where the tracker does (the Mac); elsewhere they're only noted.
if command -v br >/dev/null; then
    have=$(ver br --version)
    if [[ $(printf '%s\n0.7.4\n' "$have" | sort -V | head -1) == 0.7.4 ]]; then line ok br "$have"
    else line MISMATCH br "have $have, want >= 0.7.4"; fi
else line note br "not on this machine"; fi
exit $bad
