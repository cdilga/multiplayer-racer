# 03 — The Experience, End to End

> Walks the **entire funnel** — landing/sign-in → join → lobby → countdown → race/derby →
> the moment → results → "again" — and at each beat states: **what happens now** (from the
> codebase map), **the treatment** (the design language applied), and **the gap** (what's
> missing for it to be good per [01](01-what-makes-a-good-game.md)).
>
> The law, repeated everywhere: **grimy world, loud players, same camcorder, readable always.**
> `[R]`/`[S]` tags as in the other docs.

---

## Beat 0 — Landing / sign-in (`frontend/landing/index.html`)

**Now:** Hero + Host/Join CTAs, "how it works", mode cards, weapons showcase, features grid.
Neon-arcade styling (`landing.css`). 4-letter code join box routes to `/player?room=CODE`;
`?dev=1` bypasses to `/host`.

**Treatment:** This is the *trailer*, and it must look like the game `[R, cohesion]`. Grimy
posterized field, one loud neon hero element (a single car mid-smash, dithered), the camcorder
grain + vignette over the whole page. Display type chunky and confident. The mode cards become
"VHS box art" tiles. The neon energy survives as the *hero accent*, not the whole canvas
(reconciliation, [02](02-design-language.md) §).

**Gaps:**
- The page currently sells the *old* aesthetic — it'll be the most visible thing to re-skin.
- **Show, don't tell.** A 3-second looping clip of an actual smash (in-language) beats a features
  grid for a party game. `[S]`
- "Sign-in" is really "host or join" — there's no account wall, and there shouldn't be one in the
  party path `[R, time-to-fun]`. Keep it that way; any accounts/monetization (there's a gap doc
  for it) must never sit between a guest and the fun.

---

## Beat 1 — Join (the phone's first 20 seconds)

**Now:** `/player?room=CODE` auto-joins; else a 4-letter code input; "Connecting…" → "Connected".
QR on the host lobby + a persistent QR overlay in-game for late joiners.

**Treatment:** The phone is a prop, but the *join* is the first impression `[R]`. Big chunky code
entry, instant connection feedback, the same grain/palette so it feels like part of the show.
A name + car-color pick that is **2 taps, no keyboard if possible** (suggest a name, let them
change it). `[S]`

**Gaps:**
- **This is the #1 time-to-fun risk.** Every second from "scan" to "I'm in the lobby" is a churn
  point `[R]`. Measure it. Target < 10s including name/color.
- **Late-join is great, surface it more.** Mid-game join already works during racing — the host
  QR overlay should make "jump in NOW" feel inviting, not like an error recovery. `[S]`
- Color/name collision handling must be instant and obvious (you're *Pink*, they're *Cyan*).

---

## Beat 2 — Lobby (`static/js/ui/LobbyUI.js`, host screen)

**Now:** Room code (large), QR, player list + colors, mode cards (Race/Derby), track selector,
lap slider, Start (≥1 player), visual settings toggles.

**Treatment:** The lobby is **live, not a form** `[R, ICI / no dead air]`. The host screen shows
the actual cars idling in the actual arena, engines revving, each wearing its player's loud color
and name tag — so the moment you join, *your car is already there* on the big screen. Mode cards =
box-art tiles. Settings tucked away (host concern, not a guest concern).

**Gaps:**
- **The lobby should already be the world.** Right now it's a UI screen; it should be a *diegetic
  scene* — cars in the arena, the camcorder running. This is where "which car is mine?" gets
  established before the race even starts ([01](01-what-makes-a-good-game.md) §6). `[S]`
- **Banter prompts / readiness energy.** A host that "pulls players along" — a revving sound when
  someone joins, a countdown-to-ready, light trash-talk text — beats a static "Waiting for host"
  `[R, ICI]`.
- Car/name personalization (decals, §02 shape language) lives here.

---

## Beat 3 — Countdown (`3 · 2 · 1 · GO!`)

**Now:** 3-2-1-GO countdown; camera switches to chosen mode (party/chase/hood); cars spawn.

**Treatment:** This is a **juice moment**, small but important — it sets the energy. Chunky display
numerals slamming in, a camera push toward the pack, engines building, a screen-wide flash on
"GO!". The camcorder "starts recording" (a tiny REC dot could even appear). `[S]`

**Gaps:**
- The countdown is a free, high-impact place to teach "watch the big screen" — direct all eyes up
  before the chaos. Currently functional, not authored.
- Make sure every player can *see their car* highlighted during the countdown (pre-race "this is
  you" beat). `[S]`

---

## Beat 4 — The run (race & derby; `RaceSystem.js`, `DerbySystem.js`)

**Now:**
- **Race:** first to N laps (3 default), checkpoints, lap times, on-track weapon pickups, party/
  chase/hood cameras, speed/collision camera shake.
- **Derby:** last car standing, best-of-3, placement scoring, optional shrinking arena (~25-30s),
  escalating weapon drops, walled arenas (square/bowl/dunes/coliseum).
- HUD: timer, lap counter, per-player health bars, speed; persistent QR + camera buttons + menu.

**Treatment (the world):** full Skip Bin Arcade — posterized grimy arena, fog-eaten edges, flat
toon lighting, neon only on track strips/pickups/headlights. The dunes/bowl/coliseum become the
per-arena moods in [02](02-design-language.md) §4. Weapon pickups = chunky bobbing boxes/tetra
with a loud-palette glow (the only bloomed things). Camera = the show's director (the existing
party cam keeps everyone framed).

