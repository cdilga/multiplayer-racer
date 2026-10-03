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

## 2026-10-03 · Playwright's browser revision must match the installed browsers (P1-U01)

- Root tooling pinned Playwright 1.57 (Chromium build 1200) while the Mac only had build 1234 (Playwright
  1.62.1). `npx playwright install chromium` then hung for over 10 minutes and left a 428 KB stub
  `chromium-1200/` folder. The fix was to move root Playwright to 1.62.1, matching what was installed.
- Check with `ls ~/Library/Caches/ms-playwright/` before installing: the browser folder's number must match
  the version's `playwright-core/browsers.json`.
