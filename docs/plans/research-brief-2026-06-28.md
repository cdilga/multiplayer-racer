# Research Brief — Joystick Jammers design pass (2026-06-28)

> Distilled from a `/deep-research` run (24 adversarially-verified claims, 24 sources, 3-vote
> verification). Feeds `feedback-design-pass.md`. **Confidence is labeled per item.** Several
> requested sub-topics produced **no surviving verified claims** — those are listed under "Gaps"
> and remain first-principles design, not research-backed.

## Camera / shared-screen (high confidence — primary sources)

- **Fair N-way split is mathematically impossible for 3+ players.** (Lenz, *Fair Voronoi
  Split-screen for N-Player Games*, EuroCG'18, Thm 2.3 — a fair split that is simultaneously
  equal-area, direction-indicating, fusible, centered, and continuous can't exist for N≥3.)
  → For the crowd, use a **single auto-zoom bounding-box camera** (today's `party` mode) or an
  **overhead** cam. Don't chase a "fair" tiled grid.
- **True dynamic split is a 2-player technique.** The screen-space separator is the **perpendicular
  bisector** of the two players' world positions — one `arctan`. Implement à la the Godot
  `godot_dynamic_split_screen` demo: **two cameras → two viewports → a full-screen quad shader that
  picks, per pixel, which texture to show**; the divider can be **any angle**. Cameras sit on the
  segment between players: **midpoint when close (merged single view), fixed distance when far
  (split)** — that's the merge/split mechanic. Directly portable to Three.js render targets.
- **Implication for items 18/19:** the elegant any-angle split is for 2. A per-player "everyone gets
  a box" grid (item 19) is possible but it's an **unfair equal-tile** layout (relaxes the
  direction/fusible properties) and costs N scene renders. (Sources: docplayer Voronoi paper;
  github BenjaminNavarro/godot_dynamic_split_screen.)

## Arcade vehicle physics (high confidence — Rapier docs/changelog + three.js example)

- **Use `DynamicRayCastVehicleController`** (Bullet `btRaycastVehicle` port, Rapier v0.17.0) — matches
  CLAUDE.md. (Already in use here.)
- **`setWheelFrictionSlip(i, v)`**: higher = more traction, but **too high → instantaneous braking
  and flip risk**. ← This is a candidate root cause for "cars stop dead at walls" (our value is
  1000). (rapier.rs API doc.)
- **`Wheel::side_friction_stiffness`** (added v0.18.0, Jan-2024): tunes **lateral/side friction
  independently** from longitudinal `friction_slip` (made public v0.18.0). **Low side friction =
  more slide/drift.** This is the precise lever for wall-slide deflection and drift — better than
  globally dropping `frictionSlip`. **⚠ Verify it's exposed in the installed `@dimforge/rapier3d-compat`
  version** (Rust symbol names; check the JS `.d.ts`). (rapier CHANGELOG.)
- **Suspension bounciness = three setters:** `setWheelSuspensionStiffness` (push harder),
  `setWheelSuspensionCompression` (damping while compressing), `setWheelSuspensionRelaxation` (raise
  to stop overshoot/bounce) + `suspensionRestLength`. (rapier.rs API.)
- **Known-good arcade baseline (official three.js example):** frictionSlip **1000**, suspension
  stiffness **24**, rest length **0.8**, wheel radius **0.3**, mass **10**, body friction **0.8**,
  steering **±45° (π/4)**, engine force slider **−30..30**. Note vs ours: stiffness 30 (theirs 24),
  mass 32 (theirs 10), steering maxAngle **0.38 rad ≈ 22°** (theirs 45°) — our steering is much
  tighter. Arcade `frictionSlip 1000` is intentionally non-physical. *(three.js example tuning can
  change between releases — verify against installed version.)*

## Procedural audio (high confidence — MDN + sfxr)

- **Mirror the jsfxr/sfxr parameter model** for weapon/pickup SFX: envelope (attack/sustain/punch/
  decay), base freq + freq slide, vibrato, arpeggiation, square duty cycle (PWM), retrigger,
  flanger/phaser, LPF/HPF. (sfxr.me.) A jsfxr-style generator is a concrete, on-brand route for the
  missile/laser/explosion redesign. *(Refuted: sfxr is NOT just 4 waveforms.)*
- **White noise primitive:** `buffer = sampleRate*duration; data[i] = Math.random()*2-1`; shape with
  BiquadFilters + amplitude envelope. (MDN Advanced Techniques.)
- **Canonical envelope idiom (good vs cheap):** `gain.cancelScheduledValues(t)` →
  `setValueAtTime(0,t)` → `linearRampToValueAtTime(peak, t+attack)` →
  `linearRampToValueAtTime(0, t+len−release)`. Smooth, de-clicked envelopes are what separate
  believable SFX from cheap ones. (MDN.)
- **FM pattern:** modulator osc → GainNode → `carrier.frequency` AudioParam (carrier ~440, slow
  modulator ~4 Hz). (dev.to procedural-audio.)
- **Unlock on user gesture:** `AudioContext` starts suspended; `resume()` on first tap/click. (MDN
  Audio for Web Games.) Already relevant given phones-as-controllers.

## Procedural track generation (high confidence on the pipeline)

- **Canonical non-self-intersecting closed loop:** scatter ~10–20 random points → **convex hull**
  (Monotone Chain) → **midpoint-displace** hull edges for concavity → **spline-interpolate** for a
  smooth circuit. (bitesofcode; juangallostra/procedural-tracks; statox.) Our radial-control-point
  generator also avoids self-intersection; convex-hull+displacement is the canonical alternative for
  more varied shapes.
- **Advanced:** *Repulsive Curves* (IEEE CoG 2024, "Generating Race Tracks With Repulsive Curves")
  grows a self-repelling curve (inherently non-intersecting), then a **separate** stage fits a spline
  and re-introduces deliberate crossings/bridges. Open-source Unity impl exists.

## Mechanics & touch UX (medium confidence — secondary sources)

- **Rubber-band catch-up:** boost trailing racers (temporarily exceed nominal top speed) and/or
  inhibit the leader. (Giant Bomb; Game AI Pro Ch.42.) Parameter ranges + named-title specifics
  **unverified**.
- **Touch movement:** a **dynamic/floating joystick** (recenters at touch, display-on-touch, keeps
  registering outside its region) removes accidental movement and adapts to hand size; a **static**
  joystick needs a **dead zone**. **Tension:** for first-run learnability, *visible/discoverable*
  controls (Mario Kart Tour style) may beat invisible ones — a real tradeoff against our onboarding
  goal. (gamedeveloper.com twin-stick usability.)
- **Combat layout:** **left half moves, right half aims/fires** (twin-control transfers from
  twin-stick shooters); large invisible zones maximize active field but visible buttons aid
  discoverability. (MDN Mobile touch.) Supports the item-14/15 "twin-shooter" scheme, with the
  visible-vs-invisible tradeoff flagged.

## Gaps — requested but NO surviving verified claims (treat as first-principles, not research-backed)

- **N-way LEGO merge algorithm** (only a 2-player demo + the impossibility theorem survived).
- **TV name-label readability heuristics** (font sizing, camera angle-of-incidence) and
  **overhead-derby framing specifics**.
- **Wall-slide / wall-riding deflection**, **steering assist / auto-steer**, **banked-curb nudging**,
  and which **friction `CombineRule`** (Min/Max/Average/Multiply) to use for chassis-vs-wall vs
  tyre-vs-track. (`side_friction_stiffness` above is the strongest lever we *do* have evidence for.)
- **Weapon-specific FM/additive recipes** (carrier/modulator ratios, sweeps) for missile/homing/
  explosion/laser; what objectively makes SFX "cheap" beyond envelopes/noise.
- **Named-title** catch-up/weapon-balance/pacing specifics and chaos-vs-skill ratios for 8–60+
  players.
