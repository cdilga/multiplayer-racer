# Joystick Jammers - Detailed Implementation Plan

## Overview

This document details the 4-phase critical path implementation plan for shipping Joystick Jammers with all 3 game modes (Race, Derby, Fight) functional within 3-6 months.

**Current State:** 21/21 tests passing, solid v2 architecture, 4-core physics tuning system
**Target:** Feature-complete, all modes playable, AAA-quality destruction effects

---

## PHASE 1: Core Race Completion & Multi-Vehicle Camera (Weeks 1-2)

### Goal
Get races to actually finish and implement camera that shows all vehicles. Foundation for all other work.

### 1.1 Race Win Logic & Lap Gate System (Days 1-5)

**Problem:** Races never end. Players can drive indefinitely. Laps increment but don't trigger finish.

**Implementation Steps:**

1. **Create Failing Tests** (Day 1)
   - File: `tests/e2e/race-completion.spec.ts`
   - Test: "Car completes 3 laps and race ends"
   - Test: "Results screen shows final positions and times"
   - Test: "Back to Lobby button returns to lobby"
   - Run tests, confirm they fail ❌

2. **Fix Checkpoint Detection** (Day 2)
   - File: `static/js/entities/Track.js`
   - Current: `isInCheckpoint()` uses simple box collision
   - Change: Add hysteresis (track if already in checkpoint)
   - Add: `previousCheckpointIndex` per vehicle to RaceSystem
   - Test: Lap only increments on finish line crossing
   - Test: Fast vehicles don't skip gates

3. **Verify Lap Counting** (Day 2)
   - File: `static/js/systems/RaceSystem.js`
   - Check: `_isRaceComplete()` uses correct lap count
   - Check: All vehicles properly tracked in lap count
   - Add: Race completion condition when lap count >= configured laps
   - Emit: `race:finished` event with results data

4. **Update Results Display** (Day 3)
   - File: `static/js/ui/ResultsUI.js`
   - Implement: `show(results)` method
   - Display: Podium (1st, 2nd, 3rd)
   - Display: Full results table with lap times
   - Format: Times as MM:SS.mmm
   - Add: "Back to Lobby" button with event handler

5. **Handle Race Finish in GameHost** (Day 4)
   - File: `static/js/GameHost.js`
   - Add: `_onRaceFinished(results)` handler
   - Listen: `race:finished` event
   - Action: Transition to RESULTS state
   - Action: Show ResultsUI with results
   - Action: Disable InputSystem (no more controls)
   - Action: Pause physics or fade out gameplay

6. **Implement Lobby Return** (Day 5)
   - File: `static/js/GameHost.js`
   - Add: `returnToLobby()` method
   - Clear: All vehicles from race
   - Reset: RaceSystem state
   - Reset: DamageSystem state
   - Reset: Camera position
   - Transition: To LOBBY state
   - Show: LobbyUI again

**Success Criteria:**
- ✅ E2E test: 3 laps → race ends
- ✅ E2E test: Results show correct positions
- ✅ E2E test: Back to Lobby works
- ✅ All 21 existing tests still pass

**Key Files:**
- RaceSystem.js - lap completion logic
- GameHost.js - state transitions
- Track.js - checkpoint detection
- ResultsUI.js - results display
- tests/e2e/race-completion.spec.ts - new tests

---

### 1.2 Dynamic Camera Zoom for Multi-Vehicle (Days 6-9)

**Problem:** Camera doesn't adjust when vehicles are far apart. Can't see both players in 2-player mode.

**Implementation Steps:**

1. **Test Current Behavior** (Day 6)
   - File: `tests/e2e/camera-zoom.spec.ts` (create)
   - Test: Two vehicles spawn far apart
   - Test: Both should be visible throughout race
   - Test: Camera adjusts as they separate/approach
   - Run tests, confirm they fail ❌

2. **Calculate Bounding Box** (Day 7)
   - File: `static/js/systems/RenderSystem.js`
   - Add: `_calculateBoundingBox(vehicles)` method
   - Input: Array of vehicle positions
   - Output: Min/max X, Y, Z coords with padding
   - Example: 5-unit padding around all vehicles

