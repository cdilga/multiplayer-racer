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

## Active Work

### Vite Bundling Migration (CRITICAL - Improves Test Performance Further)
**Status:** HIGH PRIORITY - Next task to implement
**Why:** CDN imports make tests slower than they need to be. This migration will:
- Eliminate all network requests for dependencies
- Enable hot module reloading (HMR) for fast iteration
- Unify the build pipeline

**Current State (broken):**
- Vite is installed but NOT used for serving
- Flask serves HTML directly from `frontend/host/index.html`
- HTML uses CDN import maps (lines 217-222) → slow, flaky
- Vendor scripts in `/static/vendor/` → duplicates NPM packages
- NPM packages installed but unused (three, rapier, socket.io-client)

**Target State:**
```
Dev:  npm run dev → Vite dev server (port 5173) with HMR
      Flask only handles /socket.io WebSocket connections

Prod: npm run build → outputs to dist/
      Flask serves dist/ as static files
```

**Implementation Steps:**

1. **Create Vite entry points** (new files)
   ```
   src/host/main.ts    - imports GameHost, rapier, three from NPM
   src/player/main.ts  - imports player code from NPM
   ```

2. **Update vite.config.js for multi-page**
   ```js
   build: {
     rollupOptions: {
       input: {
         host: 'frontend/host/index.html',
         player: 'frontend/player/index.html'
       }
     }
   }
   ```

3. **Update HTML files**
   - Remove import maps (CDN references)
   - Remove vendor script tags
   - Add single `<script type="module" src="/src/host/main.ts">`
   - Vite handles bundling three, rapier, socket.io from NPM

4. **Update Flask to proxy to Vite in dev**
   ```python
   # In dev: proxy frontend requests to Vite
   # In prod: serve from dist/
   ```

5. **Delete vendor files**
   - Remove `/static/vendor/socket.io.min.js`
   - Remove `/static/vendor/three.min.js`

6. **Update playwright config**
   - Tests should work against either Vite dev server or built output
   - No more CDN interception needed

**Files to modify:**
- `vite.config.js` - add build config, proper entry points
- `frontend/host/index.html` - remove CDN imports, add Vite entry
- `frontend/player/index.html` - same
- `server/app.py` - add Vite proxy for dev mode
- `playwright.config.ts` - update webServer config
- Delete: `static/vendor/`, `scripts/capture-video.ts` CDN interception

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

