# 01 — What Makes *This* Game Good

> Come at it from "what is a good game" **before** any pixels. The visual language
> ([02](02-design-language.md)) exists to serve the goals set here. If a beautiful effect
> fights a goal in this doc, the goal wins.
>
> **Sourcing convention.** `[R]` = directly research-backed (see
> [00](00-research-report.md)). `[S]` = design synthesis / my judgement, not independently
> cited. The research explicitly under-covers juice, comeback, and session-length, so most of
> §3-§5 is `[S]` — flagged honestly so you can push back.

---

## 0. The one sentence

> **"Grab your phone, drive your dumb little car, smash everyone else off the arena —
> last one rolling wins."**

If we ever can't pitch a mode in one sentence a tipsy guest understands, the mode is too
complicated `[R, Jackbox one-sentence test]`. This sentence is the spec. Everything below is
in service of making *that sentence* true, fast, and repeatable.

---

## 1. Who this is for, and the brutal constraints that follow

**The player is a non-gamer at a party, possibly drink in hand, who has never seen this before
and will give it ~20 seconds before deciding it's "not for them."** This is the same audience
Jackbox designs for, and the same constraints apply `[R]`:

1. **Time-to-fun must be brutally short.** From "scan QR" to "my car moved and I laughed"
   should be **under 30 seconds**, with zero reading. `[S]`
2. **The input vocabulary must be tiny and identical across modes.** Steer + one action. Learn
   it once, it works in every mode forever `[R, Jackbox input limits]`. We do **not** add a
   second joystick, a gearbox, or a weapon-select wheel that demands attention. If a feature
   needs a tutorial, it needs a redesign.
3. **The host screen (TV) is the show; the phone is a prop.** The energy, the comedy, the
   "OOOHHH" all live on the big screen. The phone is deliberately dumb so eyes stay *up*, on the
   shared screen, where the social moment is `[R, Interactive Conversation Interface]`.
4. **Comprehension is a hard gate, not a nice-to-have.** Before adding anything ask: *"Does a
   first-timer understand it right away?"* If no → cut or simplify `[R]`.

**Design consequence:** Joystick Jammers is not a racing *sim* and not really a racing *game* —
it's a **social-reaction machine that happens to use cars.** The cars are the cheapest possible
excuse for people to laugh at each other. Hold that framing.

---

## 2. The loop, and where it currently leaks

A good party game is a tight loop the group voluntarily re-enters. Ours:

```
   ┌─────────────────────────────────────────────────────────────┐
   │  ENTER (scan/join)  →  LOBBY (banter, pick car)  →  COUNTDOWN │
   │        ↑                                                  ↓    │
   │  "AGAIN!" (re-enter)                                  THE RUN  │
   │        ↑                                                  ↓    │
   │     RESULTS (gloat / blame)  ←───────────────  THE MOMENT     │
   │                                              (the smash/win)   │
   └─────────────────────────────────────────────────────────────┘
```

The **single most important number** is the time from RESULTS back into a new COUNTDOWN. A great
party game makes "again" the path of least resistance — the rematch should start before anyone
decides to check their phone. `[S]`

**Where the loop currently leaks** (from the codebase map):
- **Cold start is slow.** A 2-5s "Loading physics engine…" screen sits between intent and lobby.
  For a party game that's an eternity. (Some preload/caching already landed per recent commits —
  good; this needs to be near-instant.)
- **The "moment" isn't authored.** Collisions happen, health drops, a car is "destroyed" — but
  there's no designed *beat* around the kill: no freeze, no slow-mo, no callout, no camera push.
  The most shareable second of the game is currently un-juiced. (See §3.)
- **Results → again has friction.** "Play Again" and "Back to Lobby" are buttons on a screen
  someone has to walk over and click. The rematch should be a **host-screen countdown that
  auto-arms** unless someone opts out.
- **No comeback tension.** Once a player is out in derby or behind in a race, they're just
  *waiting*. Dead/last players are the ones most likely to put the phone down. (See §4.)

---

## 3. Juice — the layer that makes it *feel* good `[S, research-flagged gap]`

> ⚠️ The research pass did **not** surface verified, racer-specific juice recipes (it says so
> explicitly — [00](00-research-report.md) §4). This section is design synthesis drawing on
> well-known game-feel lineage (Vlambeer "the art of screenshake", Mario Kart, Burnout). Treat
> as a strong starting hypothesis to playtest, not received fact.

Juice = the disproportionate sensory reward for player actions. For a party racer the budget
should go almost entirely to **two moments: the boost, and the smash.** Everything else is
secondary.

**The boost / wheelie launch** (the project already has a wheelie/boost intent doc —
`docs/WHEELIE_DESIGN_INTENT.md`):
- **FOV kick** — punch camera FOV out ~6-10° on boost onset, ease back over ~0.4s. Sells speed
  more than any particle.
- **Speed lines / radial streaks** — appear above a speed threshold; in our lo-fi frame these are
  *dithered* streaks, not clean motion blur (see [02](02-design-language.md)).
- **Audio pitch ramp** — engine synth strains upward (already specified in the wheelie doc).
- **Controller haptic** — a single short buzz on boost engage. The phone confirms what the screen
  shows.

**The smash / elimination** — this is *the* shareable moment; over-invest here:
- **Impact freeze (hit-stop)** — freeze the sim for ~80-120ms on a big hit. Tiny pause, huge
  perceived weight. This is the cheapest, highest-impact juice in the catalogue.