3. **Calculate FOV for Zoom** (Day 7)
   - File: `static/js/systems/RenderSystem.js`
   - Add: `_calculateZoomForBounds(box)` method
   - Input: Bounding box dimensions
   - Output: Target FOV (30-90 degrees)
   - Formula: FOV based on distance and viewing angle
   - Clamp: Min 30°, Max 90°

4. **Smooth FOV Transitions** (Day 8)
   - File: `static/js/systems/RenderSystem.js`
   - Modify: `_updateCamera()` in render loop
   - Calculate: Current bounding box every frame
   - Calculate: Target FOV
   - Lerp: Current FOV → Target FOV (smoothly, not instant)
   - Speed: 2-3 second transition (adjustable)

5. **Camera Target Averaging** (Day 8)
   - Current: Camera targets first vehicle
   - Change: Average position of all vehicles
   - Add: Smooth transition to new center point
   - Result: Camera stays centered on action, not one car

6. **Visual Testing** (Day 9)
   - File: `tests/e2e/camera-zoom.spec.ts`
   - Run: Two vehicles in opposite track directions
   - Verify: Both remain visible throughout
   - Check: FOV transitions smoothly (no jumps)
   - Check: Works with 1 vehicle (no zoom weirdness)
   - Screenshot: Various car positions to confirm

**Success Criteria:**
- ✅ E2E test: Two vehicles always visible
- ✅ Smooth FOV transitions (no jarring changes)
- ✅ Works with 1-16+ vehicles
- ✅ Edge cases handled (vehicles at map extremes)
- ✅ No camera clipping through geometry

**Key Files:**
- RenderSystem.js - zoom logic
- tests/e2e/camera-zoom.spec.ts - new tests

**Note:** This must work with Phase 1 for proper testing (need races to finish).

---

## PHASE 2: Mode System Infrastructure (Weeks 3)

### Goal
Set up game mode selector and pass mode through systems. Enable future Derby/Fight work.

### 2.1 Mode Selector UI (Days 10-11)

**Implementation Steps:**

1. **Add Mode Selector to LobbyUI** (Day 10)
   - File: `static/js/ui/LobbyUI.js`
   - Add: Radio buttons or dropdown for mode selection
   - Options:
     - "Race Mode" (enabled, default selected)
     - "Derby Mode" (greyed out / disabled)
     - "Fight Mode" (greyed out / disabled)
   - Style: Match existing LobbyUI design
   - Event: Emit mode change event on selection

2. **Store Mode in GameHost** (Day 10)
   - File: `static/js/GameHost.js`
   - Add: `settings.mode` property (default: 'race')
   - Add: Mode constants enum or strings
   - Listen: Mode change event from LobbyUI
   - Update: `settings.mode` on change

3. **Pass Mode to Systems** (Day 11)
   - File: `static/js/GameHost.js`
   - When: Creating RaceSystem
   - Pass: `mode` in constructor options
   - File: `static/js/systems/RaceSystem.js`
   - Store: Mode and use for conditionals
   - Emit: Mode in race:finished event

4. **Mode-Aware UI Rendering** (Day 11)
   - File: `static/js/ui/RaceUI.js`
   - Check: `this.gameHost.settings.mode`
   - Conditional: Different HUD for different modes
   - Example: Race shows lap counter, Derby shows health/standings
   - Prep: For mode-specific UI later

**Success Criteria:**
- ✅ Mode selector visible in LobbyUI
- ✅ Derby/Fight visually disabled (greyed)
- ✅ Selected mode stored in GameHost
- ✅ Mode passed to RaceSystem
- ✅ RaceUI renders mode-appropriate HUD

**Key Files:**
- LobbyUI.js - mode selector UI
- GameHost.js - mode storage
- RaceSystem.js - mode awareness
- RaceUI.js - mode-specific rendering

---

## PHASE 3: Visual Destruction Effects (Weeks 4-5)

### Goal
Implement explosion effects, particle systems, and progressive damage visualization. Make destruction visually spectacular.

### 3.1 Explosion Particle System (Days 12-15)

**Implementation Steps:**

