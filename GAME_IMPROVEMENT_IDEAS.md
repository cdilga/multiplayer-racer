# Game Improvement Ideas & Current Status

## PRIORITY 1: Core Gameplay Polish (Foundation)

### Ensure sound system works
- Status: Missing after update
- We previously had sounds, and we have music in the music/tracks directory for different scenarios
- We previously had rotary engine sounds generated live. We should re add something that sounds better. With config options to disable. 
- Add sound panel to the physics settings to tune the generation of live audio based on speed. Sound should mimic rotary components and be futuristic, but mapped to the car motion. Params influcing should be engine load and speed.

### Test optimisation and cleanup
- We have very long running tests
- Some scenarios are duplicates. We need to keep the more valuable, longer and more complex tests, which likely test simpler scenarios anyway. Keep the super fast scenarios like game generation and joining anyway. 
- We need to take care that we don't remove tests that are actually valuable, so that we don't let bugs in.
- Examine all tests in their entirety, and see if we can remove any
- Make tests faster
- See if we can run the simulation in a faster mode than realtime for some tests. If we can, keep at least a single test in complete realtime.
- Update docs about testing so we keep fast tests in future.

### Issues with curb
- We have a curb which is placed in a circle around the track, kind of like a ladder
- It needs to be rotated 90* to the current position
- If necessary, we can see the type of issue by looking at the debug bounding box to find the rotation issue

### Rename project
Replace all references and rename to Joystick Jammers

### Docs update
- Using the documentation agent to assist us
- Update readmes, diagrams and descriptions for a killer readme
- Update the main video on the readme too. Follow same steps as last time (ffmpeg gif / video generation of gameplay)
- This time, use 32 instances of playwright controllers to create chaos when videoing and have them all drive in random patterns to create epic chaos.

### CRITICAL: Camera System - Keep All Cars in View
- **Status:** ✅ DONE - Dynamic FOV adjustment keeps all vehicles visible
- **Completed:**
  - Multi-vehicle camera tracking in RenderSystem.js
  - Bounding box calculation for all active vehicles in real-time
  - FOV adjusts (30-100°) based on vehicle spread
  - Camera centers on average position of all vehicles
  - Smooth FOV transitions (0.15 smoothing factor)
  - 3 e2e tests in `tests/e2e/camera-zoom.spec.ts`:
    - Both vehicles visible when positioned far apart
    - FOV increases when vehicles spread (77° → 99°)
    - Camera centers on average position

### CRITICAL: Race Win Logic & Lap Gate System
- **Status:** ❌ NOT DONE - Laps increment but race never ends
- **Current Issue:**
  - Laps tick upward but no finish condition
  - Players can drive indefinitely
  - No "race complete" screen
  - No return to lobby mechanism
- **Needed:**
  - **Gate/Checkpoint System:**
    - Place multiple gates/checkpoints around track
    - Players must pass through gates in sequence to count a lap
    - Visual markers for gates (rings, transparent geometry)
    - Test: verify lap only increments after passing all gates in order
  - **Race Completion:**
    - Set lap limit (currently hardcoded as 3 in settings)
    - When lap count reached, emit `race:finished` event
    - Show "Race Complete" screen with final positions/times
    - Disable car controls (fade out UI)
  - **Lobby Return:**
    - Add "Back to Lobby" button on results screen
    - Reset GameHost state and return to LOBBY game state
    - Allow new race to start with same/different players
  - **Testing:**
    - Test: car completes required laps, race ends
    - Test: results screen shows correct final positions
    - Test: clicking "play again" returns to lobby cleanly

### Physics & Debug System
- **Status:** ✅ MOSTLY DONE - Physics panel functional, all 4 core params tunable and persisted
- **Completed:**
  - Physics tuning UI (F2) with 4 parameters: engineForce, brakeForce, frictionSlip, suspensionStiffness
  - localStorage persistence with save/load/export
  - Real-time application to running vehicles
  - All 21 tests passing
  - Debug overlays: F4 (physics wireframes), F3 (stats), F2 (tuning)
  - Reverse gear implemented and working smoothly
