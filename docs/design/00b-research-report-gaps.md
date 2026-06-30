# 00b — Research Report (Gap-Fill Pass)

> **Provenance.** Second deep-research run 2026-06-29 (`wf_847983c2-90c`), targeting the four
> gaps the first pass ([00](00-research-report.md)) under-covered. 6 search angles → 28 sources →
> 100 falsifiable claims → top 25 through **3-vote adversarial verification** → **23 confirmed,
> 2 refuted**. Confidence tags are the harness's.
>
> **What this changed.** Juice (GAP 1) and comeback/rubber-banding (GAP 2) are now strongly
> evidence-backed — the `[S]` tags in [01](01-what-makes-a-good-game.md) §3-§4 were upgraded to
> `[R]`. Session structure (GAP 3) is partially backed (Jackbox pacing yes; round-length/best-of-N
> numbers **did not survive** — still open). UI specifics (GAP 4) **did not survive** — only the
> rendering-stack continuity holds; [02](02-design-language.md) §6 stays reasoned inference.
>
> **Two corrections to the earlier synthesis** (now reflected in 01/03/04):
> 1. **Hit-stop is 1-3 frames, sub-perceptual** — not the 80-120ms I first guessed (that's
>    5-7 frames and risks reading as lag).
> 2. **Never global-slow-mo a shared screen for one player's event.** Burnout disables slow-mo in
>    multiplayer. Reserve global slow-mo for the single match-win beat everyone watches together;
>    per-smash mid-race uses a *localized* camera punch-in instead.

---

## Executive summary

On **juice/game-feel**, the consensus from Vlambeer's Jan Willem Nijman ("The Art of
Screenshake") and Martin Jonasson & Petri Purho ("Juice It or Lose It") is that good feel is a
*stack of small, individually-added effects* layered onto a deliberately boring base game, with
sound (Joonas Turner) and haptics (Apple) as first-class feedback channels, and a "sweet spot"
rule so freezes stay below conscious perception. Sense of speed comes from layering FOV kick +
camera shake + sound (motion blur is contested — deprioritize it). Mario Kart's tiered drift-charge
(blue→orange→purple Mini-Turbos, ~0.62/1.67/2.63s payoffs) is the canonical color-coded charge
model. On **catch-up/rubber-banding**, prefer modifying AI *skill* over raw power, keep a "dead
zone" around the player, and treat catch-up as a tool for *drama* not fairness — the Blue Shell
was kept because the game "felt like something's missing" without it. On **session structure**,
Jackbox's rules — one task at a time, always-know-what's-next, TV-show pacing via the "Interactive
Conversation Interface" — are the most transferable model for non-gamers. On **lo-fi/PS1 UI**, the
only robust finding is the rendering technique stack; specific UI/font/transition techniques in
named PS1-revival games did not survive verification.

---

## GAP 1 — Juice / game-feel for arcade & kart racers

### Layering is the principle, not any single trick `[R]`
- Nijman, **"The Art of Screenshake"** (INDIGO 2013): starts from a flat prototype and adds ~30
  discrete tricks. Screen shake is the signature, but it's *one layerable technique among many*.
  Shooting feel = a stack: muzzle flash, bigger bullets, rate of fire, gun delay/animation,
  kickback/recoil, impact effects, ejected shells — each added separately. *(youtube AJdEqssNZ-U, primary, 3-0)*
- Jonasson & Purho, **"Juice It or Lose It"** (GDC Europe 2012): "crank a boring old game up to
  eleven, live on stage" — reusable tricks for any game. *(gdcvault 1016487, primary, 3-0)*
- **Takeaway:** build feel as a checklist of small, individually-toggleable effects from an
  intentionally un-juiced baseline.

### Hit-stop / "sleep" `[R]`
- Freeze the action for **one or a few frames** on death/hit/explosion to create impact — but stay
  in the **"sweet spot" below the threshold where players consciously notice the freeze.**
  *(youtube AJdEqssNZ-U, primary, 3-0)*
- **For the racer:** 1-3 frame freeze on car-to-car contact, big collisions, pickup grabs. Weight,
  not lag. (Corrects the earlier "80-120ms".)

### Camera impact & slow-motion — the shared-screen rule `[R]`
- Burnout 3's crash slow-mo ("Impact Time") is *player-triggered*; refocuses camera and enables
  "Aftertouch" steering of the wreck. *(burnout.fandom Aftertouch, 3-0)*
- **In 2+ player shared-screen, slow-mo is DISABLED, steering retained** — you can't slow time for
  everyone at once. *(same, medium — single wiki)*
- **For our shared-TV party racer:** reserve global slow-mo for solo/match-win beats only; for a
  mid-race smash use a **localized camera punch-in or per-player flourish**, never slow the whole
  screen for one player's event.

