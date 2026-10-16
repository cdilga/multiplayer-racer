# Fun tracks: what arcade racers do, as rules a generator can follow

Research for **P1-FL20** (br-bbki.23), step 1. Rulings it serves: R124 (variety, height, huge jumps), R129 (the
air is a minigame; every jump is a choice), R132 (beats, set pieces, terrain first, wider roads), R134 (an
interesting choice every few seconds; teach then test; room to pass), R136 (keep building until it's fun; jumps
across the whole road width), R138 (arcadey fun beats realism everywhere).

The survey covers what celebrated arcade racers and the procedural-track literature do, then turns it into
**numbered rules**. Each rule has a **metric** a validator can compute from a generated course (or a fixture run), a
**target**, a rationale and a source. Targets are written in terms of the **design speed** `v_d` (the speed a
competent driver holds through a section) so they survive handling changes. Where a number is needed, the
reference is **v_d = 25 m/s (90 km/h)**: the middle of today's set-piece speed band (`speedBand` 20–28 m/s in
`assets/profiles/set-pieces.json`) and close to its `sightSpeedMps` (20). At 25 m/s, **1 s = 25 m**.

How strong is the evidence? Labels used below:

- **[src]**: a number or practice stated in the cited source (designer, paper, or game data/TAS wiki).
- **[derived]**: computed from a source principle plus our own physics or geometry.
- **[proposed]**: a starting value chosen for this game, to be tuned in the Feel Lab and judged on the couch. It is
  not a claim about another game.

Few arcade studios publish track-design numbers. The strongest sources are McMillan's track-design article (lane
widths, speed variance), the terrain-park jump engineering papers (landing physics), TAS and data wikis (boost sizes
and durations in Mario Kart Wii and CTR), and designer statements (Burnout, MotorStorm, Wipeout, Nintendo). The rest
is direction, not numbers, and the rules treat it that way.

---

## 1. What the games do

### Mario Kart (Nintendo)

- **Shortcuts are small and many, and some cost an item.** In early games a mushroom was needed to cross off-road
  shortcuts (SMK Mario Circuit 1's gravel cut; MK64 Koopa Beach's ramp). Later games favour "a lot of little
  shortcuts for shaving off a few seconds" over big ones. Community estimates of well-known shortcuts are about
  **2–12 s per lap**, and the biggest are the hard-to-execute or glitch ones [src: NWR, thetoptens, Gigazine, Digital
  Trends]. *Takeaway: a shortcut is worth a few seconds, gated by skill or by spending a resource.*
- **Route choice as tactics.** Yabuki on MK8 Rainbow Road: two intertwined routes "support tactical choices",
  including a cut between them [src: Nintendo Everything / Yabuki]. Konno: anti-gravity "fundamentally changes the
  player's strategy" and lets light characters use bump boosts to even the field [src: MTV/GoNintendo].
- **Tracks are built for packs and items.** Double Dash's Baby Park was modelled on short-track speed skating and
  built for aggressive item use [src: Wikipedia, Baby Park].
- **Air pays.** MKWii: a trick off any trickable ramp or lip gives a landing boost of about **+30% top speed for
  ~70–85 frames (~1.2–1.4 s at 60 fps)**, against a mini-turbo's +20% for ~40 frames and a mushroom's +40% for 90
  frames. The input window runs to frame 10 of airtime, and a trick needs at least 50% of base max speed [src:
  mkwtas Trick and Boost wiki]. *Takeaway: a landing reward sits between a drift boost and a mushroom.*
- **Catch-up via items, not the track.** Items are weighted by position (back markers get the strong ones) [src:
  MarioWiki item tables]. This bears on R134's "last place still has fun": costed shortcuts favour players who hold
  more boost.

### Crash Team Racing

- **Hang-time turbo.** The longer you are airborne, the bigger the landing turbo, in tiers (green → yellow → sacred
  fire). The TAS resource lists thresholds in internal hang-time units [src: TASVideos CTR]. Hopping off a lip earns
  extra airtime and so a bigger turbo [src: Activision support]. *Takeaway: reward scales with commitment, in a few
  readable tiers.*

### Excite Truck / Excitebike lineage (Monster Games, Wii)

- **Air pitch is the minigame.** Tilting forward or back pitches the truck: back gives more airtime, forward brings
  it down sooner. Landing on **all four wheels** gives "a massive speed boost", scaled by stars earned from stunts.
  Turbo at the lip gives more air [src: GameSpot review; CNN review; Excite Truck descriptions]. This is R129 almost
  exactly.
- **The criticism matters too.** Reviewers found air control **inconsistent between jumps** ("some jumps allow you
  more control than others") [src: GameSpot; Cubed3]. *Takeaway: air physics must be global constants. Jumps differ
  by geometry, never by special-cased control.*

### MotorStorm (Evolution Studios)

- **Multi-route terrain matched to vehicle classes.** "Every track features multiple routes supporting 7 different
  vehicle classes". Slopes and drops that help one class hinder another, which is why a track can't simply be run in
  reverse [src: Jed Ashforth, PlayStation Blog]. In Pacific Rift, small vehicles take high ridges and big ones push
  through deep water [src: Den of Geek]. *Takeaway: lines differ in character (high/low, dry/wet, smooth/rough), and
  the best line depends on the car and the driver.*

### Burnout 3 / Paradise (Criterion)

- **Roads far wider than real ones.** Alex Ward: "They have to be really wide, much wider than real life… The tracks
  are built around how the cars slide". Wider roads cost the sense of speed, so "we had to make the cars twice as
  fast". Without space "you can't dance through the traffic or light up the boost and chain it" [src: PlayStation
  Blog, Burnout 3 Alpine deconstructed].
