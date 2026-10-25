#!/usr/bin/env bash
# The Python renderer owns pause/restore inside its GPU lock, including SIGTERM.
set -eu
"$HOME/Work/dev/jammers-audio/.venv/bin/python" "$@"