1. **Create Particle System** (Day 12)
   - File: `static/js/systems/ParticleSystem.js` (new)
   - Library: Three.js built-in or simple particle emitter
   - Support: Explosion, smoke, debris particles
   - Pooling: Reuse particles for performance

2. **Explosion on Vehicle Destruction** (Day 13)
   - File: `static/js/systems/DamageSystem.js`
   - When: Vehicle health reaches 0
   - Trigger: Create explosion at vehicle position
   - Particles: Fire, smoke, sparks
   - Duration: 1-2 seconds fade out
   - Audio: Play explosion sound (if AudioSystem ready)

3. **Smoke Effect at 10% Health** (Day 13)
   - File: `static/js/systems/DamageSystem.js`
   - When: Vehicle health < 10%
   - Trigger: Continuous smoke emitter from vehicle
   - Particles: Smoke cloud, small steam
   - Duration: Until vehicle destroyed
   - Visual: Warning sign that car is damaged

4. **Debris Physics** (Day 14)
   - File: `static/js/systems/ParticleSystem.js`
   - Create: Debris pieces on explosion
   - Physics: Affected by gravity, initial velocities
   - Collision: Bounce off track/objects
   - Duration: 5-10 seconds, fade out
   - Performance: Pool debris objects

5. **Visual Damage Progression** (Day 14-15)
   - File: `static/js/entities/Vehicle.js`
   - Track: Damage percentage (0-100%)
   - Visual: Car model changes appearance
   - Options:
     - Color shift (bright → darker)
     - Opacity change (fresh → burnt)
     - Material swap (pristine → damaged)
   - Frame: Update every time damage taken

6. **Test & Polish** (Day 15)
   - Visual testing with 2-16 players
   - Screenshot validation of effects
   - Performance check (no FPS drops with many particles)
   - Adjust: Particle counts and durations as needed

**Success Criteria:**
- ✅ Explosions look impressive (particles, effects)
- ✅ Smoke appears at 10% health
- ✅ Debris flies realistically
- ✅ Car visually degrades as damaged
- ✅ No performance issues with multiple explosions
- ✅ Effects work with 16+ players

**Key Files:**
- ParticleSystem.js - new particle emitter
- DamageSystem.js - trigger effects
- Vehicle.js - visual damage progression
- RenderSystem.js - render particles

---

## PHASE 4: Derby Mode (Weeks 6-8)

### Goal
Implement full Derby mode with arena, obstacles, round system, and victory conditions.

### 4.1 Derby Mode Design Confirmation (Day 16)

**Decision Points (Need Designer Input):**
- How many derby arenas? (1, 3, or many?)
- Single match or best-of-3 rounds?
- Victory condition:
  - Last car standing (only 1 survives)?
  - Most damage dealt (damage = score)?
  - Longest survival time?
  - First to X eliminations?
- Obstacle variety:
  - Jumps, loops, walls?
  - Decorative (trees, houses, stands)?
  - Interactive (moving obstacles)?

**Action:** If unclear, use defaults:
- 1 main bowl arena with variations
- Best-of-3 rounds (first to 2 wins)
- Victory: Last car with health > 0
- Obstacles: Jumps, loops, decorative objects

### 4.2 Derby Arena Design (Days 17-20)

**Implementation Steps:**

1. **Bowl Arena Geometry** (Day 17)
   - File: `static/assets/tracks/derby-bowl.json` (create)
   - Shape: Large flat floor, curved walls (bowl edges)
   - Size: Enough for 16 cars to drive without crowding
   - Floor material: Different texture than race track
   - Walls: Curved, high enough to keep cars in
   - Physics: Walls should collide but not be too rigid

2. **Obstacle Placement** (Day 18-19)
   - Add: Jump ramps
   - Add: Loop-the-loop (optional, may be too complex)
   - Add: Decorative trees, houses, stadium stands
   - Collision: Objects block movement, add chaos
   - Layout: Scattered to encourage exploration
   - Testing: Cars can navigate without getting permanently stuck

3. **Track JSON Structure** (Day 19)
   - Extend: `static/js/entities/Track.js` for derby-specific data
   - Add: Obstacle definitions (position, size, type)
   - Add: Spawn positions (distributed around bowl)
   - Add: Arena-specific physics (maybe more forgiving walls)

