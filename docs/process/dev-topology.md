# Dev topology: which machine does what

Plan §15.2 (R93) is the source; this page is the working summary for P1-F06. One source of truth
stays on the Mac: the working tree, `br`, Agent Mail and commits. Compute goes wherever there's room.

| Machine | Does | Doesn't |
|---|---|---|
| Mac | Editing, `br`, Agent Mail, commits; per-crate builds, Vite, Playwright, the iOS Simulator and Android emulator, perf receipts for the Mac host | Workspace-wide cargo (disk: `target/` budget 15 GiB) |
| eris | Rust builds through RCH; Playwright (Chromium, WebKit, Firefox), Node/WASM runs, the Android emulator, `linux/amd64` images, audio (R89) through `scripts/remote/eris.sh` | Hold code edits, or anything that must be up: it's intermittent |
| devbox (VM on triton) | Rust builds through RCH | Much disk until its build storage moves to triton's pool |
| TrueNAS runners | Gitea CI and deploys | Interactive work |

## Rules

- **Nobody edits on eris.** Code changes happen in the Mac's tree and reach eris as pushed commits.
  `eris.sh` refuses to run when eris's clone has local changes.
- **Nobody reboots a machine to test anything.** A natural reboot gets noted in the evidence.
- Perf or "looks" numbers from eris only when no audio job holds its GPU, labelled with the machine.
- No other clone, checkout or worktree of the code anywhere. Per-run dirs hold outputs only.

## eris's clone (`ru`)

