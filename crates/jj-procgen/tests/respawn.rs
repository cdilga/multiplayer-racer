//! R125 respawn placement (br-ilne) on generated maps (every biome, their jumps, crests, dips and whoops): every gate's
//! anchor sits in a recovery span (the map leaves jump flights and landings out of them) with at least
//! `ANCHOR_CLEAR_M` of span ahead, on the road's centre, facing along the route; a respawn holds the car there for
//! `RESPAWN_HOLD_TICKS`, then it rolls off at `RESPAWN_ROLL_FRACTION` of the autopilot's planned speed, ghosted
//! (spawn protection) for the protection window; two cars respawning at once never overlap.
#![cfg(not(target_arch = "wasm32"))]

use jj_map::{LoadedMap, canonical_bytes, load_canonical};
use jj_procgen::generate;
use jj_sim::race::{ANCHOR_CLEAR_M, RESPAWN_HOLD_TICKS, RESPAWN_ROLL_FRACTION};
use jj_sim::{CarId, Sim, TICK_HZ, VehicleProfile};

const S: u64 = TICK_HZ as u64;

fn loaded(seed: u64) -> LoadedMap {
    load_canonical(&canonical_bytes(&generate(seed)), &jj_procgen::registry())
        .expect("generated maps load")
}

fn in_recovery(map: &LoadedMap, i: usize) -> bool {
    map.map.route.recovery.iter().any(|sp| {
        let (a, b) = (sp.from as usize, sp.to as usize);
        if a <= b {
            a <= i && i <= b
        } else {
            i >= a || i <= b
        }
    })
}

fn nearest(map: &LoadedMap, x: f32, z: f32) -> usize {
    let pts = &map.map.route.points;
    (0..pts.len())
        .min_by(|&a, &b| {
            let d = |i: usize| (pts[i].x as f32 / 1000.0 - x).hypot(pts[i].z as f32 / 1000.0 - z);
            d(a).total_cmp(&d(b))
        })
        .unwrap()
}

#[test]
fn every_anchor_is_on_the_road_before_any_hazard_and_faces_along_it() {
    for seed in 1..=8u64 {
        let map = loaded(seed);
        let sim = Sim::new(&map, &jj_procgen::registry(), seed, VehicleProfile::cruz());
        let course = &sim.race().course;
        let pts = &map.map.route.points;
        let n = pts.len();
        let has_jump = map
            .map
            .features
            .iter()
            .any(|f| matches!(f.kind, jj_map::FeatureKind::Jump));
        for g in 0..course.gate_count() {
            let a = course.anchor(g);
            let i = nearest(&map, a.x, a.z);
            let at = |k: usize| (pts[k].x as f32 / 1000.0, pts[k].z as f32 / 1000.0);
            let off = (at(i).0 - a.x).hypot(at(i).1 - a.z);
            assert!(
                off < 1.5,
                "seed {seed} gate {g}: the anchor is {off:.2} m off the centreline"
            );
            // Facing along the route: the tangent from the anchor's point to the next (as `route_spawn` takes it).
            let (p, q) = (at(i), at((i + 1) % n));
            let tangent = (q.0 - p.0).atan2(q.1 - p.1);
            let diff = ((a.heading - tangent + std::f32::consts::PI)
                .rem_euclid(std::f32::consts::TAU)
                - std::f32::consts::PI)
                .abs()
                .to_degrees();
            assert!(
                diff < 5.0,
                "seed {seed} gate {g}: heading {diff:.1} degrees off the road"
            );
            // In a recovery span with ANCHOR_CLEAR_M of span ahead.
            let (mut j, mut d) = (i, 0.0f32);
            while d < ANCHOR_CLEAR_M - 2.5 {
                assert!(
                    in_recovery(&map, j),
                    "seed {seed} gate {g}: within {d:.1} m ahead of the anchor (point {j}) isn't recoverable{}",
                    if has_jump { " (a jump)" } else { "" }
                );
                let k = (j + 1) % n;
                d += (at(k).0 - at(j).0).hypot(at(k).1 - at(j).1);
                j = k;
            }
            // And the gate's own point is at or ahead of it (an anchor never moves forward past its gate).
            let gp = course.gate_route_point(g);
            let back = (gp + n - i) % n;
            assert!(
                back < n / 2,
                "seed {seed} gate {g}: the anchor is ahead of its gate"
            );
        }
    }
}

#[test]
fn a_respawn_holds_then_rolls_off_and_two_at_once_never_overlap() {
    for seed in [1u64, 4, 7] {
        let map = loaded(seed);
        let mut sim = Sim::new(&map, &jj_procgen::registry(), seed, VehicleProfile::cruz());
        let cars = sim.spawn_grid(2);
        sim.start_race(3);
        // Hold both still past the start hold, then throw both out of bounds on the same tick.
        for _ in 0..(5 * S) {
            sim.step();
        }
        let b = map.map.header.bounds;
        for &c in &cars {
            let pose = jj_sim::SpawnPose {
                x: b.max_x as f32 / 1000.0 + 50.0,
                y: 5.0,
                z: 0.0,
                heading: 0.0,
            };
            sim.place_car(c, pose, 0.0, [0.0, 0.0, 0.0]);
        }
        let mut t = 0;
        while cars
            .iter()
            .any(|&c| sim.race().car(c.0).unwrap().wrecks == 0)
            && t < 3 * S
        {
            sim.step();
            t += 1;
        }
        let respawned_at = sim.tick();
        // Held at the anchor, not overlapping each other.
        for _ in 0..RESPAWN_HOLD_TICKS / 2 {
            sim.step();
        }
        let (a, b2) = (
            sim.car_state(cars[0]).unwrap(),
            sim.car_state(cars[1]).unwrap(),
        );
        let gap = (a.position[0] - b2.position[0]).hypot(a.position[2] - b2.position[2]);
        assert!(
            gap > 2.5, // a car is about 1.8 m wide: the placement puts the second a lane over or further on
            "seed {seed}: two cars respawned {gap:.2} m apart (overlapping)"
        );
        for st in [&a, &b2] {
            assert!(
                st.up_y > 0.95 && st.forward_speed.abs() < 0.5,
                "seed {seed}: held upright at rest: {st:?}"
            );
        }
        // Then they roll off at about the planned fraction, ghosted (protected) for the window.
        while sim.tick() < respawned_at + RESPAWN_HOLD_TICKS + 2 {
            sim.step();
        }
        for &c in &cars {
            let st = sim.car_state(c).unwrap();
            let (lo, hi) = (
                RESPAWN_ROLL_FRACTION * jj_sim::autopilot::MIN_SPEED * 0.8,
                RESPAWN_ROLL_FRACTION * jj_sim::autopilot::MAX_SPEED + 1.0,
            );
            assert!(
                (lo..=hi).contains(&st.forward_speed),
                "seed {seed} car {}: rolling off ({:.1} m/s)",
                c.0,
                st.forward_speed
            );
            assert!(
                sim.is_protected(CarId(c.0)),
                "seed {seed}: ghosted as it rolls off"
            );
        }
    }
}
