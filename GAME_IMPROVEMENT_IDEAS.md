# Joystick Jammers - Improvement Roadmap

**Dev loop:** After each major feature, commit and propose a PR. Keep appending to the same branch, periodically pull from main.
**Do some due dilligence:** Ensure features marked as complete are indeed complete, if you begin a new run and see completed tasks
---

## Priority Order

1. ~~**Test Optimization**~~ - ✅ DONE (1.4 min from ~50 min)
2. ~~**Player Name Fix**~~ - ✅ DONE (tests pass, input visible on mobile)
3. ~~**Late Join**~~ - ✅ DONE (commit 96902a9)
4. **Vite Bundling Migration** - HIGH PRIORITY (improves DX and test performance)
5. **Developer Experience** - Enables faster iteration
6. **Project Rename** - After demo video update
7. **Derby/Fight Mode** - New game mode
8. **Hill Climber Pro Max** - Third game mode

---

## Full Vision Update (Jun 2026)

### Completed on `claude/full-vision`
- **Derby mode** - rounds, scoring, shrinking arena, 3 arenas with random rotation
- **Weapons in every mode** - full arsenal active in Race as well as Derby
- **Weapon progression** - rarity escalates and spawns accelerate over match time
- **Weapon physics effects** - boost/EMP/oil slick now affect handling for real
- **Procedural tracks** - seeded spline circuits with neon palettes, lobby selector
- **Track/arena selection** - lobby dropdown per mode (random circuit, oval, arenas)
- **Synthesized engine audio** - 5-gear Web Audio synth replaces looping sample;
  crossfades, ducking fixes, collision-sound cooldowns
- **Controller upgrades** - fire button + weapon display in all modes, haptics
- **Camera/feel** - impact shake on crashes/explosions, wider zoom range,
  neon-night oval palette
- **Bug fixes** - free lap at race start, stale spawn after track switch

---

## Active Work


### Polishing Phase (June 2026)
**Status:** ACTIVE - Current swarm focus
**Why:** The foundation is solid (Vite, Rapier, Multi-mode), but the "feel" and reliability need a professional pass.

**Goals:**
- **Wheelie/Boost Payoff:** [See Design Intent (docs/WHEELIE_DESIGN_INTENT.md)](docs/WHEELIE_DESIGN_INTENT.md). High acceleration can lift front wheels; reduced steering while in wheelie; clean landings create boost payoff.
- **Identity:** Clear player markers, names, and lightweight car customization.
- **Reliability:** Fix phone controller reconnection (Socket.IO recovery), map collision bugs (Coliseum walls, ramps), and host input authoritative routing.
- **Tooling:** Use `br ready` and `bv --robot-triage` to coordinate. Follow the `beads-polishing` graph.

### Completed: Vite Bundling Migration
**Status:** ✅ DONE
- Vite handles multi-page bundling for `/`, `/host`, and `/player`.
- All CDN dependencies (Three.js, Rapier, Socket.IO) moved to NPM.
- Docker builds serve from `dist/` via Flask.
- Playwright tests run against built output.


### Developer Experience
**Status:** HIGH PRIORITY - do after Vite migration
- Hot reload / HMR support ✓ (comes with Vite migration)
- Split large files into modules
- Update dependencies to latest stable
- **CRITICAL: REMOVE all CDN dependencies** - CDN imports break tests, slow everything down, and bypass bundling. ALL dependencies MUST be via NPM. See CLAUDE.md for details. ✓ (comes with Vite migration)

### Bugs found:
- ![curb misplaced](image-1.png) - curbs are still not placed correctly, they're not circular in the map
- The QR code overlaps with the lap counter - perhaps move QR code to bottom left. Also, it needs to be a little transparent unless hovered over, and it needs to be much bigger, as a proportion of the screen, with a small subtle join now prompt
  - The main QR join code also needs to be much much larger on initial join, 2x the size
  - The text below the QR code is incorrect, saying http://0.0.0.0:8000/player?room=WGDL - but it should have the IP address it calculated for itself.
