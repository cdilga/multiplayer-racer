# Build and toolchain learnings (append-only)

## 2026-10-03 · RCH 2.1.15 silently builds on the Mac when every worker declares an `os` (P1-F01)

- **Symptom:** `rch exec -- cargo check --workspace` "succeeds" in under a second and `rch status` shows
  `Builds: 0 total` plus `local fallback build(s) … no admissible workers: os_gate_excluded=1
  required_os=none`. The command ran on the Mac, not devbox.
- **Cause:** rch 2.1.15 admits a worker that declares `os = "…"` in `~/.config/rch/workers.toml` only for
  commands that target that OS; plain `cargo check/test` is "unqualified", and devbox is our only worker
  and is tagged `os = "linux"`. Passing `--target x86_64-unknown-linux-gnu` doesn't qualify the command.
- **Check before trusting a receipt:** `rch status | grep -i fallback` after the run. A receipt that claims
  RCH must name the worker.
- **Fix (owner, shared config):** remove the `os` line from the devbox worker (or add an untagged worker)
  and restart the daemon. Until then, build one crate at a time on the Mac (`cargo … -p <crate>`), never the
  whole workspace.

## 2026-10-03 · dcg blocks `>` redirects to computed paths

- `cat > "$VAR"` and loops writing `web/$p/…` are blocked by dcg (`redirect-truncate-dynamic-path`). Write
  files with the Write tool or a Python script, and redirect only to literal paths.