- **Takedowns pay boost.** Ramming a rival into a crash knocks them out and pays boost, Criterion's answer to Mario
  Kart's weapons [src: Wikipedia, Burnout series]. This is the basis for R129/R134's "carnage pays".
- **Landmarks and dense roadside detail** sell place and speed: "you're surrounded by these themes and you're soaking
  it up subconsciously" [src: same PlayStation Blog piece].
- **Paradise:** route choice is open, and players learn the city's shortcuts over time. Reviewers note that
  minimap-only navigation lost races, so routes must be readable from the world itself [src: Shacknews; Engadget].

### OutRun (Sega AM2)

- **Forks between stages.** At the end of each stage the road forks: left is easier, right harder. The player picks
  the difficulty of the next stage [src: StrategyWiki; Giant Bomb]. *Takeaway: a fork can choose difficulty as well as
  time, and it must read at a glance.*

### Wipeout (Psygnosis)

- Nick Burcombe's priorities were "the length of straight, steepness of elevation, frequency of undulations". He
  favoured "vertigo-inducing" design and put the rollercoaster-downhill track first for its "wow moment". On his
  favourite track Arridos: "brilliant flow… insane airborne shortcutting… looks carved into the landscape" [src:
  PlayStation Blog, "How the Iconic Wipeout Series Was Born"]. Speed pads were placed "to test player skill and
  familiarity with the course layout" [src: Mean Machines review]. *Takeaway: open with a showpiece; airborne
  shortcuts are the fun; the track must look carved into the land (R132 terrain-first).*

### Hot Wheels Unleashed (Milestone) and Split/Second (Black Rock)

- HWU: set pieces are modules (loops, jumps, boosters, obstacles), and boost pads come in two kinds: charge-the-meter
  and instant [src: reviews; Hot Wheels wiki]. Boost is earned by drifting [src: God is a Geek].
- Split/Second: "power plays" open temporary shortcuts or rebuild a whole section mid-race. The team saw "untouched
  potential in driving around a dynamically changing track" [src: Nick Baynes, Gemubaka]. *Takeaway: set pieces are
  events as well as geometry.*

### Trackmania (Nadeo, community mapping)

- Map review treats **flow** as core: something is always happening, transitions are intuitive, and a map tolerates
  "one or two" flow breaks at most [src: map guideline doc]. The accessibility checklist asks whether corners and
  jumps can be **seen in advance**, whether it is **obvious which way to jump**, and whether there is **enough time to
  react between sequences** [src: TMX "Accessibility in Map Design"]. No "very hard and unsmooth landings" [src: map
  guideline doc]. Air-braking is the technique for clean landings [src: High Ground Gaming]. *Takeaway: readable
  jumps, smooth landings, and a recovery gap between sequences.*

### Micro Machines (Codemasters) and single-screen play

- On one shared screen, the leader sees little ahead and trailing players drop off the screen. Reviewers split on
  whether that is the fun or the flaw [src: TechRadar; Wikipedia MM V3; TheSixthAxis; Pocket Gamer]. *Takeaway for
  our TV (grid plus overview cams): forks must read in the overview, and a hazard must be visible to the car in front
  of the pack with as much warning as to the rest.*

### SSX (EA Canada)

- Real topography (NASA data) as the base, then "arcade the hell out of" it with pipes, wrecks and invented
  features [src: Game Informer, Todd Batty]. Caleb Howard's GDC 2012 talk covers procedural tools that built about 300
  tracks on a ten-track budget [src: GDC Vault]. *Takeaway: realistic land first, exaggerated play features stamped
  in. This is R132's method.*

### Rocket League (Psyonix)

- Jumping is fun because it is **consistent**: boost is a real force on the car, and the physics stays "as pure as
  possible" so outcomes are predictable [src: Kill Screen, Hagewood]. The GDC 2018 talk ("It IS Rocket Science",
  Jared Cone) covers a tuned Bullet setup for responsive, deterministic vehicles [src: GDC/Game Developer]. *Takeaway:
  one consistent rule set the player can learn, with forgiveness built in (cars land on their wheels and recover
  fast), not scripted outcomes.*

### Forza Horizon "danger signs"

- A marked jump from a ramp, scored 1–3 stars by distance; a bad landing doesn't count; speed on the approach decides
  it [src: guides4gamers; noobfeed]. *Takeaway: a telegraphed jump with a tiered distance reward is a skill test in
  itself.*

### Track-design writing

- **McMillan, "A Rational Approach to Racing Game Track Design" (Game Developer, 2011)** [src]:
  - Lane = **1.6 car widths**; shoulders **50–75% of a car width**; scale the environment up about **33%** for a
    third-person camera.
  - Arcade speed variance stays within **±30%** (telemetry sampled every 5 s). Gran Turismo's long straights into
    hard braking give the widest variance; Initial D and Maximum Tune keep it narrow so corners are forgiving.
  - Corners are **on-camber** in arcade games. Corners tighten progressively. Easier corners shed speed before a
    tight one. Corner exits are wider than entries (Maximum Tune).
  - Definite entry and exit points act as **"punctuation"**, separated by landmarks.
  - Height change is used in moderation; a vista comes from a long climb, then a descent that opens the view.