4. **Render Arena** (Day 19-20)
   - File: `static/js/systems/RenderSystem.js`
   - Load: Derby arena geometry
   - Render: Obstacles and decorative objects
   - Lighting: Arena-specific lighting setup
   - Camera: Positioned to see entire arena
   - Visual: Use screenshots to validate design

**Success Criteria:**
- ✅ Bowl arena renders correctly
- ✅ Obstacles visible and positioned well
- ✅ 16 cars can fit without major overlap
- ✅ Walls prevent cars from leaving
- ✅ No permanent stuck locations
- ✅ Arena looks visually distinct from race track

**Key Files:**
- static/assets/tracks/derby-bowl.json - arena data
- Track.js - derby-specific loading
- RenderSystem.js - arena rendering

### 4.3 Derby Round System (Days 21-22)

**Implementation Steps:**

1. **Track Round State** (Day 21)
   - File: `static/js/systems/RaceSystem.js` (extend for derby)
   - Add: Current round (1, 2, 3)
   - Add: Round length (30 seconds? Configurable)
   - Add: Vehicle scores/lives per round
   - Store: Round history (who won each round)

2. **Round Completion Logic** (Day 21)
   - When: Only 1 vehicle with health > 0 remains
   - Trigger: End round, award point to winner
   - Advance: To next round if < 3 rounds complete
   - Reset: All vehicles to spawn positions with full health
   - Show: Round results screen (standings, winner)

3. **Match Completion** (Day 22)
   - When: First player gets 2 round wins
   - Trigger: End match, show final standings
   - Return: To lobby (like race mode)
   - Allow: Option to play again or return to main menu

4. **Derby-Specific UI** (Day 22)
   - File: `static/js/ui/RaceUI.js` (extend)
   - Display: Current round number
   - Display: Standings (vehicles still alive)
   - Display: Round timer (if timed mode)
   - Display: Eliminations/score
   - Hide: Lap counter (not applicable)

**Success Criteria:**
- ✅ Rounds complete when last car standing
- ✅ Scores tracked correctly
- ✅ Match ends at 2 round wins
- ✅ Round results displayed
- ✅ Vehicles reset between rounds
- ✅ Derby UI shows relevant info

**Key Files:**
- RaceSystem.js - derby round logic
- RaceUI.js - derby-specific display

---

## PHASE 5: Fight Mode (Weeks 9-10)

### Goal
Implement vehicle combat with weapons, pickups, damage feedback, and balanced gameplay.

### 5.1 Fight Mode Design Confirmation (Day 23)

**Decision Points (Need Designer Input):**
- Weapon types? (guns, missiles, lasers, melee, etc.)
- Damage per weapon? (one-shot? multi-shot?)
- Spawn mechanics? (weapon pickups, starting with weapon, random?)
- Respawn mechanics? (instant, delayed, health drops?)
- Victory condition? (last car standing, most kills, score limit?)
- Arena? (modified derby bowl, separate arena, vehicles only?)

**Action:** If unclear, use defaults:
- 3 weapon types: Machine Gun, Rocket, Shield
- Damage: Reasonable (not one-shot, requires 2-3 hits)
- Spawn: Weapon pickups around arena, random respawn
- Victory: Last car standing (like derby)

### 5.2 Weapon System (Days 24-27)

**Implementation Steps:**

1. **Weapon Data Structure** (Day 24)
   - File: `static/assets/weapons/weapons.json` (create)
   - Define: Machine Gun (fast, low damage)
   - Define: Rocket (slow, high damage, splash)
   - Define: Shield (active defense, temporary)
   - Data: Damage, fire rate, ammo, reload time, etc.

2. **Weapon Pickup System** (Day 24-25)
   - File: `static/js/entities/Weapon.js` (new)
   - Create: Pickup objects in arena
   - Position: Spawn points defined in arena JSON
   - Collision: Vehicles pick up weapons on collision
   - Respawn: Weapons respawn on timers (e.g., 10 seconds)
   - Display: Visual indicator (glowing, rotating model)