- The car engine sound is still really off. DO research online using online search tools to figure out how to directly generate more believable car sounds.
- When my phone sleeps, and the controller page is reopened, it doesn't reininialise the connection properly - the car reset buttons no longer work
- Damage doesn't work as expected. We take damage from the ground. We should only be taking damage from collisions with walls, cars or if the car was able to flip etc
  - Damage should send little wheels (hard objects that can be hit and also cause other cars to flip on them) and parts of the car model exploding outwards. This might be hard to achieve but should happen. ideally at least all 4 wheels come off

### Project Housekeeping
**Status:** Do after test optimization and demo video update
- Rename project to "Joystick Jammers" (all references)
- Update READMEs, diagrams, descriptions
- Update main video (use 32 Playwright controllers for chaos)

### Visual Effects (Remaining)
**Status:** BLOCKED by neon visual overhaul (which is blocked by slow tests)
- Visual damage indicators - TBD after visual overhaul lands
- Track variations: 3 new track layouts, ice/dirt surfaces, oil/bumps hazards

---

## Completed

### Sound System (Jan 2026)
- Lobby music fix - Added audio unlock retry mechanism
- Volume slider for music - Added to LobbyUI
- SFX volume controls - Added to LobbyUI
- Engine sounds - Configurable pitch/volume in F2 panel
- Sound panel in physics settings - Added Audio section

### Race Win Logic & Lap System (Jan 2026)
- Race finish condition - Implemented in RaceSystem
- Lap counter - Works correctly
- Start/finish line and checkpoint system - 4 checkpoints in oval track
- Award places - Finish order tracked and displayed
- Race Complete screen - ResultsUI with podium and table
- Back to Lobby button - Working in ResultsUI

### Race Restart Bugs (Jan 2026)
- Play again overlay - Fixed ResultsUI to hide on game:countdown
- Countdown visibility - Shows on first start via game:countdown event

### Visual/Physics Bugs (Jan 2026)
- Curb rotation - Fixed barrier collider orientation
- Camera stutter - Made smoothing frame-rate independent
- Car spawn direction - Updated rotations to face track direction

### Damage System Bugs (Jan 2026)
- Car falls apart at 0 health - Mesh hidden, explosion shown
- Physics panel damage tuning - Added multiplier and respawn delay

### UI Fixes (Jan 2026)
- Removed "1st" position indicator from RaceUI

### Visual Effects (Jan 2026)
- Explosion particle effects on vehicle destruction
- Smoke effect at low health (25%, intensifies at 10%)
- Health bars in race UI

### Player Reconnection (Previously)
- Session persistence with localStorage
- Reconnect restores same vehicle/position

### Earlier Completed
- Camera System - Dynamic FOV (30-50*) keeps all vehicles visible
- Physics & Debug System - F2 tuning panel with localStorage persistence
- Joystick Controller - Mobile-friendly with multi-touch support
- Damage System - Collision-based damage calculation with respawn

---

## Upcoming Game Modes

### Derby/Fight Mode (Combined)
**Status:** Ready to implement after core features
**Priority:** After Late Join implementation

**Design (CONFIRMED):**
- **Win condition:** Last car standing (pure elimination)
- **Arenas:** 3 arenas with random rotation each round
- **Obstacles:** Basic (jumps, walls, ramps, barriers)
- **Weapons:** Full arsenal - missiles, mines, oil slicks, sniper (single shot/rare), shield, boost pads, EMP, flamethrower
- **Weapon spawns:** Fixed timer respawn (10-15 seconds)
- **Players:** Can join at any time (uses Late Join system)

---

### Hill Climber Pro Max
**Status:** Ready to implement after Derby/Fight Mode
**Priority:** Third game mode

**Design (CONFIRMED):**
- Climb a tower, first to top wins
- Fall damage matters
- Kangaroos block players getting too far ahead
- Rubber band effect for close exciting games
- **Traps** (triggered by players to stop others):
  - Falling rocks/debris - physical obstacles that knock players down
  - Platform collapse - sections of tower that break away
  - Boost/slow zones - speed modifiers that can help or hinder

