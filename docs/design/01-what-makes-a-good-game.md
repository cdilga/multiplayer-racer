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

## 3. Juice — the layer that makes it *feel* good `[R]` (gap now filled, see [00b](00b-research-report-gaps.md) GAP 1)

> ✅ The gap-fill research pass backs this section with named sources. Tags upgraded to `[R]`.

**The core principle: juice is a *stack of small effects*, not one big trick** `[R, Nijman "Art
of Screenshake"; Jonasson & Purho "Juice It or Lose It"]`. Both canonical game-feel talks build
satisfying feel by layering ~30 individually-added effects onto a deliberately *boring* base.
**So: build the racer's feel as a checklist of small, separately-toggleable effects**, starting
from an intentionally un-juiced baseline. The budget concentrates on **two moments: the boost and
the smash.**

**The boost / wheelie launch** (the project already has a wheelie/boost intent doc —
`docs/WHEELIE_DESIGN_INTENT.md`):
- **FOV kick** — punch camera FOV out on boost onset, ease back. FOV + camera shake + audio is what
  actually sells speed `[R, NFS Heat / sense-of-speed]`.
- **Speed lines / radial streaks**, not motion blur — an academic Split/Second study found motion
  blur gave *no measurable benefit*, and arcade racers often drop it `[R]`. In our lo-fi frame
  these are *dithered* streaks (see [02](02-design-language.md)).
- **Audio pitch ramp** — sound is a first-class feel channel, not garnish `[R, Joonas Turner GDC]`.
- **Controller haptic** — buzz on boost; map phone vibration to surface (gravel vs tarmac), too
  `[R, Apple WWDC haptics]`.
- **Tiered color-charge feedback** *if* boost becomes charge-based: signal tiers with distinct
  spark colors and scale the payoff ~**1× / 2.5× / 4×**, per Mario Kart's Mini-Turbo
  (blue→orange→purple, ≈0.62/1.67/2.63s) `[R, mariowiki Mini-Turbo]`.

**The smash / elimination** — *the* shareable moment; over-invest:
- **Hit-stop ("sleep")** — freeze the sim for **1-3 frames** on a big hit, staying in the
  **sub-perceptual "sweet spot"** so it reads as *weight, not lag* `[R, Nijman]`.
  *(Correction: my first draft said 80-120ms ≈ 5-7 frames — too long; use 1-3 frames.)*
- **Screen shake, scaled to impact** — short, sharp, decaying; reuse the existing
  speed/collision shake (`RenderSystem`) + `three-screenshake`, tune don't rebuild. Caution:
  NFS Heat's un-toggleable shake annoyed players — keep ours tunable `[R]`.
- **A transient post-FX pulse** — one frame of chromatic-aberration + posterize/scanline flash on
  the kill (cheap to trigger as a full-screen pass `[R]`; reuses the neon/CA work we're retiring —
  see [02](02-design-language.md) reconciliation).
- **⚠️ Shared-screen slow-mo rule** `[R, Burnout 3]`: **do NOT global-slow-mo for one player's
  mid-race smash** — Burnout *disables* slow-mo in multiplayer because you can't slow time for
  everyone. Use a **localized camera punch-in** on the smash; reserve true global slow-mo for the
  single match-win beat the whole room watches together (§4, [03](03-experience-flow.md) Beat 5).
- **Debris + a callout** — chunky boxy debris + a host-screen stinger ("X WRECKED Y").

**Layering / sequencing rule** `[R, synthesis of Nijman + Turner + Apple]`: on an impact, fire
~simultaneously **physical → visual → audio → social**: 1-3 frame hit-pause + shake (physical),
FX pulse + debris (visual), crunch (audio), host-screen callout (social). The social layer is the
most-skipped — the big screen must *narrate* the moment so the room reacts together `[R, ICI]`.

**Anti-goal:** do not juice everything. Constant shake/flash = noise; it murders readability (§6)
and accessibility. Reserve the big juice for boost and smash, and keep every effect tunable.

---

## 4. Comeback & tension — keeping dead/last players in `[R]` (gap now filled, see [00b](00b-research-report-gaps.md) GAP 2)

