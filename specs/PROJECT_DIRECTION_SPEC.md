# JOYSTICK JAMMERS - Project Direction & Strategic Vision

## Game Overview

**Joystick Jammers** is a couch co-op arcade destruction game for 16+ players where creative chaos, vehicle destruction, and multiple game modes create a party experience.

### Core Identity
- **Genre:** Arcade vehicle destruction party game
- **Audience:** Groups playing locally with shared screen (couch co-op), up to 16+ simultaneous players
- **Tone:** Silly, forgiving, spectacle-driven (not simulation)
- **Unique Selling Points:**
  1. Progressive vehicle destruction affects gameplay and visuals
  2. Multiple game modes (Race, Derby, Fight) in single package
  3. Weapon/power-up variety in combat modes
  4. Creative obstacle-filled arenas designed for chaos

## Strategic Priorities (In Order)

### Priority 1: Destruction & Deformation (Core Mechanic)
- Progressive damage visualization (car looks progressively worse)
- Minor physics changes as car degrades (broken wheels affect handling)
- Visual spectacle (particles, debris, smoke)
- This is NOT cosmetic - it's core gameplay feedback

### Priority 2: Visual Spectacle (AAA Polish)
- Explosion effects (particles, fire, smoke)
- Vehicle customization/skins for visual variety
- Arena quality & lighting (beautiful maps)
- Real-time damage visualization (dents, burns, visual wear)
- Camera effects (shake on collision, dynamic zoom)

### Priority 3: Multiple Game Modes (MVP Requirement)
- All 3 modes (Race, Derby, Fight) required before "feature complete"
- Race: Chaotic racing with destruction allowed, creative paths
- Derby: Last-car-standing destruction mayhem in bowl arena
- Fight: Vehicle combat with weapons and power-ups
- Not prioritized: single mode focus, everything is needed

### Priority 4: Arcade Physics (Forgiving & Fun)
- Physics should enable fun interactions, not restrict them
- Silly collisions are acceptable and desired
- Jumps, loops, and wild interactions are features, not bugs
- Realism is less important than "does it feel good?"

### Priority 5: Local Network Play (Current Focus)
- LAN support is sufficient for MVP
- Internet/public servers are future feature (Phase 2+)
- Don't over-engineer networking now
- Desktop app optimization matters more than web support initially

## Monetization & Distribution

### Business Model
- **Paid Once:** $5-15 purchase, no cosmetics pressure
- **No Subscription:** One-time purchase, all modes included
- **No Ads:** Focus on quality, not monetization
- **Post-MVP:** Can add cosmetics/DLC if desired, but not required

### Platforms (Priority Order)
1. **Desktop App First** (Windows/Mac executable)
   - Better performance, better destruction effects
   - Can optimize for local couch co-op experience
   - Easier to distribute and update

2. **Web Demo Later** (Secondary)
   - Browser version for demos/trials
   - Full internet architecture (controllers via internet)
   - Different codebase/optimization, not immediate

3. **Steam Release** (Long-term)
   - Wider distribution, automatic updates
   - Can be $15 paid game or free-to-play with cosmetics

## Autonomous Decision-Making Framework

When building features autonomously, use this priority tree:

### Decision Tree: When in doubt...

1. **Does it make destruction/chaos more fun?**
   - YES → Do it, even if complex
   - NO → Go to step 2

2. **Does it improve visual feedback/spectacle?**
   - YES → High priority, but after destruction
   - NO → Go to step 3

3. **Does it unblock multiple game modes?**
   - YES → High priority (infrastructure)
   - NO → Go to step 4

4. **Is this for Desktop/Performance optimization?**
   - YES → Medium priority (desktop is primary platform)
   - NO → Go to step 5

5. **Does this reduce code complexity while keeping fun?**
   - YES → Do it (prefer simple where possible)
   - NO → Is it essential? If no, defer it

### Code Complexity Rule
- **Prefer:** Simple code that works well and is maintainable
- **But allow:** Complex code if it genuinely improves gameplay or destruction
- **Avoid:** Complex code for complexity's sake

### Visual Polish Rule
- **High priority:** Explosions, particles, damage effects (destruction spectacle)
- **Medium priority:** UI polish, menu design, cosmetics
- **Lower priority:** Loading screens, minor animations

### Physics Rule
- **If it helps destruction** → Keep it
- **If it restricts fun** → Simplify it
- **If it's realistic but reduces chaos** → Make it more arcade-like

## Current Status

**See `GAME_IMPROVEMENT_IDEAS.md` for current roadmap and task tracking.**

---

## Non-Goals (Not Part of MVP)

- Cross-platform play (web + desktop together)
- Public internet servers (LAN first)
- Cosmetics/Battle pass
- Single-player campaign
- Advanced match-making
- Mobile-native versions
- Streaming/spectator mode
- Leaderboards (local only for now)
- Account system / progression

## Success Criteria for MVP

- [ ] All 3 game modes functional (Race, Derby, Fight)
- [ ] Race mode has proper completion and results
- [ ] Camera keeps all vehicles visible during gameplay
- [ ] Destruction effects are visually impressive
- [ ] 16+ players can play simultaneously without significant lag
- [ ] Desktop app builds and runs smoothly
- [ ] All existing tests still pass + new tests for all features
- [ ] Game feels "fun" and "arcade" not "realistic"
- [ ] No critical bugs preventing play
- [ ] Destruction/damage provides meaningful gameplay feedback

## Notes for Developers

1. **This is not a racing sim.** Destruction and chaos are features, not side effects.
2. **Visuals matter.** Explosions, particles, and effects are core to the game's appeal.
3. **Local/Couch co-op first.** Optimization for shared screen and controller handoff matters.
4. **All 3 modes are required.** Don't plan to ship with just Race mode.
5. **Arcade physics wins over realism.** Fun > Accurate.
6. **Test often with multiple players.** 2-player feel is different from 16-player feel.
