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

## 2026-10-03 · Push LFS objects before the branch

- GitHub declines a push (`pre-receive hook declined`) whose commits reference LFS objects it doesn't have yet. Run
  `git lfs push --all origin <branch>` first, then `git push`.

## 2026-10-03 · RCH: don't `rch daemon start` while launchd runs the daemon; eris needs the canonical-root wrapper

- `rch daemon restart --drain` killed by a timeout leaves admission paused ("restart remediation is active");
  `rch daemon reload` doesn't clear it, and a plain restart is refused by the admission barrier even when nothing
  is in flight. `rch daemon restart -y --force` with no builds running stops it cleanly.
- The Mac's daemon is a launchd agent (`com.rch.daemon`, KeepAlive). Running `rch daemon start` beside it starts
  a second `rchd`, which fails and unlinks the live socket: `rch status` then says the socket is missing while
  `rchd` is running. Fix: `launchctl kickstart -k gui/$(id -u)/com.rch.daemon`, and never `rch daemon start` here.
- A worker fails the hard preflight `canonical_missing` unless rch-wkr's canonical root exists on it (default
  `/data/projects` + `/dp`). eris uses a wrapper at `~/.local/bin/rch-wkr` that exports
  `RCH_WKR_CANONICAL_ROOT=/Users/cdilga/Documents/dev` (re-install it after `rch workers deploy-binary`), then
  `rch workers probe eris` refreshes the cached result. devbox drops to 0 slots under disk pressure (< ~8% free).

## 2026-10-03 · RCH and WASM tests (P1-M01)

- `rch exec -- cargo run …` succeeds remotely but exits **102** (RCH-E327): it brings Linux binaries back to an aarch64
  Mac and flags them. The program's own output is above the error. For a one-off run use
  `RCH_ALLOW_FOREIGN_ARTIFACTS=1`; tests (`cargo test`) aren't affected.
- `wasm-bindgen-test-runner` writes CommonJS glue into `$TMPDIR`. RCH sets `TMPDIR` inside the repo, and the root
  `package.json` says `"type": "module"`, so Node loads the glue as ESM and dies ("exports is not defined"). The WASM test
  runner is `scripts/wasm-test-runner.sh` (`.cargo/config.toml`), which runs it with `TMPDIR=/tmp`.
- cargo-deny (P1-M01): `scripts/ci/deny.sh | tail -1` hides deny's exit code in a shell chain; check `${PIPESTATUS[0]}` or run it bare. deny.toml lists the real targets, since an emscripten-only optional Tokio otherwise fails the ban.
- Staging `Cargo.lock` by hand (P1-V01): leaving out another agent's dev-dependency line isn't enough; their manifest
  edits add lines too (a `jj-types` dep under `jj-wasm-input`), and a lock that doesn't match the committed manifests
  fails CI's `--locked` at the first step. Check the staged tree before committing: export the index's manifests and lock
  (`git checkout-index --prefix=<scratch>/ Cargo.toml Cargo.lock rust-toolchain.toml` plus `crates/`) and run
  `cargo metadata --locked --offline` there.
- `cargo test -q --target wasm32-unknown-unknown` passes `--quiet` to `wasm-bindgen-test-runner`, which rejects it; run
  the WASM tests without `-q`.
- `rch exec -- cargo run …` returns the program's stdout on stderr (mixed with RCH's logs) and pulls the worker's Linux
  binaries into the local `target/debug/`, where a later local `cargo run` can find them fresh and fail with an exec
  format error. Extract the output from stderr, and delete a pulled binary (`file target/debug/jj`) before running locally.
- Two builds of one wasm crate (P1-F05b): `cargo build -p jj-wasm-host` and `… --features testing` both write
  `target/wasm32-unknown-unknown/<profile>/jj_wasm_host.wasm`, so run wasm-bindgen after each build, before the next
  overwrites it (`scripts/build-host-wasm.sh`). `--out-name` gives the testing build distinct file names, which the vite
  config uses to route it under `dist/test/`.
- Vite (8, rolldown) names a dynamically imported chunk, a `new Worker(new URL(…))` worker and the worker's
  `new URL('*.wasm', import.meta.url)` asset after their source files. `web/vite.config.ts` sends anything whose name
  contains `testing` to `test/` through `entryFileNames`, `chunkFileNames` and `assetFileNames`, in both
  `build.rollupOptions.output` and `worker.rollupOptions.output`. `scripts/ci/bundle-check.mjs` catches a slip.
- The worker guard hook (`.claude/hooks/worker-guard.sh`) matches the text `cargo … --workspace` anywhere in a Bash
  command, heredoc bodies included. Write files that mention it (CI YAML, scripts) with the Write tool instead.
- Emulating pads in Playwright (P1-C05): `Object.defineProperty(navigator, 'getGamepads', { value: () => pads })` in an
  init script, plus `gamepadconnected`/`gamepaddisconnected` events built as `new Event(type)` with
  `Object.defineProperty(e, 'gamepad', { value: pad })`. Plain assignment to `navigator.getGamepads` doesn't stick.
  Pad objects need `index`, `connected`, `mapping: 'standard'`, `axes` and `buttons[{pressed, value}]`. The Gamepad
  API's stick y is negative up, so flip it.
- `1 << 31` in JS is negative (int32). A wasm-bindgen `u32` parameter still receives the bit pattern (`LOCAL_UNAVAILABLE`
  arrives as 0x8000_0000), but don't compare it with `>` in JS.
- Two clocks: main's and a worker's `performance.now()` have different origins. Ages across them use
  `performance.timeOrigin + performance.now()` on both sides.
