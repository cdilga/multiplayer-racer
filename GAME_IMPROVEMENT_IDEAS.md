# Joystick Jammers - Improvement Roadmap

**Dev loop:** After each major feature, commit and propose a PR. Keep appending to the same branch, periodically pull from main.
**Do some due dilligence:** Ensure features marked as complete are indeed complete, if you begin a new run and see completed tasks
---

## Priority Order

1. **Test Optimization** - CRITICAL (blocks visual overhaul)
2. **Player Name Fix** - UX broken on all mobile
3. **Late Join** - Core feature
4. **Developer Experience** - Enables faster iteration
5. **Project Rename** - After demo video update
6. **Derby/Fight Mode** - New game mode
7. **Hill Climber Pro Max** - Third game mode

---

## Active Work

### Test Optimization
**Status:** TOP PRIORITY - blocks neon visual overhaul
**Spec:** See `TEST_OPTIMISATION_SPEC.md` for detailed implementation strategies
**Target:** Under 5 minutes total (currently ~50 min)
**Approach:** Elite engineering, effective test slicing, robust management of long-running components - no compromise on coverage
- Remove duplicate/redundant scenarios while keeping valuable complex tests
- Run simulation faster than realtime (keep at least one realtime test)
- Update docs to maintain fast tests in future

### Player Name Setting
**Status:** Ready to implement - all mobile devices affected
**Bug:** Name input is half off screen on ALL mobile devices (confirmed in Playwright too)
- Users cannot set their name
- Add name setting test
- Allow longer names, names with emoji
- Use frontend designer skill (`/frontend-designer`) for visual revamp - invoke directly, don't defer
- Color reference: `.cursor/color-palette.mdc`
- Note: Neon visual overhaul in progress on `feature/visual-overhaul` branch (see `COLOR_SCHEME.md`)

### Late Join / In-Progress Join
**Status:** Ready to implement
**Design decisions:**
- Players can join at any time during race
- Late joiners spawn near last place (gives fighting chance)
- Display QR code persistently in corner
- Stats won't be great but it's about fun

### Developer Experience
**Status:** HIGH PRIORITY - do after test optimization
- Hot reload / HMR support
- Split large files into modules
- Update dependencies to latest stable

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
- Camera System - Dynamic FOV (30-100°) keeps all vehicles visible
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

