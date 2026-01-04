# Joystick Jammers - Continuous Claude Run Prompt

## START HERE: Strategic Context

You are building **Joystick Jammers**, a couch co-op arcade destruction game for 16+ players.

**Read these documents first (in order):**
1. `PROJECT_DIRECTION.md` - Strategic vision, priorities, and decision-making framework
2. `IMPLEMENTATION_PLAN.md` - Detailed phase-by-phase tasks and success criteria
3. `GAME_IMPROVEMENT_IDEAS.md` - Feature status tracking and post-MVP roadmap

---

## Mission

Implement all features in IMPLEMENTATION_PLAN.md to create a feature-complete, playable game with 3 game modes (Race, Derby, Fight) and AAA-quality destruction effects.

**Timeline:** 39 days of work, organized in 6 phases

**Target:** Feature-complete game ready for desktop app packaging

---

## How to Work

### 1. Follow the Phase Structure

- **Phase 1 (Days 1-9):** Race completion + multi-vehicle camera
- **Phase 2 (Days 10-11):** Mode system infrastructure
- **Phase 3 (Days 12-15):** Destruction visual effects
- **Phase 4 (Days 16-22):** Derby mode implementation
- **Phase 5 (Days 23-29):** Fight mode implementation
- **Phase 6 (Days 30-39):** Integration, polish, and launch prep

Complete phases in order. Do not skip ahead.

### 2. Use Test-Driven Development (TDD)

For every feature:
1. **Create failing tests first** (see what needs to be built)
2. **Run tests** (confirm they fail)
3. **Implement minimal code** (make tests pass)
4. **Run all tests** (ensure no regressions)
5. **Visual validation** (take screenshots if visuals involved)

This approach is documented in `/CLAUDE.md` and should always be followed.

### 3. Update Todo List After Each Task

Mark tasks as `in_progress` when starting, `completed` when finished. This maintains visibility of progress.

### 4. Commit Changes Regularly

After each significant feature completion:
- Stage files: `git add .`
- Commit with clear message describing what was done
- Push to remote: `git push origin v2-track-improvements`

### 5. When You Get Stuck

If uncertain about design decisions:
1. **Check PROJECT_DIRECTION.md** - Autonomous decision-making framework (section 4)
2. **Check IMPLEMENTATION_PLAN.md** - Specific guidance for that phase
3. **Use reasonable defaults** - Don't get blocked, make a call and move on
4. **Document the decision** - Leave a comment in code if unconventional
5. **Flag for review** - Note it in commit message if significant uncertainty

**Example decisions you'll need to make:**
- How many particles in explosion? (Start with 50, adjust after testing)
- What's the FOV lerp speed? (Start with 2 seconds, adjust if feels bad)
- Weapon damage balance? (Start with 3 hits = destruction, adjust after playtesting)

---

## Key Files You'll Modify

### Critical Path (Most changes)
- `static/js/systems/RaceSystem.js` - Lap completion, round logic
- `static/js/GameHost.js` - State transitions, mode passing
- `static/js/systems/RenderSystem.js` - Camera zoom
- `static/js/ui/LobbyUI.js` - Mode selector
- `static/js/ui/RaceUI.js` - Mode-specific HUD

### New Files (You'll create)
- `static/js/systems/ParticleSystem.js` - Particle effects
- `static/js/systems/WeaponSystem.js` - Weapon logic
- `static/js/entities/Weapon.js` - Weapon entity
- `static/assets/tracks/derby-bowl.json` - Derby arena
- `static/assets/tracks/fight-arena.json` - Fight arena
- `static/assets/weapons/weapons.json` - Weapon definitions
- `tests/e2e/race-completion.spec.ts` - Race completion tests
- `tests/e2e/camera-zoom.spec.ts` - Camera tests

---

## Decision-Making Framework

When faced with a choice, use this tree (from PROJECT_DIRECTION.md):

```
1. Does it make destruction/chaos more fun?
   YES → Do it
   NO → Go to 2

2. Does it improve visual feedback/spectacle?
   YES → High priority
   NO → Go to 3

3. Does it unblock multiple game modes?
   YES → High priority
   NO → Go to 4

4. Is this for Desktop/Performance?
   YES → Medium priority
   NO → Go to 5

5. Does this reduce complexity while keeping fun?
   YES → Do it
   NO → Is it essential?
       YES → Must do, but document complexity
       NO → Defer or simplify
```

**Apply this when:**
- Choosing between features
- Deciding on implementation complexity
- Deciding what to test vs. what to skip
- Deciding if something is "good enough"

---

## Testing Philosophy

### What to Test (Write E2E Tests)
- Core game loops (race completion, mode transitions)
- Critical mechanics (checkpoint detection, camera visibility)
- Multiple player counts (1, 2, 4, 16 players if possible)
- Game-ending conditions (victory, elimination)

### What to Validate Visually
- Destruction effects (screenshots showing explosions, debris)
- Arena designs (screenshot validations of new maps)
- Camera behavior (does it show all vehicles?)
- UI/HUD (does it display correct mode-specific info?)

### Run Tests Frequently
- After every feature: `npm test`
- Before commits: Ensure all tests pass
- Goal: Maintain 100% passing test suite throughout

---

## Visual Validation Strategy

For features involving visuals (explosions, arenas, effects):
1. Implement the feature
2. Run `npm run test:headed` to see it in action
3. Take screenshots using Playwright or browser tools
4. Verify appearance matches intent
5. Adjust and iterate

**Screenshot locations to save for review:**
- `/test-results/` - Playwright will auto-save
- Or create `/screenshots/` directory for manual validation

---