> ✅ Comeback/rubber-banding now backed by named sources. Tags upgraded where supported.

The failure mode of a party racer is **a bored loser.** The research is clear that catch-up
should **create drama, not erase skill** — Mario Kart director Yabuki kept the Blue Shell because
removing it made the game "feel like something's missing," *but also wants to minimize frustration
where possible* `[R]`. So: **necessary drama, not celebrated unfairness.** Tools:

1. **No long deaths.** In derby, an eliminated player should re-enter *fast* — spectator-with-agency
   (drop hazards? a brief "ghost" that can shove?) or short rounds. Long elimination is the enemy.
   *(The research couldn't verify a specific best mechanic for trailing/eliminated players — this
   remains a `[S]` design bet and an open question.)*
2. **DECIDED (2026-06-29): no explicit rubber-banding — keep them together by *design*, not by
   manipulating speed.** We don't want a rubber-banding *system* (no speed scaling, no Blue-Shell-
   style position-targeting catch-up). A *little* catch-up to stay interesting is fine, but
   proximity should emerge from **soft/implicit mechanics**:
   - **Funneling layouts** — chokepoints, loops, re-merging shortcuts, and short tracks so gaps
     close naturally and never grow large.
   - **The shrinking derby arena** (already exists) — forces proximity over time without touching
     anyone's speed. The cleanest "keep them together" tool we have; lean on it.
   - **Leader-as-target** — weapons/attention converge on whoever's ahead, so leading carries risk
     and the pack compresses on its own. Pairs with the leader marker (§6).
   - At most a **barely-noticeable** position-weighted item luck — keep it subtle, never a system.
   - *Why this over Mario-Kart "keep the pack close" or Split/Second "no runaway leads": both are
     explicit banding; the chosen direction is gentler and preserves skill, which suits a non-gamer
     party audience without ever feeling like the game cheated. Research context: [00b](00b-research-report-gaps.md) GAP 2.*
3. **Short sessions, best-of-N structure.** `[S — round-length/best-of-N numbers did NOT survive
   verification; treat as a playtest bet, not fact]` A single derby round ≈ ~60-90s; a match =
   best of 3-5. Natural re-entry points; a loser can become a winner in one sitting; tight "AGAIN!"
   loop. (Derby already does best-of-3 — keep rounds *short*.)

**Win conditions, stated plainly** `[S — research did not cover win-condition specifics]`:
- **Derby:** last car with health > 0. Backup timer → most health if time expires. (Exists.)
- **Race:** first to N laps. Keep N small (2-3) so a session is short and a comeback is possible
  on the last lap. (Exists.)
- **The win must be *legible to the room in under a second*** — a podium isn't enough; the moment
  of winning needs its own host-screen beat (slow-mo final hit, winner's car spotlit, name huge).

---

## 5. Session shape & host-screen energy `[R + S]` (see [00b](00b-research-report-gaps.md) GAP 3)

- **One task at a time; always know what's next** `[R, Jackbox / "The Jack Principles"]`. The
  verified core rule: *"limit the user's choices, give them one task at a time, make sure they
  always know what to do next."* For us → the **phone shows one clear input mode at a time**; never
  a non-gamer juggling competing controls/menus.
- **Broadcast the show on the TV** `[R, Interactive Conversation Interface, GDC 1997]`. Jackbox
  paces like a *TV program* via a host that "pulls players along." For us → a hosted, broadcast-
  style host flow (intros, transitions, results pacing) so between-round spectators stay in and
  re-entry feels like "the next segment of the show."
- **The host screen is never idle.** Lobby = cars idling/revving with banter prompts; between
  rounds = a quick standings sting; loading = something alive, not a spinner. Dead air kills party
  energy `[R, ICI]`.
- **Target session** `[S — specific durations NOT verified]`: drop-in friendly, ~5-15 min of "one
  more", players join/leave between rounds without ceremony. Late-join already works during racing
  — lean into "jump in whenever." *(Round-length / drop-in specifics are an open question — [00b](00b-research-report-gaps.md).)*
- **Spectators are participants.** People not holding a phone should still be entertained by the
  screen. The cinematic "party cam" already exists — it's not just a camera, it's the show's
  director.

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