- **Gaps to Address:**
  - Consider adding more tunable parameters at runtime (suspension compression/relaxation, steering angle, damping values)
  - Auto-save on slider change (currently manual save button)
  - Profile management UI (currently single profile only)
  - Documentation of what each parameter does

### Damage System & Explosions
- **Status:** ⚠️ PARTIAL - Damage calculation done, visual effects missing
- **Completed:**
  - DamageSystem fully implemented: collision-based damage, respawn logic
  - Vehicle health tracking (0-100), armor reduces damage
  - Health/armor configurable per vehicle type
  - Events emitted on damage/destruction
  - 3000ms respawn delay with full healing
  - Semi-realistic damage: relSpeed-based for vehicle-vehicle, speed-based for barriers
- **Still Needed:**
  - Explosion particle effects when vehicle destroyed
  - Smoke effect at 10% health (early warning)
  - Debris/pieces flying off on destruction
  - Sound effects for explosions
  - Health bars visible in race UI (currently only in debug F3 overlay)
  - Visual damage indicators (car changes appearance as health decreases)

### Joystick Controller
- **Status:** ✅ DONE - Fully implemented and working
- **Features:**
  - Mobile-friendly joystick for steering (horizontal constraint)
  - Touch-safe multi-touch handling
  - Accelerate/brake buttons
  - Visual feedback (color changes)
  - Keyboard fallback for testing
  - Works on iOS and Android
- **Minor Improvements:**
  - Investigate long-press selection issue on iPhone (if still exists)
  - Add haptic feedback on mobile if needed
  - Consider enhanced visual feedback on low latency networks

---

## PRIORITY 2: Game Features & Modes (Engagement)

### CRITICAL: Race Mode Overhaul & Multi-Mode System
- **Status:** ❌ NOT DONE - Only Race mode exists, no mode selector
- **Phase 1: UI & Infrastructure**
  - Add mode selector to LobbyUI with 3 options:
    - "Race Mode" (enabled, clickable)
    - "Derby Mode" (greyed out, disabled)
    - "Fight Mode" (greyed out, disabled)
  - Store selected mode in GameHost settings
  - Pass mode to RaceSystem for mode-specific behavior
  - Mode-specific UI/HUD rendering based on selected mode

- **Phase 2: Race Mode (Already exists, needs completion)**
  - What's there: lap-based racing around track
  - Needs: gate/checkpoint system (see above), proper lap counting, finish line
  - See "Race Win Logic" section above for details

- **Phase 3: Derby Mode (Design & Build)**
  - **Design Phase:** Needs game designer input
    - Entertaining bowl-like arena (flat floor, walls at edges)
    - Multiple tracks/variations of the bowl arena
    - Obstacles inside: jumps, loops, trees, houses, stadium stands
    - **Question:** How many arenas? What's the progression? The last man standing wins
    - **Question:** Is derby best-of-3 rounds? How are rounds defined? Best of 3 rounds - with bonus rounds as are required. Last man standing like brawlhalla.
    - **Question:** What's the victory condition? Last car standing? Most damage dealt? Longest survival time? Yes, last man. If there's a tie, we do a countdown and do it based on most health / most damage dealt.
  - **Build Phase:**
    - Create track/arena geometry
    - Place obstacles using track editor or manually in JSON
    - Add gate system for lap counting (if applicable to derby)
    - Implement round system with scoring
    - Display current round/standings during play
    - Show final standings after derby completes
  - **Visual Validation Loop:**
    - Debug mode to view arena from multiple angles
    - Screenshot validation after each major change
    - Test that all obstacles render correctly
    - Test that cars can navigate without getting stuck

- **Phase 4: Fight Mode (Design & Build)**
  - **Design Phase:** Needs game designer + architect input
    - Is this vehicle combat? (guns, missiles, power-ups)
    - Arena type? Same bowl as derby? Specific arena?
    - Victory condition? Last car standing with health > 0?
    - Weapon balance: what's fun?
    - **Question:** How are weapons obtained? Spawn points? Start with one? - Start with none. Drops spawn around the map.
    - **Question:** How much damage do weapons deal? Can one-shot kill? - generally, no one shot cannot kill. Make a sniper weapon though that can do that, but only gets a single shot per use, so it's rare.
  - **Build Phase:**
    - Weapon system implementation
    - Weapon pickup spawning and respawning
    - Damage feedback (explosions, vehicle knockback)
    - UI for weapon inventory
    - Arena design (likely modified bowl from derby)
  - **Testing:**
    - Weapon damage dealt correctly
    - Knockback physics realistic
    - Weapons spawn in sensible locations
    - Combat feels balanced and fun

