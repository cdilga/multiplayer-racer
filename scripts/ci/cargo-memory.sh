#!/usr/bin/env bash
# Source before Cargo builds. The 8 GiB TrueNAS jobs expose all host CPUs; Cargo's default parallelism can
# OOM-kill asupersync on a cold cache (9187 build, previously 5414/5495/5531 tests). Keep the existing test-lane
# setting for small containers in the web build too. Larger runners and explicit operator settings are unchanged.
jj_cargo_memory=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo max)
if [[ $jj_cargo_memory =~ ^[0-9]+$ && $jj_cargo_memory -lt $((12 * 1024 * 1024 * 1024)) && -z ${CARGO_BUILD_JOBS:-} ]]; then
    export CARGO_BUILD_JOBS=4
    echo "cargo-memory: job memory $((jj_cargo_memory / 1024 / 1024)) MiB: CARGO_BUILD_JOBS=4" >&2
fi
unset jj_cargo_memory