## Handling Ambiguity

You'll encounter design questions. Don't get blocked. Use this approach:

### If Unclear About... → Do This:
**Arena Layout**
- Use default: bowl shape, 100-unit diameter, scattered obstacles
- Make it bigger if 16 players feel crowded during testing
- Can always redesign later

**Weapon Balance**
- Start: Rocket = 3 hits to destroy, Machine Gun = 5 hits, Shield = 10 sec defense
- Test with 4-8 players
- Adjust based on feedback (does one weapon dominate?)
- Can always rebalance

**Round Structure**
- Derby: Best-of-3 (first to 2 wins)
- Fight: Single match (last car standing)
- Adjust after testing if it feels wrong

**Particle Count**
- Start: 50 particles per explosion
- If performance drops below 60fps with 16 players: reduce to 30
- If looks underwhelming: increase to 75

**Camera Zoom Speed**
- Start: 2-second smooth transition
- If feels laggy: speed up to 1 second
- If feels jerky: slow down to 3 seconds

---

## Success Criteria for Each Phase

### Phase 1 ✅
- [ ] Races complete after N laps
- [ ] Results screen shows final positions
- [ ] Back to Lobby returns to lobby
- [ ] Camera shows both vehicles throughout race
- [ ] All 21 existing tests still pass

### Phase 2 ✅
- [ ] Mode selector visible in lobby
- [ ] Derby/Fight greyed out
- [ ] Selected mode stored and passed through systems
- [ ] All 21 tests still pass

### Phase 3 ✅
- [ ] Explosions visually impressive
- [ ] Smoke at 10% health
- [ ] Car visually degrades as damaged
- [ ] No performance issues with particles
- [ ] All tests pass

### Phase 4 ✅
- [ ] Derby arena renders correctly
- [ ] Vehicles spawn and can navigate arena
- [ ] Rounds complete when last car standing
- [ ] Match ends at 2 round wins
- [ ] UI shows mode-specific info

### Phase 5 ✅
- [ ] Weapons spawn and respawn
- [ ] Weapons can be picked up and used
- [ ] Projectiles hit and damage vehicles
- [ ] Combat feels balanced and fun
- [ ] Fight mode selectable and playable

### Phase 6 ✅
- [ ] All 21+ tests pass
- [ ] 2-4 player manual testing works
- [ ] 16-player stress test maintains 60fps
- [ ] Visual polish complete
- [ ] Desktop app builds and runs

---

## Commands You'll Use Frequently

```bash
# Run tests (do this constantly)
npm test

# Run tests with UI (see visuals)
npm run test:headed

# Run tests headed and auto-watch
npm run test:headed -- --watch

# Start dev server (if needed)
npm run dev

# Build for production
npm run build

# Git workflow (do after each feature)
git add .
git commit -m "feat: [feature name]"
git push origin v2-track-improvements
```

---

## Strategic Notes

1. **Destruction is the game.** Features that make destruction cooler are always worth doing.

2. **Visual spectacle matters.** Explosion effects and particle systems are high priority because they define the game's feel.

3. **All 3 modes are required.** This isn't "ship with race, add modes later." All 3 modes must be in MVP.

4. **Arcade physics > realism.** If physics restrict fun, simplify them.

5. **Desktop first.** Performance and polish for Windows/Mac is more important than web optimization right now.

6. **16+ players is the target.** Everything should work with 16+ simultaneous vehicles.

7. **Couch co-op is primary.** The game is designed for people in the same room with shared screen.

---

## Example Autonomous Decision

**Scenario:** You're implementing explosions. Particle count choice:
- Option A: 20 particles (minimal, fast)
- Option B: 50 particles (good balance)
- Option C: 150 particles (spectacular, might lag with many)

**Decision Process:**
1. Does it make destruction cooler? YES → Do option B or C
2. Does it impact performance? If yes, choose B not C
3. Can we optimize particles later? Yes, so start with B
4. **Decision:** Implement with 50 particles, profile with 16 players, adjust if needed

---

## When to Ask for Help

You have full autonomy to make decisions. But if you encounter:
- **Architectural issues** (something breaks core design)
- **Physical impossibilities** (feature genuinely can't work with current code)
- **Circular dependencies** (feature A needs feature B which needs feature A)

...then document the issue clearly and flag it in the commit message. The project owner can review and advise.

---

## Commit Message Format

Use this format for clarity:

```
feat: [Feature Name]

- Added [specific thing]
- Fixed [specific issue]
- Enhanced [system name]

Test: [test names] passing
Visual: [screenshot descriptions if applicable]
```

Example:
```
feat: Race completion and lap gate system

- Fixed checkpoint detection with hysteresis
- Added race:finished event emission
- Updated ResultsUI to display final positions
- Implemented returnToLobby() for lobby transitions

Test: race-completion.spec.ts passing
Visual: Results screen displays correctly, podium order matches expected
```

---

## Final Checklist Before Starting

- [ ] Read PROJECT_DIRECTION.md thoroughly
- [ ] Read IMPLEMENTATION_PLAN.md thoroughly
- [ ] Understand the decision-making framework
- [ ] Understand TDD approach (tests first)
- [ ] Know the 6 phases and their milestones
- [ ] Understand you have full autonomy within the framework
- [ ] Know you can make reasonable decisions and move on
- [ ] Ready to commit and push regularly
- [ ] Ready to update todo list as you progress

---

## Let's Build!

You have everything you need. The codebase is solid, tests are passing, and the direction is clear.

**Start with Phase 1, Day 1: Create race completion tests.**

Build Joystick Jammers. Make destruction spectacular. Have fun! 🎮💥