### Player Reconnection/Rejoin
- **Status:** ❌ NOT DONE - No session persistence
- **Current behavior:** Disconnect = removed from game, must rejoin fresh
- **Needed:**
  - Detect disconnect vs. intentional leave
  - Keep vehicle in-game for 30s after disconnect
  - Reconnect restores same vehicle/position
  - Use localStorage to store session ID + connection token
  - Toast notification: "Reconnecting..."
  - Test: player disconnects and reconnects within 30s

### Health Bar UI
- **Status:** ⚠️ PARTIAL - Backend ready, frontend missing
- **Completed:**
  - Health tracked per vehicle
  - DamageSystem has getHealth() method
  - Health serialized for multiplayer
- **Needed:**
  - Add health bars to race UI (top of screen, per player)
  - Add damage numbers on collision
  - Color change: green → yellow (50%) → red (25%)
  - Update every 100ms during race

---

## PRIORITY 3: Developer Experience

### Hot Reload Support
- **Status:** ❌ NOT DONE - Manual refresh required
- **Current:** Vite dev server without HMR
- **Needed:**
  - Add hot module replacement (HMR) for faster iteration
  - Auto-refresh on file change
  - Preserve game state if possible
  - Would significantly speed up development cycle

### Code Organization
- **Status:** ⚠️ PARTIAL - V2 architecture is clean but some files large
- **Issue:** Some files exceed 25k tokens
- **Needed:**
  - Break down large files into logical modules
  - No changes to architecture (already clean), just subdivision
  - Document module responsibilities clearly
  - Benefit: easier code review, faster development
  - Ask the architect to help.

### Build Tools & Bundling
- **Status:** ⚠️ PARTIAL - works but could be improved
- **Current:** Playwright is slow, takes like 50 minutes to run full suite.
- **Needed:**
  - Ensure Three.js and all dependencies properly bundled
  - Several of the tests are redundant
  - Update all dependency versions to latest stable
  - Test offline functionality (controllers connecting to local host)
  - Optimize for production

---

## PRIORITY 4: Polish & Features 

### Visual Enhancements
- Track improvements: obstacles, walls, jumps, different surfaces (3-4 tracks total)
- Car customization: skins, colors, decals
- Better particle effects: dirt, smoke, fire
- Damage visual: deformed mesh, paint chips, rust
- Surface types: grass, ice, gravel with different friction

### Advanced Gameplay
- Weapon/item system (guns, power-ups, boosts)
- Jump/boost mechanics on unlock
- Multiple car types with different stats (tanks, fast cars, etc.)
- AI bots for single-player or bot elimination
- Progressive unlocks: cars, skins, abilities



---

## Development Workflow (TDD Loop)
✅ DOCUMENTED - See `/CLAUDE.md` for full TDD guidance:
1. Write test (that fails)
2. Verify test fails for right reason
3. Implement minimal logic
4. Run tests
5. Visual check if needed
6. Push and verify CI

**All 21 E2E tests currently passing** ✅

---

## Summary: What's Ready vs. What's Needed

| Category | Feature | Status | Effort |
|----------|---------|--------|--------|
| **Core Gameplay** | Physics system | ✅ | Complete |
| **Core Gameplay** | Debug UI/tuning | ✅ | Complete |
| **Core Gameplay** | Joystick controller | ✅ | Complete |
| **Core Gameplay** | Damage calculation | ✅ | Complete |
| **Core Gameplay** | Camera zoom all cars | ✅ | Complete |
| **Visual Effects** | Explosions | ❌ | Medium |
| **Visual Effects** | Smoke effects | ❌ | Small |
| **Visual Effects** | Health bars (UI) | ❌ | Small |
| **Game Modes** | Derby mode | ❌ | Large |
| **Game Modes** | Mode selector UI | ❌ | Small |
| **Persistence** | Player reconnection | ❌ | Medium |
| **Dev Tools** | Hot reload | ❌ | Medium |
| **Code** | Split large files | ❌ | Small |
| **Build** | Update dependencies | ❌ | Small |

