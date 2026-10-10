# Sim learnings (append-only)

## 2026-10-03 · Rapier 0.36's raycast vehicle, measured (P1-S01)

Pinned by `crates/jj-sim/tests/rapier_api.rs` (raw Rapier, flat ground, a 1,200 kg box car facing +z). Spike C saw some of
this through the JS API; these are the Rust 0.36 facts.

- **Order:** `update_vehicle(dt, broad_phase.as_query_pipeline_mut(narrow_phase.query_dispatcher(), &mut bodies,
  &mut colliders, QueryFilter::default().exclude_rigid_body(chassis)))`, then `step`. `PhysicsWorld` bundles the sets and
  pipelines. Set `index_up_axis = 1`, `index_forward_axis = 2` for +y up, +z forward, and axle `(-1, 0, 0)`.
- **`engine_force` is a force:** Rapier integrates it with `dt` (the same speed gain per second at 120 Hz and 60 Hz).
- **`brake` is an impulse per tick**, so its effect scales with the tick rate: 4 N·s on 4 wheels × 120 ticks ÷ 1,200 kg
  = 1.6 m/s lost per second, exactly as measured; half that at 60 Hz. jj-sim converts brake force × dt.
- **Per wheel, `brake` is ignored while that wheel has an engine force.** Braking means zeroing the engine force first.
- **Only a positive `engine_force` wakes a sleeping chassis**: steering, reverse and braking don't.
- **`update_vehicle` pumps velocity into a sleeping chassis:** it keeps applying suspension impulses without waking it, so
  a car asleep at rest reads ~0.5 m/s of velocity it isn't moving with and would jolt on waking. jj-sim's chassis
  `can_sleep(false)`, which also makes the wake rule moot for cars.
- **Suspension stiffness is per kilogram:** Rapier multiplies the spring force by the chassis mass.
- **No remove-wheel API:** disable a wheel by zeroing its `max_suspension_force` and `friction_slip` (its corner drops).
  Changing a wheel's tuning doesn't wake the chassis either.
- **Heightfield:** `ColliderBuilder::heightfield(Array2 rows = z, cols = x, scale)` is centred on its collider.
- **Handedness:** with +y up and cars facing +z, +x is the car's *left*. Spike J's model and the look skill call +x
  "right"; P1-V02's sidecar settles it physically: wheel_FL, door_FL and the whip are on +x.

## 2026-10-03 · Provisional Cruz profile numbers (P1-S01, tuned in P1-S03)