3. **Firing Mechanics** (Day 25-26)
   - File: `static/js/systems/WeaponSystem.js` (new)
   - Input: Detect fire input (accelerator button dual-purpose?)
   - Fire: Instantiate projectile from vehicle position
   - Track: Projectiles and collisions
   - Hit: Apply damage to hit vehicle
   - Cooldown: Weapon fire rate limiting

4. **Damage & Impact Feedback** (Day 26)
   - File: `static/js/systems/DamageSystem.js` (extend)
   - Damage: Apply to hit vehicle
   - Knockback: Push vehicle away (physics-based)
   - Explosion: Create particle effect at impact
   - Screen Shake: Camera shake on hit (optional)
   - Audio: Explosion sound on hit

5. **Weapon Inventory UI** (Day 27)
   - File: `static/js/ui/RaceUI.js` (extend)
   - Display: Current weapon held
   - Display: Ammo count
   - Display: Weapon cooldown/reload
   - Display: Health/shield status

**Success Criteria:**
- ✅ Weapons spawn and respawn correctly
- ✅ Weapons can be picked up and used
- ✅ Projectiles travel and hit vehicles
- ✅ Damage applied correctly
- ✅ Knockback feels good (not overpowered)
- ✅ UI shows weapon status
- ✅ Combat feels balanced and fun

**Key Files:**
- WeaponSystem.js - new weapon logic
- Weapon.js - weapon entity
- DamageSystem.js - weapon damage application
- RaceUI.js - weapon inventory display
- weapons.json - weapon definitions

### 5.3 Fight Mode Integration (Days 28-29)

**Implementation Steps:**

1. **Fight Mode Arena** (Day 28)
   - File: `static/assets/tracks/fight-arena.json` (create)
   - Design: Similar to derby bowl or modified
   - Weapons: Spawn points for weapon pickups
   - Geometry: Obstacles for tactical cover (optional)
   - Lighting: Distinct from race/derby