- **Screen shake, scaled to impact** — short, sharp, decaying. The codebase already has
  speed/collision camera shake (`RenderSystem`), and a ready lib exists
  (`three-screenshake`) — tune curves, don't rebuild.
- **A transient post-FX pulse** — one frame of heavy chromatic-aberration + a posterize/scanline
  flash on the kill. This is the one place the research *does* connect: full-screen effects are
  cheap to trigger on impacts `[R]`. It also *reuses the neon/chromatic work we're otherwise
  retiring* (see [02](02-design-language.md) reconciliation).
- **Debris + a callout** — chunky boxy debris (matches the shape language), plus a host-screen
  text stinger ("DEMOLISHED!", "X WRECKED Y").

**Layering rule** `[S]`: juice stacks in order *physical → visual → audio → social*. The hit
registers physically (freeze+shake), then visually (FX pulse+debris), then audibly (crunch), then
socially (callout on the shared screen). Skipping the social layer is the most common miss — the
big screen must *narrate* the moment so the room reacts together `[R, ICI]`.

**Anti-goal:** do not juice everything. Constant shake/flash = noise, and it murders readability
(§6) and accessibility. Reserve the big juice for boost and smash.

---

## 4. Comeback & tension — keeping dead/last players in `[S, research-flagged gap]`

> ⚠️ Comeback/rubber-banding was a flagged gap. Synthesis below.

The failure mode of a party racer is **a bored loser.** Two design tools:

1. **No long deaths.** In derby, an eliminated player should re-enter *fast* — as a
   spectator-with-agency (drop hazards on the arena? a brief "ghost" that can shove?) or via
   short rounds so the wait is seconds, not minutes. Long elimination is the enemy.
2. **Rubber-banding, but *fun-banding* not *fair-banding*.** Mario Kart's lesson: catch-up should
   create *drama*, not erase skill. Behind-players get more/better weapon pickups; the leader gets
   a visible target on their back (literally — see HUD readability §6). The point isn't fairness,
   it's keeping *every* player's next 10 seconds meaningful. `[S]`
3. **Short sessions, best-of-N structure.** A single derby round = ~60-90s of carnage. A "match"
   = best of 3-5. This gives natural re-entry points, lets a loser become a winner within one
   sitting, and keeps the "AGAIN!" loop tight. `[S]` (Derby already does best-of-3 per the map —
   keep rounds *short*.)

**Win conditions, stated plainly** (research didn't cover this — synthesis):
- **Derby:** last car with health > 0. Backup timer → most health if time expires. (Exists.)
- **Race:** first to N laps. Keep N small (2-3) so a session is short and a comeback is possible
  on the last lap. (Exists.)
- **The win must be *legible to the room in under a second*** — a podium isn't enough; the moment
  of winning needs its own host-screen beat (slow-mo final hit, winner's car spotlit, name huge).

---

## 5. Session shape & host-screen energy `[S + R]`

- **The host screen is never idle.** Lobby = cars idling/revving with banter prompts; between
  rounds = a quick standings sting; loading = something alive, not a spinner. Dead air on the TV
  kills party energy `[R, ICI: the host pulls players along]`.
- **Target session:** drop-in friendly, ~5-15 min of "one more", any number of players join/leave
  between rounds without ceremony. Late-join already works during racing — lean into "jump in
  whenever."
- **Spectators are participants.** People not holding a phone should still be entertained by the
  screen. Camera direction (the cinematic "party cam" already exists) is doing real work here —
  it's not just a camera, it's the show's director.

---

## 6. Readability — the non-negotiable that visuals must respect

A party racer lives or dies on the room instantly knowing **(a) which car is mine** and **(b)
who's winning/about to die.** This is the one place where the lo-fi aesthetic must *not* win
unconditionally — clarity beats mood. `[S]`

- **"Which one is me?"** — strong per-player color (already seeded), plus a persistent overhead
  marker / name tag on each car. In a fog-bound posterized world this matters *more*, not less.
- **"Who's winning?"** — leader gets an unmistakable visual crown/target. Health is readable at a
  glance (chunky segmented bars in the lo-fi style, not thin gradients).
- **Lo-fi tension:** dithering, fog, and low-res *reduce* contrast and edge clarity `[R, the
  flat/unlit tell]`. So characters/cars/HUD must be pushed the *other* way — high local contrast,
  bold silhouettes, palette-reserved "player colors" that never appear in the environment. This
  is a core rule in [02](02-design-language.md): **the world is muted and grimy; the players and
  the danger are saturated and loud.**

---

## 7. Scorecard — how we'll know it's working

Use this to judge any build or feature, in priority order:

1. **Time-to-first-laugh** < 30s for a first-timer, no instructions. `[R]`
2. **"Which car is mine?"** answered in < 1s by everyone, every round. `[S]`
3. **The smash feels good** — playtesters flinch/cheer at eliminations. `[S]`
4. **"Again" is the default** — rematch starts with near-zero friction. `[S]`
5. **No bored players** — losers/dead players are not just waiting. `[S]`
6. **One-sentence pitch still holds** — no mode crept into needing a paragraph. `[R]`
7. **It reads as *designed*** — a stranger can tell it has a point of view, not a tech demo. `[R]`

These map onto the experience beats in [03](03-experience-flow.md) and the work in
[04](04-implementation-plan.md).