`VehicleProfile::provisional_cruz()` (Spike J's dimensions): from rest, full throttle reaches ~10 m/s in 2 s and ~23 m/s
in 6 s on the greybox straight (7 kN rear drive, 0.15 linear damping, so ~39 m/s terminal), dead straight, upright; at
rest it settles at 0.82 m chassis height with ~0.03 m/s of residual suspension motion. These are scenario envelopes,
not feel targets.

## 2026-10-03 · Race rules and recovery (P1-S05)

- **Ghosts need explicit groups everywhere.** A Rapier collider's default `InteractionGroups` is ALL/ALL, and ALL
  includes every bit, so a default-group prop still collides with a ghost whose filter is only WORLD. Terrain and
  dressing are WORLD, props PROP, cars CAR, and finished cars GHOST with filter WORLD. Wheel rays need groups too
  (`QueryFilter::groups`), or a racer's suspension stands on a ghost.
- **Maths that decides state goes through `libm`.** f32 `hypot`/`acos` are the platform's libm, so native and WASM
  could disagree on a gate crossing. The race module uses `libm::hypotf`/`acosf`. `route_spawn` and
  `CarState::heading` still use the std versions (S01); move them when a cross-target replay test needs it.
- **Coasting takes a long time to stop.** With 0.15 linear damping a car rolling at 15 m/s is still doing about
  8 m/s 4 s later, so a "stopped for 1 s" Recover test has to brake first.
- **Flip assist numbers.** A PD torque about `up × Y` (9 kN·m/rad, 3 kN·m·s/rad, capped at 30 kN·m, applied as an
  impulse once per tick) rights the 1,200 kg cuboid chassis from every one of the 12 bank poses about 1.1 s after the
  assist starts (2.1 s after rest), well inside the 4 s rule. When a car is exactly upside down, `up × Y` vanishes, so
  it rolls about its forward axis instead.

## 2026-10-03 · Placement and spawn protection (P1-S06)

- **Protection deadlocks unless it's ordered.** Two protected cars that overlap each other would both wait forever if
  each counted the other as blocking. A protected car ignores higher-id protected cars, so the lower id turns solid
  first and the other waits for it to move.
- **Assert on the transition, not the state.** Solid cars that drive into each other touch, and with a clearance
  margin their footprints overlap. The invariant is that protection never ends overlapping, so check the cars whose
  protection ended this tick.
- **Overflow staggering needs a non-repeating sequence.** A fixed step modulo the row gap came back to within 0.75 m of
  the slot after six layers. Roberts' R2 sequence, offset 1–7 m behind the slot, never lands on player 1's spawn.
- Host test surface (P1-F05b): a seated car follows its seat, so scripted `inputs` spans only drive unseated cars. The
  host applies the fixture's inputs first and then the seats' controls, and a silent seat reads neutral. Drive a seated
  car through its fake controller (`__jjTest.drive` + `untilFact`, which re-sends the stick every 6 ticks, the way a
  phone would; one sample goes stale after 250 ms of sim time).
- An open-ended run (the live host) has no last tick, so `jj-fixture`'s end-of-run checks never evaluate on their own.
  The surface's `outcome` calls `Harness::check_now` first.

## 2026-10-03 · The Cruz Missile from its sidecar (P1-S03a)

- **Body frame = vehicle space.** The chassis body's origin is the sidecar's (on the ground between the axles), so a
  renderer puts the GLB at the body pose with no offset. Every spawn `lift` is now a real drop: 0.1 m
  (`SPAWN_LIFT_M`, also the respawn lift and fixtures' default). A fixture or test that spawned at 0.6 m (the old
  box-centre frame's ride height) now drops 0.6 m and spends ~40 ticks in the air before the engine can act.
- **Rest at the design pose.** Wheel hard points sit `suspension_rest − static sag` above the pivots, with sag
  g / (4 × stiffness), since Rapier's spring force is stiffness × compression × chassis mass. The car rests with its
  origin ~0 m off the road.
- **Hull:** the chassis is the convex hull of the *intact body's* proxies (core, front, back, doors). The core proxy
  alone is just the cabin (z −1.64…0.92). Mass properties come from the profile's mass and the sidecar's `com` anchor,
  with box inertia from the hull's bounds. The bubbly sides roll a car off its flank and back onto its wheels; only a
  roof landing stays inverted.
- **Body roll needs `roll_influence`.** Rapier's raycast vehicle moves each side impulse (1 − 0.1) of its height up
  toward the centre of mass before applying it. That `roll_influence` is private and fixed at Bullet's 0.1, so roll is cut
  by 90 % (0.5° in a hard turn). The sim applies (up · h · (r − 0.1)) × J per wheel after `update_vehicle`, exactly what a
  public `roll_influence` of r would do. It's a profile number, not a fudge factor.
- **…and too much of it dives the car (2026-10-10, R122).** At r = 0.6 a hard turn rolled the bubbly body onto its sill
  (its hull sits only 0.115 m off the ground at rest) and flipped it: the handling bank
  (`crates/jj-procgen/tests/handling.rs`) found 53 roll-overs in 513 thrown-about runs on generated roads and an 84° roll on
  flat tarmac. r = 0.12 gives none, about 1° of lean at idle-settle and 12.6° worst (a spin under locked brakes at
  35 m/s). Suspension stiffness, rest length and travel didn't help (rest length doesn't move the ride height: the hard
  points keep the design pose; capping travel lifts wheels). Below 0.1 changes nothing. The debris-pile escape is
  chaotic in r (0.1 stuck, 0.12 out in 19 m, 0.15 in 30 m, 0.18 stuck), so it is fragile; drift rear grip went 0.35 →
  0.31 to keep drifting down a straight at least a tick slower than driving it.
- **The profile is compiled in** (`include_str!`), so `jj sim` and the host see edits to
  `assets/profiles/cruz-missile.json` only after a rebuild. Tune with `--set`/`--sweep` first, then write the file.
- **DRIVE y is one stick.** Throttle drives; brake, or a negative throttle (the stick pulled down, as mash baselines
  throw it), brakes. Below `reverse_below_mps` it reverses, and throttle while rolling backwards brakes first. Holding the
  brake after stopping therefore reverses, so a scripted stop releases once stopped.
- **Air control** is DRIVE in the air: holding the throttle over a jump pitches the nose down, so the torques must stay
  mild (900 N·m pitch, 1,500 N·m roll). Levelling a 25° tilt takes steering into it and then back out to stop the roll.
- **Grip limits cornering, not straight-line speed.** With `friction_slip` 2.0 the tyres don't break traction under full
  engine or brake force on any surface. Surfaces show in turns: at 15 m/s on full lock for 1 s, heading change is 57° on
  tarmac, 50° on rock, 44° on dirt and 38° on gravel. The authority sweep shows lock only matters at low speed: at 15 and
  30 m/s, heading change in 0.5 s is grip-bound (about 24° and 14°) whatever the lock.

## 2026-10-03 · Drift and boost (P1-S03b)

- **The ACTION stick is in `DriveInput`** (`drift`, `boost`, journaled) from jj-input's held sectors (`SourceSemantics`),
  and it passes through the autopilot: an idle player's is neutral, and a bot's or a scenario's rides on the
  autopilot's line. Only DRIVE moving hands control back.
- **Handbrake drift** sets the rear tyres' friction slip × 0.35 at once and recovers linearly over 0.4 s. An open-loop
  drift has to be a flick (about 0.5 s) with counter-steer. Holding it for 0.75 s at 0.8 lock spins the car through
  180°. At 18 m/s the car takes about 1 s after the release to grip again, however long the counter-steer.
- **Boost-forever only lost once holding it had a structural cost.** The meter (drain 0.35/s, refill 0.12/s) makes
  boost a trickle. Trickling it out (hold forever) is as good as saving it unless spending at the wrong moment costs
  something. Three things together make the timed line win, and every 2-car autopilot run agrees:
  1. Boost overrides braking.
  2. A burst needs 0.25 of meter to start.
  3. An emptied meter re-arms only on release, so holding forever gives one burst.

  Before the re-arm rule, holding boost forever won by 9–16 m in 20 s, because the low-skill autopilot corners far
  under the grip limit. The engine power limit (`max_engine_power_w`) made no difference, so it's at 0 (off) and kept
  for tuning.
- **Baselines got two kinds** for the §7.3a claims: `no-action` (the same inputs without drift or boost) and
  `boost-forever` (boost held throughout, for every car). `differ` entries can require the deliberate run to be
  *higher* (`more`) and can name which baselines they judge (`against`). A claim like "faster with boost" then binds
  exactly those baselines, and mash is judged on something else.
- **Route `progressM` rewards cutting the infield.** It measures the nearest point along the route, so an open-loop
  car that leaves the road can gain tens of metres. Gate-based `legalProgressM` stays 0 for a car that starts mid-lap.
  Check `maxRouteOffsetM` before trusting progress, or use the autopilot for the line.

## 2026-10-03 · The wheelie (P1-S03c)

- **One detector, three callers.** jj-input's `WheelieDetector` finds the gesture: past −0.85 to preload, then up
  past −0.3 within 250 ms. Holding the preload past 1.2 s cancels it.
  - A controller sends the release as `ControllerCmd::Action`. The host applies each action id once, since it can
    arrive twice on the reliable channel.
  - The host's own `SourceState` detects host pads' and keys' releases.
  - Fixtures with raw `stick` spans run the same `SourceState` per car.

  The sim never sees the stick, only `Sim::wheelie(car, preload_ms)`, which is journaled (`Setup::Wheelie`) and
  replays.
- **`DriveInput::from_semantics`** holds the one sign convention between jj-input (steer −1 left .. +1 right) and the
  sim (positive steer turns left). The host and fixtures both call it.
- **Lift is an impulse at the front axle.** 1,500 N·s at full preload gives ≈9° nose-up and 0.5–0.6 s with the front
  wheels off the ground, about 0.44 m of front lift. That hops a 12 cm kerb, and the car lands on four wheels.
  2,500 N·s stood the car up at 21° for a second. Lift scales with preload up to 0.4 s, so a 0.15 s release only
  squats the nose up 1.7°.
- **Steering while the front is up** needs no extra rule: raycast wheels in the air have no grip, so the car can't
  turn until they're down.

## ACTION utilities (P1-S08)

- **Utilities ride the wheelie's path.** jj-input's sector machine fires `UtilityForward` / `UtilityRear` on a
  deliberate entry (neutral re-arm, hysteresis; a pointer cancel neutralises without firing). The host applies a
  controller's `Action` once per id, detects host pads itself, and fixtures with `stick`/`action` spans run the same
  source machine. The sim sees only `Sim::utility(car, kind)`, journaled (`Setup::Utility`), so it replays.
- **Cooldowns live in the sim, in ticks** (`utility_ready` in `ActionState`): a deliberate re-entry inside the
  cooldown reaches the sim and is refused there, so the journal shows the attempt.
- **Spawn protection ghosts props.** A protected car (the first 1.5 s after a spawn, and until it's clear of debris)
  collides only with the world, so it drives straight through a cone. A duel that needs contact waits out the
  protection, then places its cars (`place` doesn't re-protect).
- **A cone's cost is its mass.** A 4.5 kg cone cost a 20 m/s follower 0.08 m; 8 kg costs about 0.3 m with a visible
  jolt and never wrecks. That's the TUNE lever, not a scripted slowdown.

## 2026-10-07 · Contact episodes and part health (P1-S04a)

- **One collider per part, mass on the core.** The chassis is eleven convex colliders on one body (`core`, `front`,
  `back`, four doors, four wheels), from the sidecar's proxies (`geometry.parts` in the profile, written by `jj vehicle
  sync`). Only the core carries mass properties (density 0 elsewhere), so the car feels as it did as one hull: the feel,
  affordance, placement and race banks all pass unchanged. S04b recomputes mass when a part leaves.
- **Wheel colliders need their own group, and so does the ground.** The heightfield is `GROUP_TERRAIN` (not `WORLD`), the
  wheels `GROUP_WHEEL`, whose filter leaves terrain out, so a wheel strike on a barrier registers while the raycast
  suspension owns the ground. Everything that filtered on `WORLD` (ghost, protected, wheel rays) now filters on
  `WORLD | TERRAIN`. Ghost and protected wheels touch dressing only.
- **Read contacts from `narrow_phase.contact_pairs_with(collider)`, but take velocities from before `step`.** After the
  step the solver has removed the approach, so closing speed is `(v₁ − v₂)·n` from a pre-step snapshot (`PreStep`), at
  each contact point (`v + ω × (p − com)`). `ContactData::impulse` is the step's normal impulse per point.
  Closing speeds read ~3 % under the placement speed at 0.5 m because of the 0.15/s linear damping.
- **The cabin proxy bulges past the door skins.** The core's hull is up to 0.2 m wider than the doors at shoulder height,
  so a side hit lands on the *core* first. A contact on the core belongs to the nearest part within
  `attribution_margin_m` (0.3 m) of the contact point in vehicle space; farther it's the core's and costs nothing.
  Attribution is per contact point: a flat nose straddling two doors splits its impulse between them.
- **A T-bone's nose corners decide which door.** Rapier puts the load on the nose face's corners, not its middle, so a 1.3 m
  wide nose into a 0.7–1.0 m door loads the doors on both sides of where it's aimed. The calibration row aims at the seam
  and asserts the rear door detaches, the front door and wheel beside it are damaged but intact.
- **Calibration** (`DamageTuning` in the profile; `tests/damage.rs`): per N·s of qualifying impulse, front/back 0.007,
  door 0.014, wheel 0.0055. At those, 15 m/s head-on is ~17 kN·s (front 122 of 100 → detached), 8 m/s door-to-door is
  ~3 kN·s (door 42 of 60 lost → loose), 12 m/s T-bone ~5 kN·s on the struck door (detached) and ~7.5 kN·s on the T-boning
  car's own front (loose), 12 m/s wheel on a barrier end ~9.5 kN·s (wheel 52 of 80 → loose). A 5 m/s bump costs ~20.
- **`bump-4` is below the threshold by damping.** A car placed at 4 m/s closes at ~3.96 m/s after 0.3 m, so nothing counts.
  The same bump at 5 m/s counts (closing 4.95) and costs 20 health, no state change.
- **A side shove spins the car for about a second.** A 12 m/s T-bone into a coasting car at 10 m/s yaws it at 65–75 °/s until
  its sideways slide (saturated tyres, ~8 m/s²) has bled off to about the yaw's own slip speed, about 1.1 s after the hit;
  holding throttle through it keeps the rears saturated and the spin lasts as long. `control-after-t-bone` therefore
  steers from 0.75 s and asserts the spin is gone and the steering changes the outcome at 1.0 s.
- **Episodes are keyed (car, part, other body) and windowed from the first qualifying contact.** 6 ticks at 120 Hz,
  closing after the sixth. The other body's causal owner is the car itself for a car, and for debris the car that last
  put a qualifying impulse into it (`Sim::prop_owner`), read *before* the current episode updates it. Debris-to-debris
  chains don't propagate an owner yet.
- **Test timing.** Scenarios place cars 0.5 m from the target with the speed they're named for; `place_car` at
  `y = 0.05` (the design pose is ~0), and wait 2 s in the open first or the cars are still under spawn protection.

## 2026-10-07 · Loose springs, detach and debris (P1-S04b)

- **Mass changes land at once or the energy table lies.** Removing a part's collider and calling `set_mass_properties` on
  the core only takes effect at the next `step`; for one tick the chassis kept its full mass *and* the debris had its
  share, which read as +7 kJ at 14 m/s. `recompute_mass_properties_from_colliders` on the body right after fixes it.
  Chassis mass = profile mass − Σ detached fractions, centre of mass moved off them, inertia scaled with mass (not a
  parallel-axis recompute: a few percent off, inside the energy tolerance).
- **Hinge springs need the *whole tick's* acceleration.** `v_end − v_start_of_step` misses the suspension impulses that
  `update_vehicle` applies before `step` (and reads gravity as the chassis' own acceleration), so the apparent force was
  ~0 and every door stayed shut. The spring takes `(v − last end-of-step v) / dt`, and the part feels `g − a` in
  vehicle space. Placement resets that velocity so a teleport isn't an acceleration.
- **Springs never touch the body.** They are state (angle, rate, clamped to the sidecar's limits with an inelastic stop)
  published for the renderer; the loose part's collider stays at the attached pose. So they can't inject energy.
- **Detached = a dynamic body at the chassis pose with the proxy hull in vehicle space.** The renderer draws the part
  mesh at the body's pose (the part record's pose). Mass is exact (`ColliderBuilder::mass`), velocity is `v + ω × r`
  at the part's centre plus a 1.5 m/s outward kick, spin the chassis'. The kick's energy goes in the authorised-work
  ledger.
- **Fresh debris ignores cars for 250 ms.** It's created overlapping the chassis (same pose); letting the solver separate
  them is a violent energy source. A fresh-debris group touches only the world, then flips to the ordinary prop group.
- **Rapier has no rolling friction.** A detached bumper rolled at 0.5 m/s for 20+ s and never slept. Angular damping 2/s
  on debris (a loss, not a source) lets it come to rest, sleep, and wake on contact.
- **Detached wheels** zero engine force, brake, friction slip and `max_suspension_force` every tick (the pinned
  `rapier_api` way); their corner drops. A loose wheel is friction slip × 0.85.
- **Energy ledger.** `Sim::energy_j()` = Σ(kinetic + potential) over dynamic bodies and a ledger of authorised work: engine
  force·v, air torque, flip assist, wheelie lift, the roll correction, detach kicks and teleports (placement, respawn).
  `Metric::EnergyJ` is E − ledger, `Metric::EnergyGainJ` the most it ever rose above its first reading. Measured
  gains: coast −291 J, loose slalom −391 J, detach kicks −291 J, 20-part pile +5 J (+7 J at doubled solver iterations);
  tolerance 250 J.
- **Wrecks (P1-S04c).** Three triggers, one path (`wreck_car`): two wheels detached (checked after each step through
  `Race::wreck`), the race's stuck-flip and out-of-bounds rules (their `Effect::Respawn`), and `Sim::wreck` (a journaled
  command for scenarios: a failed assist can't be staged otherwise, the assist always rights a car). Every part still on
  the car is detached (debris with the usual mass, velocity and kick), the chassis' core hull becomes a *new* dynamic body
  at the same pose and velocity, the husk, and the car body itself is rebuilt as a fresh intact car (all part colliders
  back, full mass properties, full health, `incarnation + 1`) and teleported to the anchor with the usual hold and spawn
  protection. Same body, controller and CarId, so identity and progress are untouched. The husk's energy and the
  rebuilt mass' are authorised in the ledger; a wreck at 14 m/s reads no energy gain.
- **The respawn is immediate, the hold is 2 s.** The existing S05 behaviour stays: the fresh car stands at its anchor,
  held and protected, from the wreck tick (not 2 s later). The renderer shows the husk where it crashed and the new car
  at the anchor.
- **Debris keeps its owner's car id.** Parts that came off an *earlier incarnation* are "orphans": a part record keyed by
  (car, part) would mark the fresh car's part missing. They and the husks ship as state-3 part records (part 255 for a
  husk) and are drawn on their own; the debris list keeps their slots (kind 2) so indices stay stable.
- **Catch plane.** A fixed cuboid 10 m under the kill plane (5 km half extent) catches whatever leaves the map: an OOB
  husk, a prop off the edge. It lands, sleeps and costs nothing; nothing is despawned.
- **Settable state.** `Sim::set_part_health` is a journaled command (`Setup::PartHealth`, fixtures' `damage` list); a
  state change by command raises the same loose/detached event as a hit, cause scenery.

## A car tipping over its own bumper (P1-S04b follow-up, reverse-after-detach)

- **Symptom.** After losing its front, a car braking to a stop and backing away at ~0.3 m/s crept *forward*, its front-left
  corner rose from 0.0 to 0.46 m over 15 s, `upY` fell to 0.49 and the stuck-flip rule wrecked it. Seen in the live host (the
  `damage.test.mjs` bumper test failed 1 run in 3 on eris), reproduced to the tick by replaying that run's clip and then as the
  fixture `scenarios/affordances/reverse-after-detach.json`.
- **Cause 1: a suspension ray that starts inside a solid.** The fallen bumper's proxy box (1.6 × 1.0 × 2.0 m) lay across the
  front-left wheel arch, so that wheel's raycast origin was *inside* it. A ray that starts inside a collider reports a hit at
  distance 0: full suspension force, and the "ground" point rises with the car, so the chassis climbs and rolls. A wheel's ray
  now ignores any non-world collider that contains its own origin (`Sim::step`, the `QueryFilter` predicate).
- **Cause 2: a part that came off a car at rest never cleared it.** The 1.5 m/s detach kick slides a part ~0.13 m, so a
  stationary car's bumper stayed across the chassis; after `detach_clear_ms` it turned solid *inside* its owner, jammed there
  and never slept (the old `debris_persists_dynamic_sleeps_and_wakes_on_contact` only passed because cause 1 made the car
  walk off the part). A fresh part now becomes solid only once its footprint overlaps no car (`clear_fresh_debris`), like spawn
  protection. While it lies under its owner it is intangible to *every* car; the debris test moves the owner away first.
- **Knock-ons.** Two solid cars teleported on top of each other are no longer pushed apart by their wheel rays treating the
  other's roof as ground (`placement.rs` parked car 1 on car 0's slot; it now stands car 0 aside first). Two cars nose to nose
  with a fallen bumper between them can both be stuck: JN4's drive-away hands them to the autopilot, which presses Recover.

## The wheelie launch has to repay the pull (P1-S09)

- The preload is DRIVE pulled past full brake for at least 0.35 s: the car is braking (or reversing from rest) for that long.
  From rest that is a 0.4 s head start lost; rolling it is about 4 m/s shed. The old payoff, +15 % drive for 0.8 s, is worth about
  0.1 s, so a perfectly timed launch could never beat plain throttle, whatever the timing. Scaling that constant up (1.75, with
  the lift impulse cut to keep `wheelie-ok`) passes the duels but only by hiding the arithmetic, and the drive force pitches the
  car, so it fights the lift envelope.
- The release now gives a forward impulse at the centre of mass of `wheelie_launch_reward` (1.5) times what the pull cost: the speed
  shed over the first 0.4 s plus what the engine would have added. Needs a per-car forward-speed history (150 ticks, hashed).
  A pull held longer costs more and isn't repaid more, so late and held releases lose; an early one gets nothing.
- Trap: the "from rest" duel looks like it needs a big launch; the cost it has to beat is the pull's own duration, so the reward
  is a multiple of that cost, not a magic number.

## 2026-10-10 · Determinism traps found by the duel parity lane
- **A value that feeds the physics must come from libm**, even if it was written for observers. `car_state().heading`
  used std `atan2`; R125's rolling respawn started feeding it back into the car's velocity and the duel parity lane
  (native vs WASM full-state hashes) split on `drift-boost-chain.botched` (a spin, an autopilot Recover, a roll). Now
  `car_state` and `route_spawn` use `libm::atan2f`. `sqrt` is exactly rounded and safe; trig, `pow` and `exp` aren't.
- **CI's browser runners are several times slower than eris** (a G07 test: 77 s there, 15 s on eris). Long journeys that
  click after a heavy screen (8 tiles, a 12-player results screen) have timed out in Playwright's "performing click
  action" while passing on the Mac and eris; those clicks take a 120 s timeout. If one still hangs, the page's main
  thread is blocked: profile it before widening anything.
