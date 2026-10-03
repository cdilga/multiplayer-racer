# Dependency qualification (P1-F03)

Every dependency the Playtest-1 build ships: pinned, with features, licence, source and why. "No runtime CDNs" (R70) and
"no Tokio" (R2) are checked in CI, not intended: `scripts/ci/deny.sh` (licences, advisories, bans incl. Tokio, sources),
`scripts/ci/no-tokio.sh` (`cargo tree`), and `scripts/ci/origin-scan.mjs` over the built bundles. Lockfiles are committed
(`Cargo.lock`, `web/package-lock.json`) and every CI build uses them (`--locked`, `npm ci`).

## Toolchains

| What | Pin | Where | Why |
|---|---|---|---|
| Rust | 1.99.0 | `rust-toolchain.toml` (+ `rustfmt`, `clippy`, `wasm32-unknown-unknown`) | the newest stable release (owner, 2026-10-03: latest release, never nightly); the same on the Mac, eris, devbox and CI |
| Node | 26.10.0 | `.nvmrc`, `web/package.json` `engines` | the latest release (owner, 2026-10-03: latest, not LTS); replaces 0.1's 18.20.8 everywhere; eris's mise and CI's `setup-node` read `.nvmrc` |

## Rust crates (direct)

| Crate | Pin | Features | Licence | Source | Used by | Why |
|---|---|---|---|---|---|---|
| `wasm-bindgen` | `=0.2.129` | default | MIT OR Apache-2.0 | crates.io | `jj-wasm-*` | exact pin: the CLI on the Mac, eris and CI must match the crate |
| `serde` | 1.0.229 | `derive` | MIT OR Apache-2.0 | crates.io | `jj-types`, `jj-protocol` | wire types |
| `postcard` | 1.1.3 | `alloc` (no default) | MIT OR Apache-2.0 | crates.io | `jj-protocol` | compact, stable binary encoding for the cmd channel and worker ABI (goldens pin the bytes) |
| `serde_json` | 1.0.151 | default | MIT OR Apache-2.0 | crates.io | `jj-protocol` | server API v1 bodies |
| `rapier3d` | 0.36.0 | `enhanced-determinism` | Apache-2.0 | crates.io | `jj-sim` (P1-S01) | the physics and vehicle controller; `enhanced-determinism` forces libm maths, so a replay is bit-identical on native and wasm32 |
| `arbitrary` | 1.4.2 | `derive` | MIT OR Apache-2.0 | crates.io | tests only | structured fuzzing of every wire message |
| `proptest` | 1.11.0 | `std` (no default) | MIT OR Apache-2.0 | crates.io | tests only | property tests |
| **Asupersync** | **not pinned** | — | **MIT + OpenAI/Anthropic rider** | crates.io 0.5.0 | `jj-server` (P1-N02) | **blocked: see below** |

Transitive crates: `cargo deny` allows only the licences in `deny.toml` (all GPL-3.0-compatible), denies Tokio and unknown
registries or git sources, and fails on yanked versions. Built and checked on eris through RCH, 2026-10-03: `cargo check -p
jj-sim -p jj-wasm-host` (native) and `--target wasm32-unknown-unknown -p jj-sim -p jj-wasm-host -p jj-wasm-procgen -p
jj-wasm-input`, both with rapier3d 0.36.0 (`docs/evidence/P1-F03/`).

### Asupersync: blocked on an owner decision

R2 names Asupersync for the server. Its 0.5.0 licence (`LICENSE` in the published crate, SPDX
`LicenseRef-MIT-OpenAI-Anthropic-Rider`) is MIT plus a rider that controls over the rest:

- It grants **no rights to OpenAI, Anthropic or anyone "acting directly or indirectly on behalf of, for the benefit of, or
  under the direction of"** them.
- It forbids making the software or derivatives available to them, and its "use" includes "executing, benchmarking,
  testing, analyzing, indexing" and putting it into "any … pipeline for machine learning or other automated systems".
- Any breach terminates the licence.

Two consequences for this project:

1. **GPL-3.0 compatibility.** The game is GPL-3.0-or-later, and GPL-3.0 §7 and §10 forbid adding restrictions. A server
   binary that links Asupersync carries a field-of-use restriction, so it can't be distributed under the GPL as one work.
2. **How the project is built.** Claude agents (Anthropic's model) write, build and test this repo. An agent compiling,
   testing or reading Asupersync's source is plausibly what the rider prohibits, and the risk falls on the owner as licensee.

So Asupersync isn't in `Cargo.toml`, `deny.toml` doesn't allow its licence, and no agent has built or analysed its source
(only its `LICENSE` was read). P1-N02, which builds the server on it, waits for the owner. R2's "no Tokio" stands either way.

## Web packages (`web/`)

| Package | Pin | Licence | In | Why |
|---|---|---|---|---|
| `three` | 0.186.1 | MIT | `@jj/host` | the renderer (WebGPURenderer vs WebGLRenderer is P1-R01's call). The design POC and spikes use the root tooling's 0.182.0, which doesn't ship |
| `uqr` | 0.1.3 | MIT | `@jj/host` | the host's join QR: a tiny encoder that hands back the module matrix, so the QR rule (≥ 8 px per module, full quiet zone) is drawn exactly (G00/R07) |
| `jsqr` | 1.4.0 | Apache-2.0 | `@jj/controller` | the controller's fallback QR decoder when `BarcodeDetector` is missing (C04). Pure JS and fetches nothing. `zxing-wasm` decodes better but loads its `.wasm` from jsDelivr by default, so that URL would sit in the bundle |
| `vite` | 8.3.2 | MIT | dev | multi-page build; base path from `JJ_BASE` (`/p/<id>/` in previews) |
| `typescript` | 7.0.2 | Apache-2.0 | dev | type checks |
| `@types/node`, `@types/three` | 26.6.4, 0.186.0 | MIT | dev | types |

## Runtime origins (R70)

`docs/deps/origins.json` lists every host a built bundle may name. At runtime only **self** and the configured STUN/TURN
hosts (`stun.cloudflare.com`, `turn.dilger.dev`) are allowed; Cloudflare TURN arrives only in the lazy fallback response
(R92), never in a bundle. Inert names (XML namespaces, links inside console warnings and shader comments) are listed with
why they're never fetched.

`npm --prefix web run qualify` builds every pinned runtime library whole (`web/qualify/entry.ts` re-exports them, so tree
shaking can't hide code from the scan) into `web/dist-qualify/`; CI then runs
`node scripts/ci/origin-scan.mjs web/dist web/dist-qualify`, which fails on any unlisted host. Today: three inert hosts
(`www.w3.org`, `github.com`, `www.shadertoy.com`, all inside three.js), no runtime host but self.