2. **Fight Mode Logic** (Day 28-29)
   - File: `static/js/systems/RaceSystem.js` (extend)
   - Mode detection: Enable weapon systems for fight mode
   - Victory: Last car standing (like derby)
   - Score: Track kills/eliminations
   - Duration: Match until 1 car remains
   - Rounds: Single match (unlike derby's best-of-3)

3. **Fight UI** (Day 29)
   - File: `static/js/ui/RaceUI.js` (extend)
   - Display: Weapon inventory
   - Display: Enemy vehicle health
   - Display: Kills/score
   - Display: Kill feed (who shot whom)

**Success Criteria:**
- ✅ Fight mode selectable in lobby
- ✅ Fight arena loads with weapon spawns
- ✅ Combat works as designed
- ✅ Match completes with winner
- ✅ Weapons balanced and fun
- ✅ Returns to lobby after match

**Key Files:**
- RaceSystem.js - fight mode specific logic
- fight-arena.json - fight arena definition
- RaceUI.js - fight-specific UI

---

## PHASE 6: Integration, Polish & Launch Prep (Weeks 11-12)

### 6.1 Full Integration Testing (Days 30-33)

1. **All Tests Pass** (Day 30)
   - Run: `npm test` - all 21+ tests pass
   - Create: New tests for race completion
   - Create: New tests for camera zoom
   - Create: New tests for mode selection
   - Create: New tests for derby/fight basics

2. **Manual Testing - 2 Players** (Day 31)
   - Race mode: Complete race, return to lobby
   - Derby mode: Multiple rounds, crown winner
   - Fight mode: Combat, winner declared
   - Camera: Both players visible throughout
   - Destruction: Effects look good

3. **Manual Testing - 4 Players** (Day 32)
   - All modes with 4 players
   - Check: No lag, smooth gameplay
   - Check: Destruction effects with more players
   - Check: Camera handling with spread-out vehicles

4. **Manual Testing - 8+ Players** (Day 33)
   - Stress test with 8+ vehicles
   - Performance check: Maintain 60fps
   - Physics stability: No glitches
   - Destruction: Effects still visible/fun
   - Network: Synchronization is tight

### 6.2 Visual & Performance Polish (Days 34-36)

1. **Visual Polish** (Day 34)
   - Particle effects: Increase or decrease as needed
   - Lighting: Adjust arenas for visual clarity
   - Camera: Fine-tune zoom speeds and limits
   - Effects: Add camera shake on big collisions

2. **Performance Optimization** (Day 35)
   - Profile: Check for bottlenecks
   - Particle pooling: Ensure efficient reuse
   - Mesh LOD: Simplify distant objects if needed
   - Physics: Check for unnecessary calculations
   - Target: 60fps consistently with 16+ players

3. **UI Polish** (Day 35-36)
   - Menu: Ensure responsive and clear
   - HUDs: Test readability in gameplay
   - Transitions: Smooth between modes/screens
   - Text: Check spelling and clarity

### 6.3 Deployment & Packaging (Days 37-39)

1. **Desktop App Build** (Day 37)
   - Tool: Electron or similar for Windows/Mac
   - Package: Bundle static assets
   - Test: Build runs on clean system
   - Size: Optimize bundle size

2. **Documentation** (Day 38)
   - README: How to build and run
   - CONTROLS: Keyboard/controller mappings
   - MODES: Explanation of each game mode
   - PHYSICS: Tuning guide (for future modders)

3. **Final Testing** (Day 39)
   - Full playthrough: All 3 modes
   - No crashes: 30+ minutes continuous play
   - Destruction: Works and looks good
   - Balance: Game feels fair and fun
   - Ready for release ✅

---

## Critical Success Metrics

| Metric | Target | How to Validate |
|--------|--------|-----------------|
| **Race Mode** | Completes, shows results | E2E test + manual play |
| **Camera** | Both vehicles always visible | E2E test + visual check |
| **Derby Mode** | Full rounds, crown winner | Play best-of-3 series |
| **Fight Mode** | Combat works, balanced | 16-player match |
| **Destruction** | Visually impressive | Screenshots, playtesting |
| **Performance** | 60fps with 16+ players | Profiling, gameplay test |
| **Tests** | All passing (21+ tests) | `npm test` passes |
| **No Crashes** | 30+ min play without issues | Extended playtest |

---

## File Structure After Implementation

```
static/
├── assets/
│   ├── tracks/
│   │   ├── oval.json (existing)
│   │   ├── derby-bowl.json (new)
│   │   └── fight-arena.json (new)
│   └── weapons/
│       └── weapons.json (new)
├── js/
│   ├── systems/
│   │   ├── RaceSystem.js (enhanced)
│   │   ├── RenderSystem.js (camera zoom)
│   │   ├── DamageSystem.js (enhanced)
│   │   ├── ParticleSystem.js (new)
│   │   └── WeaponSystem.js (new)
│   ├── entities/
│   │   ├── Vehicle.js (enhanced)
│   │   ├── Track.js (enhanced)
│   │   └── Weapon.js (new)
│   ├── ui/
│   │   ├── LobbyUI.js (mode selector)
│   │   ├── RaceUI.js (mode-specific HUD)
│   │   └── ResultsUI.js (enhanced)
│   └── GameHost.js (enhanced)
└── css/
    └── host.css (minimal changes)

tests/
├── e2e/
│   ├── race-completion.spec.ts (new)
│   ├── camera-zoom.spec.ts (new)
│   └── ... (existing tests)
└── ...
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| **Physics instability with 16+ vehicles** | Early performance testing, physics pooling, LOD |
| **Destruction effects kill performance** | Particle pooling, effect culling, LOD |
| **Weapons unbalanced** | Playtesting with 4-16 players, quick tweaks |
| **Camera zoom feels bad** | Visual testing early and often, adjust formulas |
| **Race never finishes (regression)** | Comprehensive tests, continuous CI validation |
| **Too ambitious, runs out of time** | Ruthlessly cut nice-to-haves if needed |

---

## Notes for Continuous Claude Run

When starting this implementation:
1. Read PROJECT_DIRECTION.md first (strategic context)
2. Follow IMPLEMENTATION_PLAN.md phases in order
3. Use TDD approach: write failing tests first
4. Use decision tree from PROJECT_DIRECTION.md when choosing between features
5. Update todo list as you progress
6. Take screenshots for visual validation of destructive effects
7. Run tests frequently (after every feature)
8. If stuck on design decision, pick reasonable default and move on (can always adjust)