**Treatment (the players + danger — the loud layer):** cars saturated and crisp against the grime;
overhead name tags / color markers always visible; health as **chunky segmented bars** not thin
gradients; shrinking-arena wall in DANGER red, pulsing; leader wears an unmistakable marker
([01](01-what-makes-a-good-game.md) §6).

**The moment — the smash:** this is the most important second in the product and is currently
**un-authored** ([01](01-what-makes-a-good-game.md) §3). The treatment:
hit-stop freeze (~80-120ms) → screen shake scaled to impact → a one-frame CA/posterize **flash**
(the repurposed neon/chromatic work) → chunky boxy debris → a host-screen **callout stinger**
("X WRECKED Y") so the *room* reacts together `[R, ICI]`. Layer physical→visual→audio→social.

**Gaps:**
- **Smash juice doesn't exist yet** — highest-value addition in the whole project. `[S]`
- **Speed needs to *feel* fast** — FOV kick on boost, dithered speed lines, audio pitch ramp
  (the wheelie/boost intent doc already specifies the pitch + FOV punch — wire visuals to it).
- **Per-frame logging is banned** (CLAUDE.md) — all this feedback is event-driven, never per-tick.
- **Readability under the grade** must be verified in playtest: does dither/fog ever hide a car or
  a health bar? If yes, push the loud layer harder, not the grade softer in those spots. `[S]`
- **Bored-loser problem in derby** — eliminated players wait. Needs a re-entry/spectator-agency
  answer ([01](01-what-makes-a-good-game.md) §4). `[S]`

---

## Beat 5 — Results / the win (`static/js/ui/ResultsUI.js`)

**Now:** Podium (1/2/3), results table (position, name, time, best lap), Play Again, Back to Lobby.
Derby shows round standings, best-of-3 continues, final podium after match.

**Treatment:** The win needs its **own beat** before the table `[R, the win must be legible in <1s]`
([01](01-what-makes-a-good-game.md) §4): slow-mo on the final hit / finish, winner's car spotlit
in its loud color against a darkened grimy world, **name huge** in display type, a stinger. *Then*
the standings, styled as cheap signage (sticker panels, §02 §6), optionally framed "on a CRT" with
scanlines turned on for this screen.

**Gaps:**
- **Winning is currently a table, not a moment.** The single highest-leverage results change. `[S]`
- **The rematch has friction** — see Beat 6.
- Derby between-rounds standings should be a quick *sting*, not a screen the group waits on. `[S]`

---

## Beat 6 — "Again" (the loop close)

**Now:** Play Again / Back to Lobby buttons. Late join works; reconnect within 5 min; rooms
host-owned and dropped on host disconnect.

**Treatment:** The rematch should **auto-arm** — a host-screen countdown to the next round that
anyone can cancel, rather than a button someone must walk over and press
([01](01-what-makes-a-good-game.md) §2). The standings linger just long enough to gloat, then the
cars are back in the arena idling. The loop never goes cold `[R, no dead air]`.

**Gaps:**
- **Re-entry friction is the loop's biggest leak.** Make "again" the default path. `[S]`
- Host-disconnect drops the room with no grace — fine for now, but a flaky host kills the party;
  flagged in existing plans (remote topology / room persistence).
- Players leaving/joining between rounds should be ceremony-free.

---

## Cross-cutting threads

- **Loading / cold start** (host boot ~2-5s): must be near-instant and, while it lasts, *alive* —
  a grimy in-language loading screen (cars assembling, camcorder warming up), never a bare spinner
  `[R, no dead air]`. Preload/caching work has started (recent commits) — keep pushing it.
- **The phone controller** (`Joystick.js`, `player.css`): stays a dumb, two-zone prop (steer +
  action) `[R, tiny input vocabulary]`. It should *match the world* (grain, palette, chunky type)
  but **prioritize touch legibility and latency over flavor** — a party guest's thumb must always
  find the controls. Haptic buzz on boost/hit ties phone to screen ([01](01-what-makes-a-good-game.md) §3).
- **Accessibility & readability** are a single concern: the lo-fi grade reduces contrast `[R]`, so
  player colors, name tags, and HUD must be the high-contrast exception. Offer a "reduce effects"
  host toggle (the bloom/fog/shake toggles already exist — extend to dither/grain/scanline).
- **Audio** (`AudioSystem.js`): the camcorder world wants lo-fi audio too — slightly crunchy synth
  engines, a satisfying crunch on smash, buzzing floodlights, tape hiss under menus. Audio is half
  of juice ([01](01-what-makes-a-good-game.md) §3) and half of cohesion. `[S]`

---

## Beat-to-work map

Each beat's gaps become work items in [04-implementation-plan.md](04-implementation-plan.md).
Priority order (from [01](01-what-makes-a-good-game.md) §7 scorecard):

1. **The render grade** (Beat 4 world) — the foundation everything else sits on.
2. **The smash moment** (Beat 4) — highest-value juice.
3. **The win moment** (Beat 5) + **auto-arm rematch** (Beat 6) — close the loop.
4. **Readability layer** (cars/HUD/name tags) — gates everything else from regressing.
5. **Lobby-as-world** (Beat 2) + **landing re-skin** (Beat 0) — cohesion and first impression.
6. **Bored-loser fix** (Beat 4 derby) — retention within a session.