### Sense of speed = layered, and skip motion blur `[R]`
- Convincing speed = motion blur + camera shake + FOV + sound *together*, no single trick.
  *(gamerant sense-of-speed, secondary, 3-0)*. NFS Heat: calibrated FOV + blur + shake (its
  speed-tied shake has no off-toggle — players modded it down → a caution about over-shaking).
- **Caveat:** an academic Split/Second study found motion blur gave **no measurable benefit**;
  modern arcade racers often drop it. **Prioritize FOV kick + camera shake + audio over blur.**
  *(medium)* — fits our lo-fi look (clean dithered speed lines, not blur).

### Tiered color charge feedback (Mario Kart Mini-Turbo) `[R]`
- Drift-charge escalates through three color-coded tiers: **blue → orange → purple/pink** (Ultra
  added in MK8 Deluxe 2017). Boost durations scale ~**0.62 / 1.67 / 2.63s** (≈ 1× / 2.5× / 4×).
  *(mariowiki Mini-Turbo, 3-0)*
- **For our wheelie/boost** (`docs/WHEELIE_DESIGN_INTENT.md`): if charge-based, signal tiers with
  distinct spark colors and scale payoff ~1×/2.5×/4× so each escalation feels meaningfully better.

### Sound & haptics as feel channels `[R]`
- Joonas Turner (Nuclear Throne, Broforce), "Oh My! That Sound Made the Game Feel Better!" (GDC
  Europe 2015): sound is a *core tool for game feel and tactility*, not just ambience.
  *(gdcvault 1022808, primary, 3-0)*
- Haptics convey events: surface/terrain texture (gravel/sand), recoil, explosions. *(Apple WWDC
  2020, primary, 3-0)* — **for phones-as-controllers:** map vibration to surface (gravel vs tarmac),
  collisions, and boost.

### Sequencing recipe (synthesis)
- **Impact:** 1-3 frame hit-pause (sub-perceptual) + screen shake + impact particle + impact sound
  + haptic pulse + (solo/win only) camera punch-in/slow-mo — fired ~simultaneously.
- **Boost:** FOV kick + camera shake + speed lines/particles + layered boost sound + haptic ramp +
  color-tiered spark feedback if charge-based.

---

## GAP 2 — Comeback / catch-up / rubber-banding

### Prefer skill over power; keep a dead zone `[R]`
- Modify AI *driver skill* (braking/cornering/accel), not raw power — keeps AI "in the same car",
  avoids the look of cheating; add power only when skill is maxed/minned.
- Keep a **"dead zone" around the player where rubber-banding is fully disabled**, so close
  competition feels fair. *(gameaipro Ch.42, primary, 3-0)*
