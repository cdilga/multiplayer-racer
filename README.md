<div align="center">

# 🎮 Joystick Jammers 0.2

**Put it on the big screen. Grab a controller. Make a spectacular mess.**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

</div>

> **This is the `v0.2-revamp` branch: a from-scratch rebuild in progress.** The game you can play today
> at [jammers.dilger.dev](https://jammers.dilger.dev) is **0.1**, which lives on `main` (tag
> `v0.1-final`). This branch doesn't contain the 0.1 code any more.

## What 0.2 is

A house-party car game. One screen (usually a laptop on the TV) renders the world; everyone else
plays with whatever they have: a phone, a gamepad or a key cluster. Anyone can drop in at any moment
and be driving within seconds. Cars shed doors and wheels that stay on the track; tracks are generated
fresh each round from Australian places.

- **Anyone, any time:** drop in mid-round, no slot limits; phones get two big joysticks.
- **Find your car:** big numbers and colours, an Identify button, and a grid that grows as people join.
- **Physical chaos:** suspension-forward driving; parts go loose, fly off and stay on the track.
- **Procedural Australian tracks:** town, Olgas-style rocks, outback dirt and outback bitumen first.
- **New tech:** a Rust server, a Rust/WASM simulation running in the host's browser, Three.js
  rendering, and WebRTC controllers (direct over your Wi-Fi when possible, Cloudflare TURN otherwise).

## Status (2026-10-02)

We're building **Playtest 1**: the new stack plus one car, the Cruz Missile. Every build that passes
CI ships as a **rainbow preview**, listed at `https://jammers-preview.dilger.dev/` once the preview
pipeline is up.

| Read | For |
|---|---|
| [Playtest-1 plan](docs/plans/v0.2-playtest-1-plan.md) | What's being built now, in what order |
| [Owner rules](docs/policies/owner-direction-2026-09-29.md) | The decisions everything else follows |
| [Master plan](docs/plans/v0.2-revamp-plan-2026-09-28.md) | Full 0.2 design reference |
| [Experience direction](docs/plans/v0.2-experience-direction.md) | Look, feel and UX brief |
| [Docs index](docs/README.md) | Everything else |

## Repository

| Path | What |
|---|---|
| `docs/` | Policy, plans, process |
| `crates/`, `web/`, `tools/` | 0.2 code (arriving with the first beads) |
| `art/` | References, style, vehicle sources |
| `spikes/` | Art/model spike evidence ([index](spikes/README.md)) |
| `.beads/` | Task tracker (`br`/`bv`) |

Agents working here start with [`AGENTS.md`](AGENTS.md).

## Licence

GPL v3. See [LICENSE](LICENSE) and [CONTRIBUTING.md](CONTRIBUTING.md).
