<div align="center">

# 🎮 Joystick Jammers

**Put it on the big screen. Grab a controller. Make a spectacular mess.**

[Play at jammers.dilger.dev](https://jammers.dilger.dev) · [Latest previews](https://jammers-preview.dilger.dev/)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

</div>

A house-party car game. One screen, usually a laptop plugged into the TV, renders the world; everyone else plays with
whatever they've got: a phone, a gamepad or a cluster of keys on the keyboard. Anyone can drop in at any moment and be
driving within seconds. Cars shed doors and wheels that stay on the track, and every round's track is generated fresh
from Australian places.

This is **0.2**, a from-scratch rebuild, and it's what runs at [jammers.dilger.dev](https://jammers.dilger.dev) since
2026-10-19. The original 0.1 game is kept at tag `v0.1-final`.

## How to play

1. Open [jammers.dilger.dev](https://jammers.dilger.dev) on the big screen and press **Host**.
2. Everyone scans the QR code (or types the room code) on their phone. No app, no sign-up.
3. Pick a car, ready up, race. Late arrivals can drop in mid-round, and there's no player limit.

Phones get two sticks: the **left** drives (up to accelerate, down to brake and reverse, hard sideways to drift), the
**right** steers and flicks up or down to fire. Pull the left stick all the way back and snap it forward for a wheelie
launch; straighten out of a held drift for a corner-exit boost. Gamepads and keyboards get matching layouts.

## What's in it

- **Seven cars:** Cruz Missile, Tradie Ute, Hawk Dash, Lion President, AU Hawk, Postie Bike and Pig Catcher, each
  modelled in code from reference sheets in a low-poly comic style.
- **Generated tracks:** town streets, Olgas-style rocks, outback dirt and outback bitumen, mixed per seed, in sprint,
  standard and epic lengths, with jumps, set pieces and overpasses. Derby bowls for smashing.
- **Damage that stays:** parts go loose, then detach, and the debris stays live on the track for the whole round.
- **A grid that grows:** every player gets a tile on the TV with a big number and colour, and an Identify button finds
  your car.
- **Connections that work at parties:** controllers talk to the host over WebRTC, directly on the Wi-Fi when they can
  and through TURN relays when they can't.

## How it's built

| Part | What |
|---|---|
| **Host** (`web/host`) | The browser on the big screen. It runs the simulation (Rust compiled to WASM, in a worker), owns the room and renders the world with three.js. |
| **Controller** (`web/controller`) | The phone page: input, a light HUD, nothing heavy. It never downloads the renderer or the sim. |
| **Server** (`crates/jj-server`) | Rust on [Asupersync](https://github.com/Dicklesworthstone/asupersync). It serves the bundles, creates and resolves rooms, relays WebRTC signalling and issues TURN credentials. Gameplay input never passes through it. |
| **Simulation** (`crates/jj-sim`) | Deterministic Rust physics and race rules on Rapier. The same inputs always replay to the same result, so a bug clip from a live game reproduces exactly with `jj sim --replay`. |
| **Tracks** (`crates/jj-procgen`, `crates/jj-map`) | The seeded track generator and map format. |

Everything is self-hosted: no runtime CDNs, no third-party analytics. Planned telemetry is anonymous crash and game
stats, on by default with an opt-out, and replay clips only when someone presses Send
([plan](docs/plans/v0.2-telemetry-plan.md)).

### Repository

| Path | What |
|---|---|
| `crates/` | Rust: server, sim, procgen, map, protocol, input, fixtures, the WASM bindings and the `jj` CLI (`jj-tools`) |
| `web/` | TypeScript/Vite: `host`, `controller`, `landing`, `shared` (UI kit, transport), Playwright journeys in `tests` |
| `assets/` | Game data: vehicle and tuning profiles, physics, surfaces, items, audio |
| `maps/`, `scenarios/` | Fixed maps, and the scenario bank the sim is tested against |
| `art/` | References, style, vehicle sources and model contracts |
| `infra/` | Deploys: rainbow previews, the edge, the TURN broker, the design POC |
| `tools/`, `scripts/` | Asset, map, network and licence tooling; CI, beads, previews and promotion scripts |
| `docs/` | Rules, plans, process, evidence and learnings ([index](docs/README.md)) |
| `spikes/` | Art and model spike evidence ([index](spikes/README.md)); nothing imports from here |
| `.beads/` | The task tracker (`br` / `bv`) |

## Running it locally

You need the Rust toolchain from `rust-toolchain.toml` (with the `wasm32-unknown-unknown` target and `wasm-bindgen-cli`)
and the Node version pinned for the repo. `scripts/doctor.sh` checks the lot.

```bash
scripts/build-host-wasm.sh          # the sim and procgen workers (add --dev for quicker debug builds)
npm --prefix web ci
npm --prefix web run build          # web/dist
cargo run -p jj-server              # serves web/dist on http://localhost:8080
```

Open `http://localhost:8080/host` on one screen and join from a phone on the same network.

The `jj` CLI drives the simulation and generator directly, for example running a scenario, replaying a clip or reviewing
a seed:

```bash
cargo run -p jj-tools --bin jj -- --help
```

## How it's developed

Development happens on `main`, mostly by AI coding agents working from a task graph, with the owner setting direction and
playtesting. Every CI run that builds ships as a **rainbow preview** at
[jammers-preview.dilger.dev](https://jammers-preview.dilger.dev/), red or green, and the owner promotes a preview to
production by hand. Gitea is the primary forge and CI; GitHub is a mirror.

| Read | For |
|---|---|
| [`AGENTS.md`](AGENTS.md) | How agents work here (start here if you're one) |
| [Owner rules](docs/policies/owner-direction-2026-09-29.md) | The decisions everything else follows |
| [Playtest-1 plan](docs/plans/v0.2-playtest-1-plan.md) | What's being built now |
| [Master plan](docs/plans/v0.2-revamp-plan-2026-09-28.md) | Full 0.2 design reference |
| [Experience direction](docs/plans/v0.2-experience-direction.md) | Look, feel and UX brief |
| [Bead workflow](docs/process/bead-workflow.md) | The task loop, CI and closing work |

## Licence

GPL v3. See [LICENSE](LICENSE) and [CONTRIBUTING.md](CONTRIBUTING.md).
