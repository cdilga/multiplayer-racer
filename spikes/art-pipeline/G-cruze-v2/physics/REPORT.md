# Spike G-cruze-v2 — physics-fit check for `cruz-missile` (2026-09-30)

Engine: `@dimforge/rapier3d-compat` 0.19.3 (same as the C-physics spike), headless Node, dt = 1/120,
`DynamicRayCastVehicleController`. Asset: `art/vehicles/cruz-missile/cruz_missile.lod1.glb` +
`cruz_missile.asset.json`, per `spikes/art-pipeline/G-cruze-v2/ASSET-CONTRACT.md`.

**IMPORTANT — moving target during this spike.** The asset files were modified *while this spike was
running* (mtimes moved during the session; e.g. `col_chassis`'s vertex count changed from 108 to 78,
and `col_bumper_front`/`col_bumper_rear` changed from box to convex colliders, between two runs of the
same loader). Someone/something (likely another agent iterating on the G-cruze-v2 build pipeline) was
actively regenerating this asset concurrently. Every number below is a self-consistent snapshot: all
five test scripts were run back-to-back with the GLB/sidecar mtimes checked stable immediately before
and after (`cruz_missile.lod1.glb` mtime `1790729149`, `cruz_missile.asset.json` mtime `1790729175` —
2026-09-30 10:45:49 / 10:46:15 AEST). **Re-run before trusting these numbers against a later revision.**

**Verdict: GO, with two real asset-collider defects and one honestly-measured rollover limit.**