- *(Context: our game is player-vs-player, not vs AI — the transferable principles are "don't let
  catch-up be visible/unfair in close quarters" and "catch-up should create drama, not erase
  skill." The AI-skill mechanic itself maps to any future bots/ghost-fill.)*

### Two philosophies — choose explicitly `[R]`
- **Mario Kart** — keep the trailing pack close behind the leader (can't err without being passed).
- **Split/Second** — actively prevent staying in first ("not for very long"); guarantees drama,
  punishes skill harder. *(gamedeveloper rubber-banding-as-requirement, 3-0)*
- **Recommendation for a non-gamer party audience:** Mario Kart's "keep it close" is gentler and
  preserves skill expression; lean that way. `[S, applying the source]`

### Rubber-banding can be a hard *requirement* `[R]`
- When a core mechanic needs proximity, banding is required not optional: Split/Second's "power
  play" attacks need nearby opponents, so leading alone removes the main fun. *(same, 3-0)*
- **For us:** if derby weapons/smashing are the fun, keeping cars near each other is a *design
  requirement*, not just balance.

### The Blue Shell — intentional unfairness for drama `[R]`
- Position-based catch-up item targeting the leader; prevents skill-based runaways, holds tension
  across mixed-skill groups. *(2-1 — "rubber-banding" is the analysts' label)*
- Director Kosuke Yabuki: removing it made the game "feel like something's missing"; he defends the
  frustration ("Sometimes life isn't fair") **but also wants to minimize frustration where
  possible.** *(gamedeveloper Blue-Shell-defense, 3-0)* → principle is **necessary drama, not
  celebrating unfairness.**
- ⚠️ **Refuted (do not use):** claims that the 1996/Double-Dash Blue Shell was 4th-place-restricted
  (0-3) or early-dodge-able (1-2).

### Keeping last-place / eliminated players engaged `[R-implied]`
- Give trailing players the strongest catch-up tools; keep the dead zone so the leader isn't
  *trivially* overtaken; ensure the trailing experience is **dramatic (close to the pack), not
  hopeless** — proximity is what keeps a losing player believing they're still in it.

---

## GAP 3 — Session structure (partial)

### Jackbox non-gamer pacing `[R]`
- **One task at a time** — pick/draw/type, never juggling — keeps mixed-skill/non-gamers engaged.
  Core rule: *"limit the user's choices, give them one task at a time, make sure they always know
  what to do next."* *(builtinchicago, 3-0)* → **phone shows one clear input mode at a time.**
- **TV-show pacing via the "Interactive Conversation Interface" (iCi)** — codified by Harry
  Gottlieb in "The Jack Principles" (GDC 1997); a host guides players so it feels like a TV
  program. *(builtinchicago, 3-0)* → **a hosted, broadcast-style TV flow** (intros, transitions,
  results pacing) keeps between-round spectators in and makes re-entry feel like "next segment."

### Not answered (still open) ⚠️
- **No verified claims** on best-of-N vs single-round, ideal round/match duration, or drop-in/
  drop-out structures (Mario Kart Party / Fall Guys / WarioWare). **Do not invent specifics** —
  the round-length / best-of-N choices in [01](01-what-makes-a-good-game.md) §4-§5 remain `[S]`.

---

## GAP 4 — Lo-fi / PS1 UI (mostly unverified)

- **Robust finding:** the PS1 look is a reproducible rendering stack — vertex snapping, affine
  mapping, pixelation, short fog-masked draw distance (often + ordered dither + limited color).
  *(gamesradar, 3-0; corroborates [00](00-research-report.md) §2)*
- **Not verified:** the specific diegetic-vs-non-diegetic UI, bitmap-font, HUD, and transition
  techniques of Lethal Company / Content Warning / Buckshot Roulette. **No claims survived.**
- **Reasoned inference (not fact):** apply the *same* low-res, pixelated, dithered, limited-palette,
  no-AA treatment + bitmap fonts at the same internal resolution to 2D UI, so HUD/menus read as one
  designed world. This is why [02](02-design-language.md) §6 stays `[S]`.

---

## Caveats & weak spots (verbatim from the harness)

- Sense-of-speed sources are secondary (GameRant); **motion blur specifically is contested** —
  prioritize FOV + shake + audio.
- Burnout multiplayer detail (slow-mo disabled, steering retained) rests on a single Fandom wiki
  (medium).
- "Blue Shell = rubber-banding" was a split 2-1 vote; functional description sound, label is the
  analysts'. Two Blue-Shell *history* claims were refuted — don't use them.
- Mario Kart durations vary by kart/character Mini-Turbo stat; 0.62/1.67/2.63s are official but
  approximate.
- **GAP 3 (round length/best-of-N) and GAP 4 (UI/font/transitions) are largely unanswered.** Don't
  invent specifics.
- Talks are dated (2012-2017) but are timeless craft references, not fast-moving tech.

## Open questions (carried forward)

1. Evidence-backed round durations / best-of-N for couch racers, and what drives "one more."
2. Drop-in/drop-out so latecomers + eliminated players stay engaged in a mixed-skill group.
3. Concrete diegetic/non-diegetic UI, bitmap-font, HUD, transition techniques of named PS1-revival
   games.
4. Spectator/secondary-objective mechanics (beyond catch-up items) for trailing/eliminated players.
5. Does "keep the pack close" (Mario Kart) or "no runaway leads" (Split/Second) play better for a
   *non-gamer* party audience?

## Sources
- youtube.com/watch?v=AJdEqssNZ-U — Nijman/Vlambeer "Art of Screenshake"
- gdcvault.com/play/1016487/Juice-It-or-Lose — Jonasson & Purho "Juice It or Lose It"
- gdcvault.com/play/1022808/Oh-My-That-Sound-Made — Joonas Turner sound-feel talk
- developer.apple.com/videos/play/wwdc2020/10614 — Apple WWDC haptics guidance
- gamerant.com/racing-games-best-sense-feel-speed — sense-of-speed layering (NFS Heat)
- mariowiki.com/Mini-Turbo — Mario Kart drift-charge tiers & durations
- burnout.fandom.com/wiki/Aftertouch — Burnout 3 Impact Time / Aftertouch
- gameaipro.com/.../GameAIPro_Chapter42…pdf — rubber-banding system (practitioner)
- gamedeveloper.com/design/rubber-banding-as-a-design-requirement — Split/Second
- gamedeveloper.com/design/-sometimes-life-isn-t-fair… — Yabuki Blue Shell defense
- builtinchicago.org/articles/jackbox-games-design-party-pack — Jackbox pacing / iCi
- gamesradar.com/exploring-the-resurgence-of-the-low-fi-3d-visual-style-of-the-ps1-era — PS1 stack
