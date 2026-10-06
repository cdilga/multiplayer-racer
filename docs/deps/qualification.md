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
| **Asupersync** | 0.5.0 (`=0.5.0`) | `native-runtime`, `tls-webpki-roots` (no default) | MIT + OpenAI/Anthropic rider, **accepted (R2, R112, R115)** | crates.io | `jj-server` (P1-N02) | the no-Tokio server runtime (R2); see below |

Transitive crates: `cargo deny` allows only the licences in `deny.toml` (all GPL-3.0-compatible), denies Tokio and unknown
registries or git sources, and fails on yanked versions. Built and checked on eris through RCH, 2026-10-03: `cargo check -p
jj-sim -p jj-wasm-host` (native) and `--target wasm32-unknown-unknown -p jj-sim -p jj-wasm-host -p jj-wasm-procgen -p
jj-wasm-input`, both with rapier3d 0.36.0 (`docs/evidence/P1-F03/`).

### Asupersync: accepted by the owner, an ordinary dependency

R2 names Asupersync for the server. Its 0.5.0 licence (SPDX `LicenseRef-MIT-OpenAI-Anthropic-Rider`) is MIT plus a rider
about OpenAI and Anthropic. The owner is the licensee and accepted it, the GPL-3.0 position included (R2, R112), and on
2026-10-07 accepted every Jeffrey Emanuel licence and lifted the opaque-dependency handling (R115): any agent may pin,
build, read and test it.

- Pin: workspace `asupersync = { version = "=0.5.0", default-features = false, features = ["native-runtime", "tls-webpki-roots"] }`,
  used by `jj-server` only. The default features (`proc-macros`, `nightly-outcome-try`) stay off, so stable Rust builds it.
- `deny.toml` carries licence exceptions for `asupersync`, `asupersync-macros` and `franken-{decision,evidence,kernel}`,
  and allows `webpki-roots`' CDLA-Permissive-2.0 (Mozilla's root list as data).
- `scripts/ci/no-tokio.sh` walks the three shipping targets (as `deny.toml` does), not `--target all`: Asupersync's
  `wasm-bindgen-futures` edge reaches Tokio only on an emscripten-only cfg that never builds.
- Checked 2026-10-07 on the Mac: `cargo check -p jj-server` (stable), `no-tokio.sh` ok, `deny.sh` ok
  (`docs/evidence/P1-F03/asupersync-pin.txt`).

## Web packages (`web/`)

| Package | Pin | Licence | In | Why |
|---|---|---|---|---|
| `three` | 0.186.1 | MIT | `@jj/host` | the renderer: WebGLRenderer by default, decided on numbers in P1-R01 (`docs/evidence/P1-R01/bench.md`); WebGPURenderer is a lazy chunk behind `?renderer=`. The design POC and spikes use the root tooling's 0.182.0, which doesn't ship |
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