- **Magnopus, "The art of designing a memorable race track"** [src]: escalation (intensity and complexity build);
  splits as real "left or right?" choices that also thin crowding; chaotic moments spaced out so each lands; turns
  over 90° split into segments.
- **Kishōtenketsu / "teach, develop, twist"** (Koichi Hayashida via Game Maker's Toolkit) [src: MCV]: introduce a
  mechanic safely, develop it, twist it. This is the teach-then-test lens of R134.
- **Sid Meier, "Interesting Decisions" (GDC 2012)** [src]: a game is a series of interesting decisions. R134 asks for
  one every few seconds.
- **Risk vs reward balancing** [src: NBA Rush breakdown, Game Developer]: when one lane is clearly best, the choice is
  dead. Fix it by hazards on the easy lane or rewards on the hard one.

### Procedural racing-track literature

- **Togelius, De Nardi & Lucas (2006, 2007)** evolved tracks against a player model, using a player-dependent
  entertainment metric as fitness (multi-objective in 2007). Conclusion: player modelling is hard, but "track
  evolution works well given the right track representation" [src: cogprints abstracts]. The full PDFs returned
  403/TLS errors here, so this doc doesn't quote their exact objectives.
- **Loiacono, Cardamone & Lanzi (2011)**, *Automatic Track Generation for High-End Racing Games Using Evolutionary
  Computation* (IEEE TCIAIG 3(3)): fun is pursued by maximising **track diversity**, measured on the **curvature
  profile** (direct) and the **speed profile** from simulated driving. A human validation found statistically
  significant agreement with player preferences [src: SBPCG survey, arXiv 2311.04710 §8.2]. Cardamone et al. added
  interactive (human-in-the-loop) evolution and TrackGen [src: same; Polimi].
- **Prasetya et al.**: generated tracks measured up to hand-made ones on measured fun [src: same survey].
- **Smith et al., Launchpad (2010)**: levels as sequences of **rhythm groups** (short, non-overlapping
  rhythm-plus-geometry chunks) built by a grammar [src: PCG workshop]. This is the closest published model of R132's
  beat rhythm.
- **Common thread:** generated tracks become fun when (a) the generator has the right building blocks (representation),
  (b) diversity is measured on what the driver feels (curvature and **speed** profiles, not just shape), and (c)
  simulated drivers check the result. Boring generated tracks come from uniform curvature, uniform speed, and
  features dropped onto flat ground with no relation to the land. That last one is the owner's complaint in
  FL15a: "a flat surface with a few elements thrown on".

### Jump physics from the real world

- **Terrain-park jump engineering (Hubbard, McNeil, Petrone et al.)**: landing severity is the **equivalent fall
  height** `EFH = v⊥² / 2g`, where `v⊥` is the velocity perpendicular to the landing surface. A safe landing needs
  the landing slope to nearly match the flight path angle. A constant-EFH landing surface (steepening continuously)
  gives the same impact at **any** takeoff speed. Legs absorb about **1.5 m** of normal EFH (Minetti, cited); the
  built design used **0.5 m** with a 10° takeoff [src: arXiv 1611.04448; Sports Engineering 2015]. *Takeaway: shape
  the landing so the whole speed band lands softly, and make the skill the car's pitch, not surviving the impact.*

---

## 2. The rules

Each rule: **metric → target**, then why and where it comes from. "Course" means one generated lap; "seeds" means the
20-seeds-per-family fixture from FL20's acceptance. "Autopilot" is the scripted best-line bot. Nothing here is a
count cap: every rule is a minimum, a band or a ratio (R-no-caps).

### A. Choices and forks

**R1. Choice cadence.**
- Metric: the longest stretch of a lap (in seconds at `v_d`, autopilot) with no **decision point**.
- Target: max gap **≤ 10 s** (FL16 acceptance); median gap **≤ 6 s** [proposed].
- A decision point is any of:
  - a fork;
  - a lateral line choice (wide section with ≥ 2 distinct lines);
  - a jump commit (send it, or lift);
  - a surface cut (dirt inside line against bitumen outside);
  - a boost-pad or pickup line off the racing line;
  - a takedown zone (R9).
- Why: Sid Meier's interesting decisions; R134. Mario Kart and Wipeout fill a 40–60 s lap with many small choices
  rather than one big one.

**R2. Real forks per lap.**
- Metric: forks whose branches differ by ≥ 2 road widths in lateral separation for ≥ 5 s.
- Target: **≥ 2 per lap** on standard courses, **≥ 1** on sprints [proposed].
- Why: OutRun, MotorStorm and Rainbow Road get their route choice from true splits. Lateral lines alone don't read
  as a fork on a TV.

**R3. Fork shape.**
- Metric: branch geometry.
- Targets [proposed, from McMillan widths plus readability]:
  - split angle **15–35°** between branch centrelines (shallow enough to take at speed, wide enough to read);
  - each branch **≥ 9 m** wide (≥ 3 lanes of 1.6 car widths), or the full road width for a jump line;
  - branch length **6–25 s** at `v_d` (150–600 m);
  - **rejoin**: merge angle **≤ 25°**, the merge funnel holds the sum of both branch widths for **≥ 2 s** before
    narrowing to the road, and no wall nose sits at the merge point.
- Why: a fork that closes in under 6 s reads as a wobble, not a choice. A sharp merge with a wall nose kills packs.
  A wide, shallow funnel is a takedown space (Burnout).

**R4. Commitment is visible before it's required.**
- Metric: line-of-sight from the chase eye (today's `sightEyeBackM`/`sightEyeUpM`) to (a) the split and (b) a
  distinguishing feature of each branch (kicker, gap, ford, landmark).
- Targets: the split visible **≥ 3 s** before the commitment point [proposed]; set pieces visible **≥ 10 s** (FL15b,
  already `minSightS: 10`); a warning sign (as in `biome-rocks-olgas.png`) **2–4 s** before the split [proposed].
- Why: Trackmania's checklist ("seen in advance; obvious which way to jump"); Sandy Petersen/R134 ("sees it before
  committing"). Paradise's minimap-only routing lost races.

**R5. Risk/reward band for shortcut forks.**
- Metric: autopilot times on each branch:
  - `t_safe`: the long way, clean;
  - `t_risk_clean`: the risky branch, executed well;
  - `t_risk_fail`: the risky branch with a typical failure (missed landing → respawn, or spin).
- Targets [proposed, from Mario Kart's 2–12 s/lap shortcuts scaled to one fork]:
  - gain `t_safe − t_risk_clean` = **1.0–3.0 s**;
  - failure cost `t_risk_fail − t_safe` = **≥ 1.5 × gain** and **≤ 6 s** (expensive, but not race-ending);
  - break-even success rate `cost / (gain + cost)` = **55–75%**: a confident player should go, a nervous one shouldn't.
- Why: NBA Rush (a dominated lane is a dead choice); forum and Mario Kart experience (shortcuts "help you a lot, but
  if you screwed them up they really hurt you"). Capping the cost keeps last place fun (R134).

**R6. Line-choice parity for non-shortcut alternatives.**
- Metric: autopilot best-line times on lateral alternatives: high/low line, dirt/bitumen, ridge/gully.
- Target: within **±3% (≈ ±0.5 s)** of each other [proposed]; each line favours a different skill or car trait (grip
  vs slide; RWD tail vs FWD nose, per R138).
- Why: MotorStorm's routes match vehicle classes; Initial D's "race line punishment" pays a risky line only if
  executed. FL16: "no branch dominates… the faster one needs skill".

**R7. Costed shortcuts.**
- Metric: shortcuts whose crossing time depends on spending boost (deep sand, creek ford, scrub cut).
- Target: **≥ 1 per lap** where a shortcut exists [proposed]. Without boost it is **0.5–1.5 s slower** than the main
  road; with boost, **1–2 s faster**.
- Why: Mario Kart's mushroom-gated cuts; HWU's boost economy. Boost leans to the back of the pack (assists, takedowns
  pay boost), so this is a catch-up lever that lives in the track.

### B. Road width and packs

**R8. Width for packs.**
- Metric: drivable road width along the lap (sealed or prepared surface, not off-road).
- Targets [src McMillan: 1.6 car widths per lane; src Ward: "much wider than real life"; derived for a ~1.8 m wide car
  ≈ 2.9 m per lane]:
  - **≥ 12 m** everywhere (4 lanes; today's `WIDTH_M`);
  - **14–18 m** through flow sections and drift corners;
  - **≥ 16 m** at merges and the start straight;
  - shoulders **≥ 1 m** of drivable verge before any wall [src McMillan 50–75% car width];
  - corner exits **≥** entries.
- Why: room to pass (R134), slides need room (Burnout), and packs of any size (no caps) must flow. Wider roads cost
  sense of speed, so pair this with R20's roadside density.

**R9. Takedown spaces.**
- Metric: sections where road width ≥ 16 m and a hard, wreck-worthy edge (rock wall, pole line, parked ute, bin
  field) sits within 3 m of the road edge for ≥ 3 s.
- Target: **≥ 1 per lap**, plus every merge funnel (R3) [proposed].
- Why: Burnout's takedowns pay boost; R129 and R134 say "carnage pays". Takedowns need side-by-side space next to
  something to hit.

### C. Jumps with skill (R129, FL07)

**R10. Every jump is full road width.**
- Metric: kicker width ÷ road width at the kicker.
- Target: **≥ 1.0** (FL15c acceptance; R136).
- Why: a narrow kicker on flat road is the design R132 replaced.

**R11. Approach band and straight core.**
- Metric:
  - (a) straight core from commitment point to end of landing (heading change);
  - (b) the speed band `[v_lo, v_hi]` that clears the gap;
  - (c) autopilot speed at the lip on full throttle from the commitment point.
- Targets:
  - (a) core turn **≤ 0.10 rad** (today's `MAX_CORE_TURN`), and the approach straight **≥ 2.5 s**;
  - (b) band width **≥ 30% of v_d** (today 20–28 m/s ✓);
  - (c) full throttle from the commitment point arrives **inside** the band with **≥ 10% margin above `v_lo`**, while
    a car that lifts, brakes, or gets taken down on the approach falls below `v_lo` [derived].
- Why: the outcome must depend on the player's approach speed (FL20 acceptance). Trackmania asks for time to react
  between sequences.

**R12. Airtime band for big jumps.**
- Metric: flight time at mid-band speed (ballistic, from the kicker's lip angle and the landing height).
- Targets [derived from MKWii's trick window, CTR hang-time tiers and Excite Truck]:
  - set-piece leaps **1.0–2.5 s**;
  - small "teaching" kickers **0.5–1.0 s**;
  - kicker lip angle **12–22°** to get there at 20–28 m/s (≈ 15° gives ~1.3 s on level ground at 25 m/s).
- Why: with under ~0.8 s there's no time to use pitch control; with over ~3 s the pack's action stalls on a shared
  TV.

**R13. Landing shaped like a terrain-park landing.**
- Metric: `EFH = v⊥² / 2g` at the touchdown point for every speed in the band, neutral pitch input.
- Targets: **≤ 1.0 m** across the whole band [src: EFH method; 0.5 m design / 1.5 m leg limit, scaled up for arcade
  cars, proposed]; landing surface within **±5°** of the flight-path angle at mid-band; rim edges (knuckles) rounded.
- Why: Trackmania's "no very hard and unsmooth landings"; landable by construction (FL15b). Surviving the impact is
  not the skill test. The car's pitch is (R14).

**R14. The pitch skill window.**
- Metric, per jump: the car's pitch relative to the landing surface at touchdown under three scripted inputs:
  - neutral;
  - correct (throttle = nose down, or brake = nose up, held for the needed time);
  - wrong.
- Targets [proposed; FL07 acceptance]:
  - neutral lands in the **OK band (8–20°)**;
  - correct input lands in the **clean band (≤ 8°, all wheels within 0.15 s)**;
  - wrong input lands in the **bad band (≥ 25°)**.
  - Geometry produces this by setting the kicker's lip pitch against the landing slope; the generator checks it with
    the same global air-pitch rate the car uses.
- Why: Excite Truck's all-four-wheels landing; FL20's "landed well vs badly depending on approach speed and pitch
  input". If neutral already lands clean, there is no skill.

**R15. Consistent air control (global constants).**
- Metric: the air pitch and yaw rates and the landing bands live in one profile and are read by every jump; the
  validator rejects per-jump overrides.
- Target: air pitch rate able to correct **30° in ≤ 0.4 s** (≈ 75–120°/s) [proposed].
- Why: Excite Truck's main criticism was inconsistent air control. Rocket League's jumping is fun because it is
  consistent.

**R16. Landing rewards and costs, tiered.**
- Targets [MKWii src: trick +30% for ~1.2–1.4 s, mini-turbo +20% ~0.7 s, mushroom +40% 1.5 s; CTR src: tiers by
  hang time; values here proposed]:
  - **Clean**: boost of **+25–35% top speed for 1.0–1.5 s**, scaled up one tier when airtime ≥ 1.5 s (CTR); plus
    meter boost.
  - **OK**: no boost, no loss.
  - **Bad (25–45°)**: lose **20–35% speed**, a wobble, no spin.
  - **Crash (> 45°, or roof/side first)**: spin or tumble, and **self-right and drivable within 1.5 s** (R138: no flip
    traps).
  - **Miss (into the pit)**: respawn with a total cost of **4–6 s** against a clean landing, so R5's failure cost
    holds.
- Why: a landing reward sits between a drift boost and a mushroom (MKWii). Forgiving recovery (R138, Rocket League).

**R17. Run-out.**
- Metric: straight, obstacle-free run-out after the landing at `v_hi`.
- Target: **≥ 2 s at `v_hi`** (≈ 56 m at 28 m/s; today 40–45 m, so **lengthen**) [derived].
- Why: a fast clean landing must not hit a wall or a corner. Trackmania's reaction time between sequences.

**R18. Teach, then test.**
- Metric: for every set-piece leap, an earlier jump on the same lap.
- Target: before the first leap with gap > 12 m (or airtime > 1.2 s), a **teaching jump** appears earlier in the lap
  (small kicker, airtime 0.5–1.0 s, full width, no pit or a shallow one, same landing bands) [proposed].
- Why: Kishōtenketsu (introduce → develop → twist); R134. The player learns the pitch mechanic where failure is cheap.

**R19. Distance pays (sweet spot).**
- Metric: landing zone length and a marked "long" zone.
- Target: the landing zone spans the band (R13). The far third, reachable only near `v_hi` with good pitch, earns the
  higher boost tier (R16) and a TV callout [proposed].
- Why: Forza danger signs (stars by distance); CTR tiers. Doing the same 30 s better is visible skill (R134).

### D. Rhythm, set pieces and landmarks

**R20. Beat rhythm.**
- Metric: the lap's beat sequence (flow / set piece / technical / recovery), and each beat's length in seconds at
  `v_d`.
- Targets [R132 and FL15c targets; Launchpad's rhythm groups; Magnopus spacing]:
  - **≥ 3 distinct beat types per lap**;
  - **no beat type > 40% of lap time**;
  - beats **6–20 s** long;
  - **set pieces ≥ 15 s apart**;
  - **≥ 2 set pieces per lap** (FL15c);
  - a flow or recovery beat of **≥ 4 s** after every set piece.
- Why: chaotic moments spaced so each lands; Trackmania tolerates "one or two" flow breaks.

**R21. Open with a showpiece; escalate.**
- Metric: time to the first set piece, and the position of the largest one.
- Targets [proposed]:
  - something spectacular visible within **15 s of the start** (Burcombe's "wow moment" opener);
  - the **largest** set piece (by airtime or relief) in the **back half** of the lap (Magnopus escalation);
  - the lap's teaching jump (R18) before the first big leap.
- Why: Wipeout's opener; escalation keeps a lap building.

**R22. Speed variance (arcade band).**
- Metric: autopilot speed sampled every 1 s over a lap, excluding the start and respawns.
- Target: **≥ 90% of samples within ±30% of the lap mean** [src McMillan, ±30% at 5 s sampling]; no braking event
  longer than 1.5 s [proposed].
- Why: arcade tracks keep speed up; long straights into hairpins (GT-style) are the sim pattern. Tight hairpins go
  after easier corners that shed speed (McMillan), and tighten progressively.

**R23. On-camber, readable corners.**
- Metric: road bank sign against turn direction; corners over 90° built as segments.
- Target: **no off-camber corners at `v_d`**, and **≥ 1 drift corner per lap** (radius 25–60 m, width ≥ 14 m)
  [src McMillan on-camber; Burnout "huge corners that beg to be drifted"; proposed values].

**R24. Landmark density ("punctuation").**
- Metric: at each 1 s sample of the autopilot run, whether a **unique** landmark is in the chase camera frustum
  (silhouette ≥ 15 m tall, or a unique set-piece prop).
- Target: **≥ 80% of samples**, and **each beat boundary marked** by a landmark or sign [proposed; McMillan's
  "punctuation"; Burnout's landmark use; R132's "seen from afar"].
- Why: recognising the lap is how players learn it, and learning it is how they improve.

**R25. Roadside density for speed.**
- Metric: verticals (posts, trees, rocks, signs) passing within 15 m of the road edge per second at `v_d`.
- Target: **≥ 2/s** on flow beats [proposed; Burnout's "roadsides thick with detail" plus wide-FOV camera].
- Why: wide roads (R8) cost the feel of speed. Close detail buys it back.

### E. Cohesion between biomes, variety between seeds

**R26. Terrain first, road second.**
- Metrics:
  - (a) road relief, min to max height;
  - (b) the share of road length inside a landform corridor (cutting, gorge, ridge-top, gully);
  - (c) set pieces stamped into landforms rather than placed on flat road.
- Targets:
  - (a) **≥ 25 m** per lap (FL15a);
  - (b) **≥ 30%** [proposed];
  - (c) **100% of set pieces sit on a landform** of the matching type (canyon leap in a gorge or rock band, mesa drop
    off a mesa, washout in a gully) [proposed].
- Why: Wipeout's "carved into the landscape"; SSX's real topography exaggerated; the owner's "flat surface with
  elements thrown on" complaint.

**R27. Biome transitions make geographic sense.**
- Metrics: transition length, and the order of biomes against the terrain.
- Targets [proposed, FL15c]:
  - a transition zone of **≥ 5 s**, where surface, scatter and landforms blend;
  - town sits on low, flat ground;
  - rocks (Olgas) sit on high relief;
  - creeks sit in the lowest local ground;
  - bitumen joins town to the open country;
  - the road climbs or descends **into** a rocks section rather than jumping to it.
- Why: cohesion. The reference image shows a highway shoulder leading into an Olgas jump line, with a sign naming the
  road. That's a transition that tells a story.

**R28. Variety between seeds.**
- Metric: per-seed feature vector:
  - curvature histogram;
  - speed-profile histogram (autopilot);
  - relief profile;
  - biome order;
  - set-piece mix;
  - fork count.
  The validator takes the pairwise distance across the 20-seed set.
- Target: **no pair with normalised similarity > 0.85**, and the mean pairwise distance doesn't drop when a generator
  change lands (tracked in the fixture report) [proposed; Loiacono et al.'s curvature-plus-speed diversity].
- Why: the PCG literature's strongest fun proxy is diversity measured on what the driver feels. "No two seeds feel
  the same" (FL15c).

**R29. Every option completable, and bots spread out.**
- Metric: autopilot completion on every branch of every fork, and bot branch choice over 20 seeds.
- Target: **100% completion** on every branch; each branch of a fork taken by **≥ 20%** of bot runs [FL16
  acceptance; proposed share].
- Why: a branch bots never take is visually dead, and in the race it looks like scenery.

**R30. Readable on the shared TV.**
- Metric: in the overview camera, both branches of every fork and every set-piece landing are on screen together for
  ≥ 1 s; in the chase camera, R4's sight lines hold for the **lead** car (no hazard appears with less warning for the
  leader).
- Target: **100% of forks and set pieces** [proposed].
- Why: Micro Machines' one-screen lesson: the leader must not be blind, and a trailing car must still see where the
  pack went.

---

## 3. Today vs these rules (spot check, 2026-10-16)

The data read is `assets/profiles/set-pieces.json` and `crates/jj-procgen/src/course` (no code changed):

| Rule | Today | Gap |
|---|---|---|
| R8 width | `WIDTH_M = 12` everywhere | Width varies per beat; widen flow, merge and drift sections to 14–18 m |
| R3 detour width | `detourWidthM 9` | OK as a minimum. Merges need the R3 funnel |
| R4 sight | `minSightS 10`, `sightSpeedMps 20` | Good for set pieces. Add the ≥ 3 s split-visibility check for every fork |
| R11 band | `speedBand [20, 28]` | ✓ width. Add the "full throttle arrives in band, a lifted car doesn't" check |
| R14 pitch window | none (landable by construction only) | New: lip pitch against landing slope, so neutral = OK, correct = clean |
| R17 run-out | `runoutM 40–45` | Short for 28 m/s × 2 s = 56 m |
| R18 teaching jump | none | New |
| R20 rhythm | FL15c targets exist | Add the ≥ 15 s set-piece spacing and the ≥ 4 s recovery beat |

---

## 4. What to build first

Ordered by how much fun each unlocks per unit of work:

1. **br-bbki.7 (FL07, air control and landing boost): R14, R15, R16.**
   - Without the pitch minigame no jump has skill, so this is the critical path for "actual jumps with skill".
   - Put the air pitch rate and the clean/OK/bad/crash bands in one profile (R15), and the landing tiers with boost
     sizes from R16.
   - Fixture: one jump with neutral, correct and wrong input → OK, clean, bad.
2. **br-bbki.15.2 (FL15b, set pieces): R11, R12, R13, R17, R19, then R18.**
   - Add to the piece validator:
     - lip pitch against landing slope for R14;
     - the EFH ≤ 1 m sweep across the band;
     - the full-throttle-arrives-in-band check;
     - run-out ≥ 2 s at `v_hi`;
     - a far-third "long" zone.
   - Add a small "teaching kicker" piece kind (R18) that shares the canyon-leap definition.
3. **br-bbki.16 (FL16, route forks): R1–R7, R29, R30.**
   - Generalise the set-piece detour into a fork primitive: split angle, branch length, merge funnel (R3); sight
     check (R4); autopilot timing per branch (R5, R6).
   - Then lateral line choices on wide sections, and costed boost cuts (R7).
   - The cadence validator (R1) counts decision points of every kind, so jumps and takedown zones count toward the
     10 s target from day one.
4. **br-bbki.15.1 (FL15a, terrain first): R26.**
   - Already in progress: landforms first, ≥ 25 m relief, corridors.
   - Add the "every set piece sits on its landform type" check, so FL15b pieces are placed where the land already
     wants them.
5. **br-bbki.15.4 (FL15c, cohesion and variety): R8, R9, R20–R25, R27, R28.**
   - Beat sequencer with the R20 bands and the R21 opener and escalation.
   - Variable road width by beat (R8) and takedown zones at merges (R9).
   - Landmark coverage (R24) and transitions (R27).
   - The seed-diversity metric (R28) in the 20-seed fixture report, alongside FL20's own report.

All 30 rules suit the FL20 fixture report: each has a metric computable from the course data or one autopilot run,
and a band to pass. Every number marked [proposed] is a starting value for `?tune` and the Feel Lab, to be judged on
the couch (R136).

---

## Sources

Games and designers
- Mario Kart: Baby Park design: https://en.wikipedia.org/wiki/Baby_Park
- Yabuki on MK8DX Rainbow Road / Booster Course design: https://nintendoeverything.com/mario-kart-8-deluxe-booster-course-pass-interview-kosuke-yabuki-future/
- Konno/Yabuki on anti-gravity: https://gonintendo.com/stories/217968-mario-kart-8-the-antigravity-idea-blue-shell-returns-not-addi
- Shortcut evolution (reader blog): https://www.nintendoworldreport.com/blog/19000
- SMK Mario Circuit gravel cut: https://strategywiki.org/wiki/Super_Mario_Kart/Mario_Circuit
- MKWii shortcut time estimates: https://www.thetoptens.com/super-mario/253976/ ; MK64 Choco Mountain: https://gigazine.net/gsc_news/en/20180607-mario-kart-64-challenge ; MK8 small routes: https://www.digitaltrends.com/?p=1174843
- MKWii tricks and boost table: https://wiki.mkwtas.com/wiki/Trick , https://wiki.mkwtas.com/wiki/Boost
- MK8 item probabilities: https://www.mariowiki.com/Mario_Kart_8_item_probability_distributions
- Iwata Asks Mario Kart Wii / 7: https://iwataasks.nintendo.com/interviews/wii/mariokart/0/1 , https://iwataasks.nintendo.com/interviews/3ds/mario-kart-7/0/1
- CTR hang-time turbo: https://tasvideos.org/GameResources/PSX/CrashTeamRacing ; https://support.activision.com/no/crash-team-racing/articles/crash-team-racing-nitro-fueled-gameplay-tips ; https://www.powerpyx.com/crash-team-racing-nitro-fueled-boost-mechanics-explained/
- Excite Truck: https://www.gamespot.com/reviews/excite-truck-review/1900-6161717/ ; https://www.cubed3.com/games/reviews/wii/excitetruck ; https://money.cnn.com/popups/2006/consumer/video_games/8.html ; https://en.wikipedia.org/wiki/Excite_Truck
- MotorStorm (Jed Ashforth): https://blog.playstation.com/2007/09/06/motorstorm-revenge-weekend ; Pacific Rift review: https://www.denofgeek.com/games/motorstorm-pacific-rift-ps3-review ; Apocalypse interview: https://www.thesixthaxis.com/2010/06/10/interview-motorstorm-apocalypse/
- Burnout 3 Alpine deconstructed (Alex Ward): https://blog.playstation.com/archive/2017/08/31/classic-levels-deconstructed-burnout-3-takedowns-blistering-alpine-track
- Burnout series and takedowns: https://en.wikipedia.org/wiki/Burnout_(series)
- Burnout Paradise: https://www.engadget.com/2007-09-27-joystiq-hands-on-burnout-paradise.html ; https://www.shacknews.com/article/50843/burnout-paradise-review ; https://gamespot.com/articles/15-years-ago-burnout-paradise-redefined-what-an-arcade-racing-game-could-be/1100-6510819/
- OutRun forks: https://strategywiki.org/wiki/OutRun ; https://www.giantbomb.com/games/3030-11260/
- Wipeout (Nick Burcombe): https://blog.playstation.com/?p=191709 ; speed pads: https://everygamegoing.com/larticle/Wipeout-000/32202
- Hot Wheels Unleashed: https://www.godisageek.com/reviews/hot-wheels-unleashed-review ; https://hotwheels.fandom.com/wiki/Hot_Wheels_Unleashed
- Split/Second (Nick Baynes): https://gemubaka.com/2012/05/06/nick-baynes-on-splitsecond/ ; https://www.timeextension.com/features/the-making-of-splitsecond-the-game-that-tried-to-better-burnout
- Trackmania mapping: guideline doc https://docs.google.com/document/d/1hB_dZHk9OYu_GghrEHvVd4eELX-eT5oQ4WZCj2yGbr4/export?format=pdf ; accessibility thread https://trackmania.exchange/s/ft/287 ; air-brake landings https://www.highgroundgaming.com/trackmania-beginners-guide-tips/
- Micro Machines one-screen: https://www.techradar.com/news/gaming/why-micro-machines-was-a-small-racer-with-a-big-heart-1288403/2 ; https://en.wikipedia.org/wiki/Micro_Machines_V3 ; https://www.thesixthaxis.com/2017/06/30/micro-machines-world-series-review/
- SSX: https://gdcvault.com/play/1015547/Asking-the-Impossible-on-SSX ; https://gameinformer.com/games/ssx/b/xbox360/archive/2011/04/06/ea-carves-up-a-world-of-mountains-in-ssx.aspx
- Rocket League: https://www.killscreen.com/why-rocket-leagues-jumping-so-much-fun/ ; https://gamedeveloper.com/design/video-the-rocket-science-behind-i-rocket-league-s-i-physics ; https://www.rocketleague.com/news/rocket-league-at-gdc-2018
- Forza Horizon danger signs: https://guides4gamers.com/forza-horizon-5/pois/danger-signs/ ; https://noobfeed.com/articles/forza-horizon-6-danger-signs-guide

Design writing
- McMillan, A Rational Approach to Racing Game Track Design: https://www.gamedeveloper.com/design/a-rational-approach-to-racing-game-track-design
- Magnopus, The art of designing a memorable race track: https://magnopus.com/blog/the-art-of-designing-a-memorable-race-track
- SRB2 circuit level design (lap 20–40 s, flow): https://wiki.srb2.org/wiki/Level_Design_101/Circuit (403 when fetched; cited from its search summary)
- Kishōtenketsu in Nintendo level design: https://www.mcvuk.com/development/video-nintendos-level-design-secrets-in-four-steps
- Sid Meier, Interesting Decisions (GDC 2012): https://gamedeveloper.com/design/video-sid-meier-explores-interesting-decisions-in-gameplay
- Risk/reward lane balancing (NBA Rush): https://www.gamedeveloper.com/design/nba-rush-level-design-breakdown

Procedural generation literature
- Togelius, De Nardi, Lucas (2006), Making Racing Fun Through Player Modeling and Track Evolution: https://web-archive.southampton.ac.uk/cogprints.org/5221/index.html
- Togelius, De Nardi, Lucas (2007), Towards automatic personalised content creation for racing games: https://web-archive.southampton.ac.uk/cogprints.org/5573/1/Togelius2007Towards.pdf
- Loiacono, Cardamone, Lanzi (2011), Automatic Track Generation for High-End Racing Games Using Evolutionary Computation, IEEE TCIAIG 3(3) 245–259: https://dblp.uni-trier.de/pid/43/7185.html
- Survey of search-based PCG (racing tracks §8.2): https://arxiv.org/pdf/2311.04710
- Smith et al., Launchpad rhythm-group generation: https://www.pcgworkshop.com/archive/smith2010analyzing.pdf
- TrackGen / interactive track evolution (Cardamone): https://re.public.polimi.it/cris/rp/rp00493

Jump physics
- Petrone, Cognolato, McNeil, Hubbard, constant equivalent fall height jump: https://arxiv.org/abs/1611.04448 (full text https://ar5iv.labs.arxiv.org/html/1611.04448)
- Levy, Hubbard, McNeil, Swedberg (2015), design rationale for safer jumps: https://link.springer.com/article/10.1007/s12283-015-0182-6

Local references
- `art/references/australia/generated/biome-rocks-olgas.png`: walled channel kicker beside an open dirt road,
  warning sign before the commitment, dome landmark behind the lip.
- `assets/profiles/set-pieces.json`, `crates/jj-procgen/src/setpieces/mod.rs`, `crates/jj-map/src/setpiece.rs`.