`ru` 1.5.0 (same script as the Mac's) keeps `~/Work/dev/multiplayer-racer` on `v0.2-revamp`:
`PROJECTS_DIR=~/Work/dev`, `LAYOUT=flat`, `UPDATE_STRATEGY=ff-only`, autostash off, so a dirty
clone is skipped rather than merged. `ru status` shows it; `ru sync` fast-forwards it. Add
`jammers-deploy` with `ru add` once P1-D01 creates it.

Local-only state in that clone (none of it is in the repo):

- 58 untracked files under `spikes/art-pipeline/I-fal-cruze/` (an owner spike) stay in place,
  listed in `~/Work/preserved/multiplayer-racer-untracked-2026-10-03.exclude` (the clone's
  `core.excludesFile`) so `ru` sees a clean tree. A copy is in `~/Work/preserved/`.
- The six mp3s in `art/audio/v0.1-music/tracks/` were plain blobs under an LFS attribute until
  468d35a re-added them through LFS. A clone from before that shows them as modified and can't
  fast-forward. Run `git -c filter.lfs.clean= -c filter.lfs.smudge= -c filter.lfs.process= -c filter.lfs.required=false merge --ff-only`,
  then `git lfs pull --include="art/audio/v0.1-music/tracks/*"`.

## `scripts/remote/eris.sh`

```bash
scripts/remote/eris.sh npx playwright --version
scripts/remote/eris.sh --run c05-journeys 'cd web && npx playwright test'   # outputs in $JJ_RUN_DIR
```

It runs `ru sync` on eris, then refuses unless eris's clone is clean and at the Mac's `HEAD`
(unpushed commits: push first). Then it runs the command in the clone with output streamed back and
the command's exit status (2 usage, 3 refused, 4 eris unreachable). `--run <id>` creates
`~/Work/runs/<id>` and exports it as `JJ_RUN_DIR`: put outputs, evidence, browser profiles and server
state there, never code. Runs share a lock on the clone, so a sync never moves it mid-run. Concurrent
runs work as long as each uses its own run id. Uncommitted Mac changes don't reach eris. For
uncommitted Rust work use RCH, which ships the working tree itself. `ERIS_HOST=eris-remote` works
off the LAN.

## RCH workers

`~/.config/rch/workers.toml` on the Mac lists eris (6 slots, priority 200) and devbox (8 slots,
priority 100). The routing proof (2026-10-03): `RCH_REQUIRE_REMOTE=1 RCH_WORKER=eris rch exec -- cargo check --workspace`
ran on eris and exited 0, and `rch diagnose` picks eris unpinned.

- Use `rch exec -- cargo check -p <crate>` (`RCH_REQUIRE_REMOTE=1` to forbid a local fallback,
  `RCH_WORKER=eris` to pick one). `rch workers probe --all` checks the fleet.
- Don't set `os = "linux"` on a worker. In RCH 2.1.15 a declared `os` makes the worker exclusive to
  commands that require that OS, and only Windows and Apple targets ever do, so the worker gets
  nothing. devbox had the line and got no builds until 2026-10-03.
- A worker mirrors the project at the Mac's own path (`/Users/cdilga/Documents/dev/...`), so
  `/Users/cdilga` must exist and be writable there.
- `rch-wkr`'s preflight wants a canonical root, default `/data/projects` plus `/dp`. Workers without
  those set `RCH_WKR_CANONICAL_ROOT`/`RCH_WKR_ALIAS_ROOT` to the Mac's layout; eris does it in a
  wrapper (`~/.local/bin/rch-wkr` execs `rch-wkr.bin`). **Re-install the wrapper after any
  `rch workers deploy-binary eris`.** The symptom is `hard preflight (canonical_missing)`.
- Free disk is measured at the worker's **`/tmp`**, and RCH gives a worker no slots below
  `min_free_gb` (30) plus 10 GB per slot. A RAM-disk `/tmp` (eris) or a nearly full disk (devbox,
  until its storage moves to triton's pool) means 0 slots.
- Every worker needs the pinned toolchain from `rust-toolchain.toml` with the wasm target:
  `rch workers sync-toolchain <id>`, then `rustup target add wasm32-unknown-unknown --toolchain <pin>`.
- Restart the daemon with `rch daemon restart` (`--force` only when `rch queue` shows nothing
  running), not `launchctl kickstart`. "remote build admission is paused while daemon restart
  remediation is active" means leftover client leases in `~/.local/state/rch/job-leases/`. A lease
  whose wrapper PID got reused by another process never clears on its own.

## When eris is off

- Rust: `rch exec -- cargo …` falls back to devbox, then to a local run (keep local runs per-crate).
- Playwright, Node, the Android emulator: run them on the Mac, or wait for eris; nothing may depend
  on it being up.
- `eris.sh` exits 4 with a pointer here.

## eris notes (2026-10-03)

- A plain `ssh eris cmd` gets PAM's PATH (`/etc/security/pam_env.conf`): `/usr/local/bin` comes
  before Arch's `/usr/bin/cargo` (1.98). Symlinks there point at rustup's proxies, so plain ssh, RCH
  and `eris.sh` all honour `rust-toolchain.toml`.
- mise reads `.nvmrc` (`idiomatic_version_file_enable_tools = ["node"]`), so commands in the clone run
  the pinned Node.
- Playwright 1.57's browser install hangs while unzipping under Node 26 (26.8.2 and 26.10.0 both
  stall on Chromium's `libwidevinecdm.so`). Install browsers with
  `mise exec node@24 -- npx playwright install <browser>`; running the browsers on Node 26 is fine.
- WebKit works: it launches headless, has WebGL 2 and takes screenshots.
  - Playwright's WebKit is its Ubuntu 24.04 build, so it needs `flite` and `libxml2-legacy` (Arch extra).
  - ICU 74 and libvpx `.so.9` come from the signed Arch archive packages `icu-74.2-2` and `libvpx-1.14.1-1`.
  - Six flite voices are built from flite 2.2's source, because Arch's flite leaves them out.
  - All of that lives in `/usr/local/lib/playwright-compat` (registered in `/etc/ld.so.conf.d/`). Its
    sonames differ from Arch's, so nothing system-wide changes.
  - A new Playwright version may need a different set: `ldd` its `MiniBrowser` with the bundle's `lib`
    and `sys/lib` on `LD_LIBRARY_PATH`.
- Docker on eris needs the `docker` group, which `cdilga` isn't in.
- `/tmp` is a 16 GB RAM disk until the next boot. `tmp.mount` is masked, so after a reboot `/tmp` is
  on disk. Until then its size cap is raised to 120 GB, so RCH's disk check sees room (nothing big
  writes there).
- Android: SDK in `~/Android/Sdk`; its Java tools need
  `mise exec java@temurin-21.0.12+8.0.LTS -- …` (JDK 21, not activated globally). AVD
  `jj-ctrl-api37-play` (API 37.0 Play image, has Chrome). Boot it with
  `emulator -avd jj-ctrl-api37-play -no-window -no-audio -no-snapshot -gpu swiftshader_indirect`.

## Undoing eris's setup

Everything P1-F06 put on eris, and how to take it out. User-local tools (rustup, the Android SDK,
mise's Node and JDK, `ru`) are ordinary tools you may want to keep anyway.

| What | Undo |
|---|---|
| RCH mirror `/Users/cdilga` and staging `/var/tmp/rch` (`/tmp/rch` links there) | `sudo rm -rf /Users /var/tmp/rch /etc/tmpfiles.d/rch.conf` |
| `rch-wkr` wrapper and binary | `rm ~/.local/bin/rch-wkr ~/.local/bin/rch-wkr.bin ~/.local/bin/rustup`; drop eris from the Mac's `~/.config/rch/workers.toml` |
| rustup proxies in `/usr/local/bin` (cargo, rustc, rustup, wasm-bindgen, …) | `sudo find /usr/local/bin -lname "$HOME/.cargo/bin/*" -delete` |
| rustup itself (`~/.rustup`, `~/.cargo`) | `rustup self uninstall`; restore `~/.bashrc.pre-p1f06` |
| WebKit libraries | `sudo rm -rf /usr/local/lib/playwright-compat /etc/ld.so.conf.d/playwright-compat.conf && sudo ldconfig`; `sudo pacman -Rs flite libxml2-legacy` |
| `/tmp` on disk | `sudo systemctl unmask tmp.mount` (takes effect at the next boot) |
| mise reading `.nvmrc` | `mise settings unset idiomatic_version_file_enable_tools` |
| Playwright browsers, the Android SDK and AVD | `rm -rf ~/.cache/ms-playwright ~/Android ~/.android` |
| The ru clone, run dirs and preserved files | `ru remove cdilga/multiplayer-racer`; `~/Work/dev/multiplayer-racer`, `~/Work/runs`, `~/Work/preserved` |

## Disk housekeeping

- `scripts/reclaim-target.sh [--dry-run] [--all]`: keeps the Mac's `target/` under 15 GiB (prunes
  incremental caches and lane dirs idle for 14 days).
- `scripts/prune-caches.sh [--dry-run]`: from the Mac or on eris. Moves run dirs idle for 3 days to
  `~/Work/runs/.pruned/`, deletes them 3 days later, and reports eris's cache sizes.