| Check | Result |
|---|---|
| Loader: mass fractions sum to 1.0, groundOffsetY≈0, colliders (box/convex/cylinder), wheel hardpoints, anchors | PASS — no anchor mismatches |
| Settle | 0.51 s; resting hub Y 0.373 m vs 0.44 m authored (−0.067 m sag); all 4 wheels grounded, no penetration |
| Full throttle 3 s (FWD, 2 driven wheels) | 55.0 m, 62.5 km/h, still accelerating (no drag model) |
| Full-lock turn (35°, ramped 0.5s, entered at 40 km/h — see rollover note) | radius 3.65–3.76 m (Ackermann estimate ≈3.20 m) |
| Brake (80 N·s/wheel impulse, from 17.4 m/s) | stopped in 1.10 s / 12.29 m |
| **Rollover at full lock** | rolls above ~55 km/h (no roll ≤53.3 km/h, rolls ≥58.0 km/h) — see finding #1 |
| NaN / chassis-ground penetration | none, across all runs |
| Flip-recover, pose sweep (yaw-broken 12°, 2.2 m drop, 6 s) | **0/10 recover** — matches the plan's assumption that the self-right assist torque is load-bearing |
| Flip-recover, low-energy variant (no yaw-break, 1.0 m drop) | self-rights spontaneously at ~1.0 s — see finding #4 (methodology caveat on the nudge sub-test) |
| Detach `door_L` → debris | PASS (after a fix — see finding #2): mass 31.3 kg removed (1250→1218.8 kg), velocity+angular transfer, stays Dynamic, sleeps at 1.34 s, wakes on car contact at 0.40 s, dent morph 25/35 verts moved (0.097 m max) |
| Determinism | PASS: bit-identical SHA-256 across two independent runs (`d8bab1b9…`) |

## Asset problems found

1. **This car rolls over at full-lock steering above ~55 km/h.** Root cause, not a test-harness
   quirk (confirmed with both an instant steering snap and a 0.5 s ramped input — both roll at
   ~62.5 km/h): the `com` anchor is at y=0.85 m; with the 1.6 m track width that's a static
   stability factor of `1.6/(2×0.85) ≈ 0.94` — low even for an SUV (typical passenger cars are
   1.0–1.5). Combined with `frictionSlip=1000` (very high tire grip), the car can generate more
   lateral g than its rollover threshold before it would ever slide. Binary-searched the exact
   threshold: stable ≤53.3 km/h, rolls ≥58.0 km/h (`test_drive_v2.mjs`'s `runRolloverScan`). Not
   fixed here (no force multipliers used) — flagging for a lower CoM, wider track, or a capped
   lateral-grip/steer-rate model upstream.
2. **`col_door_L`'s box collider (closed pose) sits fully inside `col_chassis`'s convex-hull AABB.**
   Verified by AABB: door x∈[−1.029,−0.860] y∈[0.657,1.360] z∈[−0.610,−0.040] is entirely within
   chassis x∈[−1.055,1.055] y∈[0.48,1.40] z∈[−1.839,1.81]. Spawning the debris as a normal solid
   collider at the exact detach instant makes Rapier's contact solver depenetrate it immediately —
   measured a real "pop" (see `test_detach_v2.mjs`'s probe). Worked around here with a 20-step
   (~0.17 s) collision-group grace period (debris excludes the car's group briefly, still collides
   with ground, restored after). This is a real jj-sim detach-path requirement, not just a test
   artifact: any panel mounted flush against a convex-hull body needs either an outward nudge on
   detach or a matching grace period, or the convex hull needs a cavity for flush panels (impossible
   for a *convex* hull — so the grace-period/nudge approach is probably the right call for jj-sim too).
3. **`col_chassis`/`col_bumper_front`'s collider bottom sits well above the actual ground plane**
   even though the visual mesh and wheels reach y=0. Measured (this snapshot): `col_chassis` bottom
   = centerRel.y(0.96) − halfExtents.y(0.44) = **0.52 m**; `col_bumper_front` bottom = 0.80 − 0.32 =
   **0.48 m**. That's a ~0.5 m gap between the car's visible underbody and its own collision proxy —
   low objects, curbs, or a low ramming hit to the belly would pass clean through. The wake-contact
   sub-test in `test_detach_v2.mjs` had to deliberately aim below the "normal" ride height to make
   contact with door debris lying on the ground at all, which is itself evidence this gap is large
   enough to matter in real gameplay, not just at the AABB-rounding level.
4. **Flip-recovery is drop-energy-dependent, not a flat 0%.** The controlled pose sweep (yaw-broken
   12°, 2.2 m drop, 6 s) recovers 0/10, matching the C-physics spike's conclusion that a self-right
   assist torque is load-bearing. But a bare, non-yaw-broken 1.0 m upside-down drop self-rights on
   its own by ~1.0 s (front-biased CoM, `com.z=-0.05`, likely interacting with roof curvature),
   landing at the exact same resting height as a normal upright settle. This made the "nudge" sub-test
   (settle-upside-down-then-kick, same technique as C-physics/test_flip.mjs) meaningless at its 1.0 m
   spawn height — the car was already upright (upDot≈+1.0) before the kick in every case, so its
   "recovered instantly" results are an artifact, not evidence the kick caused anything. Re-run the
   nudge sub-test at the pose-sweep's 2.2 m/yaw-broken settle if that specific number is needed.
5. **FWD note (not a defect, just a contract-driven result you should know):** only `wheel_FL`/`FR`
   are driven per `sidecar.drive="FWD"`; total propulsive force here is honestly half of the
   C-physics spike's all-wheel-drive assumption at the same per-wheel force (4200 N), which is why
   the 3 s/62.5 km/h number is lower than that spike's 130 km/h at the same duration/force.

## Suspension derivation (no fudge factors)

Rapier's controller is Bullet's `btRaycastVehicle` model: `force = (stiffness·deflection −
damping·relVel) · chassisMass`, i.e. `stiffness`/`damping` are already per-unit-mass accelerations —
`stiffness` has units of rad²/s² (an angular natural frequency squared). Picked `f = 1.3 Hz`
(firmer than the C-physics spike's implicit 0.81 Hz, which sagged 0.18 m) →
`stiffness = (2π·1.3)² ≈ 66.6`. Damping = fraction of `2·√stiffness` (critical-damping reference):
compression ratio 0.4 (responsive to bumps), relaxation ratio 0.6 (damps rebound harder to avoid
bounce) — same qualitative shape as C-physics's 0.31/0.43, scaled up with the stiffness. Result: only
6.75 cm of sag vs the C-physics asset's 18 cm, at a stiffer, more arcade-appropriate feel. Wheel
connection point = hub + restLength straight up, verified against the sidecar's own `top_mount.y`
(0.96 m) exactly. Max suspension travel uses the larger of the sidecar's asymmetric ±[0.10, 0.12] m
travel (a real, small contract gap: the controller only takes one symmetric scalar).

## Files

`load_vehicle_v2.mjs`, `physics_common_v2.mjs`, `test_load.mjs`, `test_drive_v2.mjs`,
`test_detach_v2.mjs`, `test_flip_v2.mjs`, `test_determinism_v2.mjs`, `inspect_glb.mjs` (throwaway
node-hierarchy dump used while writing the loader), `out/*.json`. Reused `gltf-lite.mjs` from
`../../C-physics/` unmodified.

## Coordinator re-run after the CoM fix (2026-09-30)

The rollover finding above was an asset problem: the `com` anchor was authored at the visual body
height (0.85 m). It is now an arcade-low 0.60 m (just above the hubs), set in `build_cruze_v2.py`.
Re-running `test_drive_v2.mjs`: settle 0.51 s, 55.0 m / 62.5 km/h after 3 s, turn radius ~3.7 m,
braking 9.34 m (was 12.29 m), and the full-lock rollover scan shows **no roll at any tested speed up to 62.5 km/h**
(it previously rolled from 58 km/h). Findings 2 (detach grace window) and 4 (assist torque) are
jj-sim requirements, not asset changes. Finding 3 is expected: the only geometry at y=0 is the
tyres, because the body is lifted.
