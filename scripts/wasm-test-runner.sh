#!/bin/sh
# The WASM test runner (.cargo/config.toml). wasm-bindgen-test-runner writes CommonJS glue into $TMPDIR, and RCH points
# TMPDIR inside the repo, whose package.json says "type": "module", so Node would read the glue as ESM and fail.
# Use the system temp directory instead.
TMPDIR=/tmp exec wasm-bindgen-test-runner "$@"
