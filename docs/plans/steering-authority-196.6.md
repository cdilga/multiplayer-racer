# Steering Authority & Side-Tilt Recovery — implementation plan (br-controller-input-wheelie-feedback-196.6)

> **Status: read-only planning artifact.** Authored by MaroonSpire while the implementation files
> (`static/js/systems/PhysicsSystem.js`, `static/js/GameHost.js`) are exclusively reserved by agent
> **WildBluff**. No production code was edited to produce this. The bead remains OPEN/unassigned for
> an implementer; this satisfies the bead's "Audit current steering authority inputs" + "introduce a
> single steering-authority calculation" design deliverables so implementation can start cleanly the
> moment `PhysicsSystem.js` frees.

## 1. Goal (from the bead)

Replace the current near-binary steering model (full authority grounded → ~0.15 in wheelie/airborne)
with a **progressive, factored** steering-authority model that follows wheel contact, tyre load, roll
angle, speed, wall contact and stunt/recovery state, and add **limited, readable side-tilt recovery**
so a car on two wheels / partly on its side feels participatory rather than dead — without magic
instant resets, frequent flips, or spin-outs.

## 2. Current-state audit (verified, file:line anchored)

All references `static/js/systems/PhysicsSystem.js` unless noted.

**Handling-state detection — `applyVehicleControls` (:819-845).** State derives ONLY from wheel
grounding (`_isWheelGrounded` per wheel):
- `grounded` (default), `front-light` (`frontGrounded && !rearGrounded`, :835),
  `wheelie` (`!frontGrounded && rearGrounded`, :833), `airborne` (all wheels off, :831).
- State stored on `entity.handlingState`; `entity.stateDuration` accumulates per step (:139, reset on
  transition :842).

**Steering computation (:943-976).** Two existing aids + one cliff:
1. Speed lock taper (PROGRESSIVE, good): `speedFactor = min(1, currentSpeed/15)`;
   `effectiveMax = maxAngle * (1 - highSpeedReduction*speedFactor)` (:954-956).
2. **Authority cliff (the problem):** `steeringAuthority = 1.0`, then **hard-set** to
   `wheelieCfg.steeringAuthority ?? 0.15` if state is `wheelie` OR `airborne` (:962-965). No taper.
3. Bad landing: `steeringAuthority *= badLandingSteeringMultiplier` (:966-969).
4. `targetSteer = -steering * effectiveMax * steeringAuthority`; smoothed toward target by
   `smoothing` (:971-976).

