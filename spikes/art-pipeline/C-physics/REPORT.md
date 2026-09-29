# Spike C — physics contract in Rapier (2026-09-29)

(Written by the Sonnet subagent; saved by the coordinator. Determinism and detach tests re-run and reproduced by
the coordinator.)

**Verdict: mostly GO**, with two findings that change the plan (flip recovery, contract mass/origin rules).

Engine: `@dimforge/rapier3d-compat` 0.19.3 (JS/WASM, embeds Rust rapier3d 0.30.1), headless Node, dt = 1/120,
`DynamicRayCastVehicleController`. The plan targets native rapier3d 0.36.0 — re-verify the API footguns there.

| Check | Result |
|---|---|
| Loader: colliders (`col_*` → hulls/cuboids), `com` → CoM, wheel hubs + radius → hardpoints, mass fractions | PASS |
| Settle | 1.04 s; ride height 0.54 m vs 0.72 m authored (soft, untuned suspension) |
| Full throttle 3 s | 114.6 m, ~130 km/h, still accelerating (no drag model yet) |
| Full-lock turn radius | 4.65–5.45 m (Ackermann estimate 4.0 m) |
| Brake | 5.2 m/s → 0 in 0.36 s / 0.72 m |
| NaN / ground penetration | none across all runs |
| Flip-recover (round vs box cabin) | **FAIL of the plan assumption**: 0/10 recover from rest either way; recovery is a pure kick-energy threshold (~5–8 rad/s), identical for both shapes |
| Detach `door_R` → debris | PASS: convex hull from render mesh, velocity + angular transfer, mass removed, stays Dynamic, sleeps at 1.27 s, wakes on car contact at 0.42 s; dent morph 305/1353 verts, 0.127 m |
| Determinism | PASS: bit-identical sha256 across two runs (same build) |

## Findings → plan / contract changes
1. **Rounded cabin alone doesn't self-right** at these proportions. The plan's gentle, visible self-right assist
   torque (§7.3) is load-bearing, not a backstop. Re-test with a genuinely rounded collider (see #2).
2. `col_cabin_round` in the asset is a plain box — the contract/builder must actually produce a rounded proxy
   (capsule/convex hull), and the validator should check it isn't a cuboid.
3. Sidecar mass fractions sum to 0.92, not 1.0 → validator rule: fractions sum to 1 (± tolerance).
4. Chassis root isn't at ground level (§12.4 says origin at ground between axles) → builder fix + validator rule.
5. Rapier-JS footguns (re-check in Rust): `updateVehicle()` doesn't wake a sleeping chassis; external
   forces/impulses on the vehicle body are fought by the controller's wheel-slip model (drag needs care);
   `wheelBrake` is an impulse per tick, not a force like `engineForce`; vector params must be `{x,y,z}` (arrays
   give silent NaN).
6. glTF morph targets are **sparse accessors** — a naive reader sees all-zero dents; loaders must handle sparse.
7. Suspension is untuned (ride height sag, no drag) — expected; tuning belongs to G-FEEL, not the contract.

Files: `gltf-lite.mjs`, `load_vehicle.mjs`, `physics_common.mjs`, `test_drive.mjs`, `test_flip.mjs`,
`test_detach.mjs`, `test_determinism.mjs`, `out/*.json`. Further numbered notes are inline as code comments.
