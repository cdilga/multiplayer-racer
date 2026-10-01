<div align="center">

# 🎮 Joystick Jammers

> **Play it live: [jammers.dilger.dev](https://jammers.dilger.dev)** — open on a big screen, players join by scanning the QR with their phones. No installs.

### *Your phone is the controller. Your TV is the arena. Race, ram, and wreck your friends — straight from the browser.*

[![Fast Tests](https://github.com/cdilga/multiplayer-racer/actions/workflows/test-fast.yml/badge.svg)](https://github.com/cdilga/multiplayer-racer/actions/workflows/test-fast.yml)
[![E2E Tests](https://github.com/cdilga/multiplayer-racer/actions/workflows/test-e2e.yml/badge.svg)](https://github.com/cdilga/multiplayer-racer/actions/workflows/test-e2e.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://python.org)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Three.js](https://img.shields.io/badge/Three.js-3D-black?logo=three.js&logoColor=white)](https://threejs.org)
[![Rapier](https://img.shields.io/badge/Rapier-3D_Physics-orange)](https://rapier.rs)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?logo=socket.io&logoColor=white)](https://socket.io)

<br />

<img src="docs/images/gameplay-jammers.gif" alt="Joystick Jammers gameplay — four cars racing a neon track" width="800" />

*Open on a big screen → players scan the QR → race or wreck. That's it.*

<br />

[Play Live](https://jammers.dilger.dev) •
[Quick Start](#-quick-start) •
[Features](#-features) •
[How It Works](#-how-it-works) •
[Development](#-development) •
[Roadmap](#-roadmap)

</div>

---

## 🚧 0.2 rebuild in progress

The live game is **0.1**. We're rebuilding it from first principles as **0.2**: a house-party car
game where you throw it on the TV and anyone can jump in and have a laugh.

- **Anyone, any time:** drop in mid-round with no slot limits; phones get two big joysticks, and
  gamepads/keyboards work plugged into anything.
- **Find your car:** big numbers, colours and patterns, an Identify button, and a dynamic grid (or a
  shared Overview for derby) that grows as people join.
- **Physical chaos:** suspension-forward driving, cars that dent and shed parts, debris that stays
  on the track, weapons, chaos events (flash floods, cyclones, roo stampedes).
- **Procedural Australian tracks** generated in the browser, starting with the Red Centre.
- **Bold comic look** with a hint of Mad Max, an Australian announcer and end-of-round highlight reels.
- **New tech:** Rust server and Rust/WASM simulation, Three.js rendering, Gitea CI with isolated
  rainbow previews.
- **Responsive controllers:** native WebRTC from the first 0.2 multiplayer slice, direct over the
  local network where possible with Cloudflare STUN/TURN initially. Compact input and hub batching;
  Rust handles discovery/session setup rather than forwarding every control update.
- **One big screen first:** additional consuming screens are a separate deferred project requiring
  explicit owner approval; playtests and extra arenas/modes do not automatically unlock them.

Read: [0.2 plan](docs/plans/v0.2-revamp-plan-2026-09-28.md) ·
[experience direction](docs/plans/v0.2-experience-direction.md) ·
[owner rules](docs/policies/owner-direction-2026-09-29.md) · [docs index](docs/README.md).
Everything below describes **the current 0.1 build** until 0.2 replaces it.

---

## 🎉 What is Joystick Jammers?

Joystick Jammers is a **Jackbox/Kahoot-style couch party game**. The action plays out on a shared big screen (TV, projector, or laptop), and everyone joins with the device already in their pocket — their phone becomes the controller. No app store, no extra hardware, no installs.

Two ways to play:

- 🏁 **Race** — weaponised laps around procedurally generated tracks. Grab pickups, take the racing line, leave your friends in the dust.
- 💥 **Demolition Derby** — last car standing. The arena shrinks, weapons escalate, and chaos compounds. Best of 3 rounds.

Perfect for party nights, living-room gaming, and questionable driving decisions.

### Why it's fun

| | |
|---|---|
| 📱 **Phone as controller** | Touch joystick + buttons. Just scan and play. |
| 📺 **Big-screen arena** | 3D action with bloom, particles, and a chase cam. |
| 🔗 **One-tap join** | QR code or a 4-letter room code. |
| 💣 **8 weapons & pickups** | Missile, Mine, Boost, Oil Slick, Sniper, Shield, EMP, Flamethrower. |
| 🌍 **Procedural arenas** | New tracks and terrain every game. |
| 👥 **Built for a crowd** | Plenty of players, one screen, total mayhem. |

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.11.7** — pinned in [`.python-version`](.python-version)
- **Node 18.20.8 / npm 10+** — pinned in [`.nvmrc`](.nvmrc) and `engines`
- A modern browser with WebGL

The exact versions are pinned in-repo, so the version managers do the work for you (see below). These are the *current* baseline — an upgrade to the latest Python/Node/deps is tracked as a bead.

### Version setup (one time)

Uses [pyenv](https://github.com/pyenv/pyenv) + [pyenv-virtualenv](https://github.com/pyenv/pyenv-virtualenv) for Python and [nvm](https://github.com/nvm-sh/nvm) for Node. Both read the pin files automatically.

```bash
# Node: nvm reads .nvmrc
nvm install            # installs the version in .nvmrc (18.20.8)
nvm use                # switch to it (auto-selected on cd if you add the nvm shell hook)

# Python: create the named virtualenv once; .python-version auto-activates it on cd
pyenv install 3.11.7
pyenv virtualenv 3.11.7 multiplayer-racer
```

> `.python-version` holds the **env name** (`multiplayer-racer`), so `cd`ing into the repo activates the right env automatically — no manual `pyenv activate`. (asdf / mise users: both pin files are respected too.)

### Installation

```bash
git clone https://github.com/cdilga/multiplayer-racer.git
cd multiplayer-racer                 # version managers auto-select Node + Python here

pip install -r requirements.txt      # Python deps
npm install                          # Node deps
npm run build                        # Build the frontend into dist/
```

### Run it

For a quick one-off, build then start the server:

```bash
npm run build && python server/app.py
```

For day-to-day development, use a one-command stack that **auto-rebuilds the frontend and reloads the backend**:

```bash
npm run dev:local     # Vite rebuilds dist/ on save  +  Flask auto-restarts on .py changes
```

Open **http://localhost:8000** — you'll land on the start screen.

- **Host Now** → the big-screen host (`/host`)
- **Join Game** → the phone controller (`/player`)

> ⚠️ **Playtesting with real phones?** Use `npm run play:local` instead. It runs the same frontend watch but starts Flask with the auto-reload **off** (`FLASK_DEBUG=0`). Because room state is in-memory, an auto-restart mid-game would wipe the room and disconnect every player — `play:local` keeps the server stable so you restart it deliberately (between rounds) when you have a backend change. Frontend edits still hot-rebuild; just refresh the browser (Cmd+Shift+R).

> 💡 **Dev tip:** append `?dev=1` to the landing URL (`http://localhost:8000/?dev=1`) to skip straight to the host every time — handy for rapid iteration. Use `?dev=0` to turn the bypass back off.

### Join a game

1. **Host** opens the game on a big screen and clicks **Host Now**.
2. **Players** scan the QR code (or type the 4-letter room code) on their phones.
3. **Everyone** picks a name and lands in the lobby.
4. **Host** chooses Race or Derby and starts the game.

---

## ✨ Features

### 🏁 Two game modes
- **Race** — configurable laps, weapon pickups, lap timing, live positions.
- **Demolition Derby** — last-car-standing elimination, best-of-3 rounds, a shrinking arena, and weapons that escalate as the match heats up.

### 💥 Weapons & pickups
Eight pickups across rarity tiers — **Missile, Mine, Boost, Oil Slick, Sniper, Shield, EMP, Flamethrower** — with rarer drops appearing later in a match. Grab one, hold it, fire at the perfect moment.

### 🚗 3D physics & visuals
- **Rapier 3D** vehicle physics (WASM) with collision damage and destruction.
- **Three.js** rendering with bloom, fog, particles, trails, and a dynamic chase camera.
- **Procedural tracks + terrain** so no two arenas feel the same.

### 📱 Mobile controls
- Touch joystick for steering, thumb-friendly accelerate/brake, and a fire button in combat.
- Full-screen support and a responsive layout tuned for phones.
- One-tap **Reset My Car** escape hatch when you get stuck or flipped.

### 🎵 Audio
- Multiple music tracks for different phases, synthesised engine sound, and SFX with ducking so effects cut through.

### 🐞 In-game bug reporter
- A **Report a Bug** button in both the host and player menus captures a screenshot plus a game-state snapshot (room code, mode, players, FPS) and opens a pre-filled email — so reports can be matched to server logs.

### 🔧 Developer tools (host)
| Key | Action |
|-----|--------|
| `D` | Toggle debug info |
| `F2` | Physics tuning panel |
| `F3` | Stats overlay (FPS, players, state) |
| `F4` | Physics debug visualisation |

---

## 🔄 How It Works

```mermaid
flowchart TB
    subgraph HOST["🖥️ HOST — big screen (/host)"]
        direction LR
        L["📋 Lobby<br/>QR + Players"]
        R["🏎️ Race / 💥 Derby<br/>Physics + Rendering"]
        E["🏆 Results"]
        L --> R --> E
    end

    subgraph SERVER["⚡ Flask + Socket.IO"]
        RM["Rooms"]
        PS["Player Sync"]
        CR["Control Routing"]
        QR["QR Generation"]
    end

    subgraph PLAYERS["📱 Phone controllers (/player)"]
        P1["Player 1"]
        P2["Player 2"]
        PN["Player N"]
    end

    HOST <-->|"WebSocket"| SERVER
    SERVER <-->|"WebSocket"| PLAYERS
```

The host renders the 3D world and runs the physics; phones stream control input over WebSockets. A lightweight landing page at `/` is the shareable front door and routes players to the right screen.

---

## 🛠️ Development

### Tech stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Three.js, vanilla JS (ES modules), CSS |
| **Physics** | Rapier 3D (WASM) |
| **Backend** | Flask + Flask-SocketIO |
| **Real-time** | Socket.IO |
| **Build** | Vite (landing / host / player entry points) |
| **Testing** | Vitest (unit/integration) + Playwright (E2E) |
| **Deploy** | Docker + Cloudflare Tunnel (jammers.dilger.dev) |

### Project structure

```
multiplayer-racer/
├── server/app.py            # Flask + Socket.IO (rooms, QR, routes: / /host /player)
├── frontend/
│   ├── landing/             # Marketing landing page (Vite entry)
│   ├── host/                # Big-screen host (Vite entry)
│   └── player/              # Phone controller (Vite entry)
├── src/host/main.js         # Host bootstrap (loads GameHost)
├── static/
│   ├── js/
│   │   ├── GameHost.js      # Host orchestrator
│   │   ├── engine/          # Engine, GameLoop, EventBus, StateMachine
│   │   ├── systems/         # Render, Physics, Network, Race, Derby, Weapons, Audio…
│   │   ├── entities/        # Vehicle, Track
│   │   ├── resources/       # TrackFactory, terrain, procedural generation
│   │   ├── ui/              # LobbyUI, RaceUI, GameMenuUI, BugReportUI…
│   │   ├── input/           # InputManager, TouchController
│   │   └── player.js        # Phone controller logic
│   ├── css/                 # host.css, player.css, landing.css
│   ├── audio/               # Music & SFX
│   └── og-image.png         # Social share image
├── tests/                   # Vitest (unit/integration) + Playwright (e2e)
└── docs/images/             # README media
```

> ⚠️ **The Flask server serves from `dist/` when it exists.** After changing any
> JS/CSS you must rebuild `dist/`. The easiest way is `npm run dev:local` (or
> `npm run play:local` for playtests), which keeps `dist/` rebuilt on every save;
> otherwise run `npm run build` manually before testing in the browser. Python
> changes auto-restart the server under `dev:local`. See [CLAUDE.md](CLAUDE.md).

**Local dev scripts:**

| Command | What it does |
|---|---|
| `npm run dev:local` | Vite `build:watch` + Flask (auto-restart on `.py`). Everyday dev. |
| `npm run play:local` | Same, but Flask reload **off** (`FLASK_DEBUG=0`) — stable server for live playtests. |
| `npm run build:watch` | Just the frontend auto-rebuild, no server. |
| `npm run build` | One-off production build into `dist/`. |

### Tests

```bash
npm test                 # unit + integration (Vitest)
npm run test:e2e         # core 4-player flow (Playwright)
npm run test:e2e:all     # full E2E suite
npm run test:headed      # E2E with a visible browser
```

---

## 🗺️ Roadmap

**Playable today:**
- [x] Landing page + one-tap QR/room-code join
- [x] Vite-bundled ESM architecture (no CDNs)
- [x] Race mode (laps, pickups, timing)
- [x] Demolition Derby (elimination, shrinking arena, weapon escalation)
- [x] 8 weapons & pickups
- [x] Rapier physics, collision damage & destruction
- [x] Procedural tracks + terrain
- [x] Audio (music, engine synth, SFX)
- [x] In-game bug reporter
- [x] Live deploy at [jammers.dilger.dev](https://jammers.dilger.dev)

**Next up: 0.2.** See the [0.2 plan](docs/plans/v0.2-revamp-plan-2026-09-28.md). It ships in three
tiers: a **Minimum build** (one Blender-made car, Race, Red Centre, the whole join→play→highlights loop
on a real couch), the **Full build** (roster, derby and party modes, destruction, weapons, comic look,
audio, six themes) and **Stretch** (extra screens and more).

---

## 🤝 Contributing

Contributions welcome — this project follows Test-Driven Development:

1. **Fork** and branch (`git checkout -b feature/amazing-thing`)
2. **Write a failing test** first
3. **Implement** until it passes
4. **`npm run build`** and run the suite
5. **Open a PR**

See [CLAUDE.md](CLAUDE.md) for detailed guidelines.

---

## 📄 License

Licensed under the **GNU General Public License v3.0** — see [LICENSE](LICENSE).

---

## 🙏 Acknowledgments

- [Three.js](https://threejs.org) — 3D graphics
- [Rapier](https://rapier.rs) — physics
- [Flask](https://flask.palletsprojects.com) & [Socket.IO](https://socket.io) — backend & real-time
- [Playwright](https://playwright.dev) & [Vitest](https://vitest.dev) — testing

---

<div align="center">

**Made for couches, parties, and questionable driving decisions.**

[⬆ Back to Top](#-joystick-jammers)

</div>