---

## RECOMMENDED IMPLEMENTATION SEQUENCE (From Architect)

### CRITICAL PATH (Must complete before major mode work)

**Phase 1: Race Win Logic & Lap Gate System** (Days 1-5)
Priority: CRITICAL - Foundation for all race modes
- [ ] Create race completion E2E tests (car finishes N laps, results show)
- [ ] Fix checkpoint detection reliability in Track.js
- [ ] Verify lap counting logic in RaceSystem.js
- [ ] Update ResultsUI.js display logic
- [ ] Add GameHost race:finished handler
- [ ] Implement returnToLobby() in GameHost.js
- [ ] Test full flow: start → drive → finish → results → lobby
Key files: RaceSystem.js, GameHost.js, Track.js, ResultsUI.js

**Phase 2: Camera Dynamic Zoom** ✅ COMPLETE
Priority: HIGH - Game playability with 2+ vehicles
- [x] Test current camera behavior with two vehicles
- [x] Add bounding box calculation to RenderSystem.js
- [x] Add FOV/zoom calculation logic
- [x] Integrate smooth FOV transitions
- [x] Visual testing with live vehicle movement
- [x] Edge case testing (cars far apart, at map extremes)
Key files: RenderSystem.js, GameHost.js
Tests: tests/e2e/camera-zoom.spec.ts (3 tests passing)

**Phase 3: Mode System Infrastructure** (Days 10-11)
Priority: HIGH - Enables future game modes
- [ ] Add mode selector to LobbyUI.js
- [ ] Store mode in GameHost.js settings
- [ ] Pass mode to systems (RaceSystem)
- [ ] Update RaceUI.js for mode-aware rendering
Key files: LobbyUI.js, GameHost.js, RaceSystem.js

**Phase 4: Integration & Full Testing** (Days 12-13)
- [ ] Run all 21 existing E2E tests
- [ ] Create new tests for race completion
- [ ] Create tests for camera zoom
- [ ] Create tests for mode selection
- [ ] Manual testing with two players
- [ ] No console errors, all tests pass

### POST-CRITICAL-PATH (Future sessions)

**Phase 5: Derby Mode** (Medium-large scope)
Blocked until: Phase 1-3 complete + Game Designer input
Design questions:
- How many derby arenas? Single for now
- Best-of-3 rounds yes
- Victory condition: Last car standing - yes
- Obstacle variety: jumps, loops, trees, houses, stadium stands absolutely everything.

**Phase 6: Fight Mode** (Large scope)
Blocked until: Phase 1-3 complete + Game Designer + Architect input
Design questions:
- Vehicle combat with guns/missiles/power-ups?
- Weapon spawn points and respawn rates?

- Damage balance - realistic or arcade?
- Arena design - same bowl as derby or unique?

### OTHER IMPROVEMENTS (After critical path)
- Health bar UI on race screen (relies on Phase 1)
- Smoke effect at 10% health (visual polish)
- Player reconnection with session persistence
- Hot reload support
- Split large files
- Additional track variations

---



CLAUDE YOU ARE DONE IF YOU REACH HERE!

### Long-term Features
- Subscription model with cosmetics
- In-game ads (tastefully integrated into track design)
- LLM-based commentator for races (lazy-loaded, cheap)
- Account system with email login + unlocks/progression
- User-generated content (maps, cars, weapons)
- Global leaderboards per map
- Bug submission system with community voting
- Analytics to catch bugs in real-time

### Distribution
- Steam release (executable + server bundle, $5 early access / $15 full)
- Web version with public match joining (thousands of players)
- Download/offline play capability
- Website for downloads + game joins

## Meta Claude Setup (For Future)
- Gameplay researcher agent
- User feedback collector agent
- Analytics agent (watch players, catch bugs)
- Social media post maker
- Blogpost maker
- Feature prioritiser
- UX researcher