**Other authority-relevant inputs that exist but are NOT wired into steering authority:**
- `front-light` state IS detected (:835-836) but contributes **no** softening — authority stays 1.0
  until the car is fully in `wheelie`, so the transition is still a cliff (bead wants "soften before
  the car fully enters wheelie").
- **Wall contact**: `entity.inWallContact` polled from the contact graph each step (:126-132) but only
  reduces **tyre grip** (`wallGrip`, :885) — it does **not** adjust steering authority/assist.
- **Roll angle / side-tilt / two-wheel**: **not detected at all.** Only front/rear grounding is used,
  so "on two wheels / partly on its side" collapses into `wheelie`/`front-light`/`airborne` with no
  recovery influence. `body.rotation()` (quaternion) is available (:990) and `body.angvel()` (Rapier)
  is available for roll-rate.
- **Speed**: `vc.currentVehicleSpeed()` (:896).
- Dead (:847-854), EMP stun (:856-870) hard-zero steering (keep as-is; these are correct overrides).

**Config source** — `static/assets/vehicles/default.json`: `steering.maxAngle=0.38`,
`steering.highSpeedReduction=0.45`, `wheelie.steeringAuthority=0.15`, `wallSlideGrip=0.2`,
`stunt.badLandingSteeringMultiplier=0.55`. Tunable live via **`PhysicsTuningUI`** (F2) which already
hosts `steering.maxAngle`, `steering.highSpeedReduction`, `wheels.wallSlideGrip` sliders
(`static/js/ui/PhysicsTuningUI.js:103-133, 549-550`) — the natural home for new authority knobs +
the telemetry readout.

## 3. Gap analysis vs bead requirements

| Bead requirement | Today | Gap |
|---|---|---|
| Soften BEFORE full wheelie (front-light) | front-light detected, authority=1.0 | add front-light taper |
| Progressive authority (no cliffs) | hard 1.0→0.15 at wheelie | replace with curve |
| Airborne weaker than wheelie shaping | both use same 0.15 | split: airborne < wheelie |
| Side-tilt / two-wheel recovery | not detected | add roll detection + recovery torque |
| Wall contact helps peel away | grip only | optional steer-away assist, no extra stick |
| Bad-landing ramp back (not snap) | flat 0.55 multiplier for window | ramp authority over recovery |
| Single factored, testable calc | inline in applyVehicleControls | extract pure helper |
| Telemetry: authority + dominant limiter | none | add to F2/DebugOverlay |

## 4. Proposed design

### 4.1 Extract a pure, testable function
New module `static/js/systems/steeringAuthority.js` (NEW file — no lock conflict):

```
computeSteeringAuthority(inputs, cfg) -> { authority: 0..1, limiter: string, factors: {...} }
```
`inputs`: `{ speed, frontContact (0..1), rearContact (0..1), allAirborne, rollAngleRad,
angularSpeed, inWallContact, badLandingProgress (0..1), stunned, dead }`.
`authority` = product (or min, see below) of independent **factor curves**, each in 0..1:
- `fSpeed` = existing taper `1 - highSpeedReduction*min(1, speed/speedRef)`.
- `fContact` = smoothstep on front-wheel load: full at both-front grounded, easing down through
  `front-light`, to `wheelieAuthority` at rear-only, to `airborneAuthority` (< wheelie) when airborne.
- `fWall` = mild: when `inWallContact`, keep authority for *steer-away* but never increase grip
  (grip stays owned by existing `wallSlideGrip`; this factor only ensures we don't zero steering into
  a wall).
- `fBadLanding` = ramp from `badLandingSteeringMultiplier` back to 1.0 over `badLandingDuration`
  using `1 - badLandingProgress`-weighted lerp (replaces the flat multiplier so control returns
  gradually, not as a snap when the window ends).
`limiter` = name of the factor with the lowest value (the "dominant limiter" the bead asks to
surface). Keep `authority = min(factors)` rather than product so the limiter is unambiguous and the
telemetry reads truthfully; document the choice in the function.

The function is **pure** (no Rapier, no globals) → trivially unit-testable; `applyVehicleControls`
calls it and feeds the result into the existing `targetSteer` line (one-line swap at :962-971).

### 4.2 Extend handling-state detection for roll / side-tilt
Add to the per-step state derivation: from `body.rotation()` compute the car's **roll angle** (angle
between body-up and world-up about the forward axis) and read `body.angvel()` for roll rate. New
states/flags (additive; don't break the existing 4):
- `side-tilted` when roll angle exceeds `tiltOnsetRad` (e.g. ~35°) and the car is not fully airborne.
- `on-side` when roll exceeds `~75°` (near two-wheel/over).
These set `entity.rollAngle` / `entity.handlingTilt` for telemetry and recovery.

### 4.3 Side-tilt recovery control (forgiving, not magic)
When `side-tilted`/`on-side` and the player supplies steering/throttle/brake, apply a **small, capped
righting + yaw torque** via `body.applyTorqueImpulse` proportional to input and to how far past
upright the car is, hard-capped and rate-limited (mirror the wheelie-lift cooldown pattern at
:981-1007 so it can't be spammed into a flip). Tuning: `recovery.maxRightingTorque`,
`recovery.yawAssist`, `recovery.cooldownMs`. Guard: zero assist once `rollAngle < tiltOnsetRad`
(don't over-correct past upright → no oscillation/flip), and never while fully airborne (keeps
"no precise control in the air").

### 4.4 Config additions (`default.json`, additive, defaults preserve current feel)
```
steering.speedRef: 15
wheelie.steeringAuthority: 0.15   (existing)
wheelie.airborneAuthority: 0.08   (new; < wheelie)
steering.frontLightAuthority: 0.6 (new; soften before wheelie)
recovery: { tiltOnsetRad: 0.6, maxRightingTorque: …, yawAssist: …, cooldownMs: 250 }
```
Expose the new knobs in `PhysicsTuningUI` (F2) alongside the existing steering sliders.

### 4.5 Telemetry (bead requires authority + dominant limiter visible)
`applyVehicleControls` writes `entity.steerTelemetry = { authority, limiter, factors, rollAngle,
state }`. `DebugOverlayUI`/`StatsOverlayUI` render a one-line readout: `auth 0.42 (limiter: contact)
| state: front-light | roll 22°`. No per-frame console logging (CLAUDE.md rule) — overlay only.

## 5. Test plan (the bead's required evidence)

**`tests/unit/steering-authority.test.js`** (NEW; unit-tests the pure function — `npx vitest run
tests/unit/steering-authority.test.js`). Coverage matrix:
- grounded both-front → authority ≈ full, limiter `none`/`speed`.
- speed taper: rising speed lowers authority, limiter `speed`.
- front-light → authority between grounded and wheelie (proves the cliff is gone), limiter `contact`.
- wheelie/rear-only → ≈ `wheelieAuthority`.
- airborne → ≈ `airborneAuthority` and **< wheelie** (explicit assert).
- wall-loaded → steering not zeroed into the wall; grip factor untouched.
- bad-landing → authority ramps from `badLandingSteeringMultiplier` back to 1.0 over progress
  (assert monotonic increase, not a step).
- roll/side-tilt → recovery branch engaged; dominant-limiter output correct.
- dominant-limiter selection returns the truly-lowest factor for mixed inputs.

**Integration/sim proof** (`tests/integration/race-… or a new headless sim`): a car driven from flat
floor onto a tilt gives **limited** recovery (rights over N steps, not 1) and wall contact does **not**
increase barrier sticking (compare exit speed/lateral distance vs baseline). Wheelie tradeoff guard:
a car in wheelie cannot achieve a grounded-equivalent yaw rate (assert capped).

**Tuning/telemetry evidence:** screenshot/JSON of the F2 overlay showing live `authority`,
`limiter`, `rollAngle`, and the new knobs.

## 6. Implementation sequencing & file footprint

1. NEW `static/js/systems/steeringAuthority.js` (pure helper) + NEW
   `tests/unit/steering-authority.test.js` — **no lock conflict**, can start anytime.
2. Wire into `PhysicsSystem.applyVehicleControls` (swap :962-971; add roll detection near :126-142;
   add recovery torque near the wheelie-lift block :981-1007) — **requires `PhysicsSystem.js`**
   (currently WildBluff, exclusive).
3. `default.json` config additions + `PhysicsTuningUI` knobs + overlay readout (`DebugOverlayUI`/
   `StatsOverlayUI`).
4. `GameHost.js` only if telemetry plumbing needs it — currently WildBluff (exclusive).
5. `npm run build` → E2E sanity (`car-movement.spec.ts`, `camera-modes.spec.ts`) for no regression.

**Coordination:** steps 2 and 4 must wait for / coordinate with **WildBluff** (holds `PhysicsSystem.js`
+ `GameHost.js`). Step 1 (pure helper + its unit test) is fully decoupled and could be built first by
anyone without touching locked files — recommend starting there.

## 7. Risks / guards (bead acceptance gates)

- **Frequent flips/spin-outs:** recovery torque hard-capped + rate-limited + disabled once upright;
  authority curves are monotonic (no overshoot).
- **Wall stickiness:** steering factor only *prevents zeroing into walls*; grip stays owned by the
  existing `wallSlideGrip` — assert exit behaviour in sim.
- **Wheelie tradeoff must remain meaningful:** `wheelieAuthority`/`airborneAuthority` kept low and
  yaw-rate-capped; unit + sim asserts.
- **Determinism/perf:** pure function, no allocations in the hot path beyond a small result object
  (can be a reused scratch object); no per-frame logging.
- **Default feel unchanged** unless knobs are tuned: ship defaults equal to today's effective values
  except the front-light/airborne split, which is the intended improvement.
