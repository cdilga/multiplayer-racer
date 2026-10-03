# Where 0.2 lives and how it builds (P1-D01)

**Gitea is primary** (R18): `http://192.168.11.12:3001/cdilga/multiplayer-racer` (default branch `v0.2-revamp`; the
`v0.1-final` tag is there for reading old code). GitHub `cdilga/multiplayer-racer` is the passive mirror, and `main` and
production 0.1 keep deploying from GitHub as before.

| Repo | What | Secrets |
|---|---|---|
| `cdilga/multiplayer-racer` | game code, art, tools, docs, CI (`.gitea/workflows/`) | none: any pushed branch can edit a workflow, so nothing here may read a secret |
| `cdilga/jammers-deploy` | deploy workflows, deploy secrets, smoke steps, the preview register, edge config, `turn-broker` (filled by D02–D05) | all of them |

## Pushing

`scripts/push.sh` (or `scripts/beads/close.sh`, which calls it) pushes the branch to Gitea and then GitHub, each with its
LFS objects first. The shared tree's `v0.2-revamp` tracks `gitea/v0.2-revamp`. Remotes: `gitea` is
`http://192.168.11.12:3001/cdilga/multiplayer-racer.git` (HTTP with the Mac keychain credential; Gitea's SSH port isn't
open), `origin` is GitHub.

There's no Gitea push mirror: Gitea push mirrors push with `--mirror`, which would prune every GitHub branch Gitea doesn't
carry, `main` included, and production 0.1 deploys from GitHub's `main`.

LFS lives on Gitea too (`art/**`, `spikes/**`, `assets/**`, evidence media): a clean clone from Gitea fetches it.

## CI

`.gitea/workflows/ci.yml` runs on every push: `rust` (fmt, check native + wasm facades, clippy, no-Tokio, cargo-deny),
`web` (type-check + Vite build), `checks` (UI tokens, cue sheet, engine-synth bundle, look recipes). P1-F02 grows it into
the fast/build/browser lanes of plan §12.1. No GitHub Actions and no GHCR for 0.2; images go to the Gitea package
registry (D02).

`scripts/ci-status.sh [--wait] [<rev>]` prints each lane for a commit and the run URL last; exit 0 green, 1 red,
2 pending.

## Runners

- **Today:** a shared runner with the `ubuntu-latest` label serves this repo, and all three jobs run there; the `rust` job
  keeps the toolchain, cargo downloads and `target/` in the actions cache.
- **Owner action pending:** the persistent-cache Rust runners, `physical-soccer-rust-truenas` and
  `physical-soccer-rust-triton` (label `rust`), are still scoped to Physical Soccer. The owner ruled on 2026-10-02 that
  runners are shared, but re-registering them was refused to this session because it touches another project's running
  CI. Steps, per runner: fetch a user-scope token (`tea api --login gitea-lan /user/actions/runners/registration-token`),
  stop the container, move its `data/.runner` aside, start it once with `GITEA_RUNNER_REGISTRATION_TOKEN`, then recreate
  it without the token, and delete the old repository-scoped entry. Then point the `rust` job back at `runs-on: rust` with
  `CARGO_HOME`/`RUSTUP_HOME`/`CARGO_TARGET_DIR` under `/cargo-cache` (warm Rust jobs measured 4 s vs 168 s cold in Physical
  Soccer).
- triton's GPU runner (GTX 1080) becomes the headed 4K perf lane once it's shared the same way.
