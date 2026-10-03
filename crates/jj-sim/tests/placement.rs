//! P1-S06 scenario bank: the placement service (plan §7.5; master §6.5, §10.9) on the greybox.
//! - Start grids of 1, 24, 40 and 99 cars place without overlap (corridors long enough for them).
//! - A 99-car grid on the greybox's 24-car corridor places everyone at once, the overflow under protection.
//! - A mid-race join lands ~3 s behind the last racer with its gate state, marked late; a stationary last racer still
//!   leaves a gap.
//! - A crowded tail (20 cars and debris within 30 m) still gives a controllable protected car within 3 s.
//! - Protection never ends overlapping. 0.1's spawn cap (16 authored spawns, modulo-wrapped) never returns.

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::placement::{DROP_IN_MIN_GAP_M, PROTECT_TICKS, Rect, overlaps};
use jj_sim::race::Respawned;
use jj_sim::{CarId, DriveInput, Journal, Sim, SpawnPose, TICK_HZ, VehicleProfile};

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
const S: u64 = TICK_HZ as u64;

/// The greybox, with its start corridor stretched to `length_m` when given.
fn greybox(length_m: Option<u32>) -> LoadedMap {
    let mut json: serde_json::Value = serde_json::from_str(GREYBOX).unwrap();
    if let Some(l) = length_m {
        json["route"]["start"]["length"] = (l * 1000).into();
    }
    load_json(json.to_string().as_bytes(), &Registry::generic())
        .unwrap_or_else(|r| panic!("{:?}", r.violations))
}

fn sim(map: &LoadedMap) -> Sim {
    Sim::new(
        map,
        &Registry::generic(),
        1,
        VehicleProfile::provisional_cruz(),
    )
}

fn steps(sim: &mut Sim, n: u64) {
    for _ in 0..n {
        sim.step();
    }
}

fn prints(sim: &Sim) -> Vec<Rect> {
    sim.cars().map(|c| sim.footprint(c).unwrap()).collect()
}

/// No two solid (unprotected) cars overlap, and no solid car overlaps debris.
fn assert_no_solid_overlap(sim: &Sim, when: &str) {
    let p = prints(sim);
    let debris = sim.debris_footprints();
    for i in 0..p.len() {
        if sim.is_protected(CarId(i as u32)) {
            continue;
        }
        for j in (i + 1)..p.len() {
            assert!(
                sim.is_protected(CarId(j as u32)) || !overlaps(&p[i], &p[j]),
                "{when}: solid cars {i} and {j} overlap"
            );
        }
        assert!(
            !debris.iter().any(|d| overlaps(&p[i], d)),
            "{when}: solid car {i} overlaps debris"
        );
    }
}

/// Protection never ends overlapping: every car that turned solid this tick overlaps no solid car and no debris.
fn assert_protection_ended_clear(sim: &Sim, was_protected: &[bool], when: &str) {
    let p = prints(sim);
    let debris = sim.debris_footprints();
    for (i, &was) in was_protected.iter().enumerate() {
        if !was || sim.is_protected(CarId(i as u32)) {
            continue;
        }
        for (j, q) in p.iter().enumerate() {
            assert!(
                j == i || sim.is_protected(CarId(j as u32)) || !overlaps(&p[i], q),
                "{when}: car {i} turned solid overlapping car {j}"
            );
        }
        assert!(
            !debris.iter().any(|d| overlaps(&p[i], d)),
            "{when}: car {i} turned solid overlapping debris"
        );
    }
}

fn protected_now(sim: &Sim) -> Vec<bool> {
    sim.cars().map(|c| sim.is_protected(c)).collect()
}

#[test]
fn start_grids_of_1_24_40_and_99_place_without_overlap() {
    // 3 columns, rows every 8 m from 4 m behind the line: 24 fit the greybox's 60 m, 40 need 108 m, 99 need 260 m.
    for (n, corridor) in [(1, None), (24, None), (40, Some(110)), (99, Some(264))] {
        let map = greybox(corridor);
        let mut s = sim(&map);
        let cars = s.spawn_grid(n);
        assert_eq!(cars.len(), n);
        let p = prints(&s);
        for i in 0..n {
            for j in (i + 1)..n {
                assert!(
                    !overlaps(&p[i], &p[j]),
                    "grid {n}: cars {i} and {j} overlap"
                );
            }
        }
        steps(&mut s, PROTECT_TICKS + S / 2);
        assert!(
            cars.iter().all(|&c| !s.is_protected(c)),
            "grid {n}: every car turned solid (nothing overlapped)"
        );
        assert_no_solid_overlap(&s, &format!("grid {n} settled"));
        assert!(
            cars.iter()
                .all(|&c| s.car_state(c).unwrap().wheels_in_contact == 4),
            "grid {n}: all on their wheels"
        );
    }
}

#[test]
fn a_99_car_grid_on_a_24_car_corridor_places_everyone_at_once_under_protection() {
    let map = greybox(None);
    let mut s = sim(&map);
    let cars = s.spawn_grid(99);
    // No cap, no queue: all 99 exist and are controllable from the first tick.
    assert_eq!((cars.len(), s.cars().count(), s.tick()), (99, 99, 0));
    let poses: Vec<SpawnPose> = (0..99).map(|k| s.grid_pose(k)).collect();
    for i in 0..99 {
        for j in (i + 1)..99 {
            assert!(
                (poses[i].x - poses[j].x).hypot(poses[i].z - poses[j].z) > 0.3,
                "poses {i} and {j} coincide"
            );
        }
    }
    for t in 0..(2 * S) {
        s.step();
        assert_no_solid_overlap(&s, &format!("tick {t}"));
    }
    // Protection persists only while something blocks the car: a solid car, a lower-id protected car, or debris.
    let p = prints(&s);
    for (i, &c) in cars.iter().enumerate() {
        if s.is_protected(c) {
            let blocked = p.iter().enumerate().any(|(j, q)| {
                j != i && (!s.is_protected(CarId(j as u32)) || j < i) && overlaps(&p[i], q)
            });
            assert!(blocked, "car {i} is still protected but nothing blocks it");
        }
    }
    let protected = cars.iter().filter(|&&c| s.is_protected(c)).count();
    assert!(
        protected >= 60,
        "most of the overflow overlaps the corridor's cars and stays protected: {protected}"
    );
    assert!(
        cars[..24].iter().all(|&c| !s.is_protected(c)),
        "the corridor's 24 turned solid"
    );
    // The front 24 drive off: the first overflow layer clears and turns solid, never overlapping a solid car.
    for t in 0..(6 * S) {
        let before = protected_now(&s);
        for &c in &cars[..24] {
            s.set_input(
                c,
                DriveInput {
                    throttle: 30_000,
                    steer: 0,
                    brake: 0,
                },
            );
        }
        s.step();
        assert_protection_ended_clear(&s, &before, &format!("driving off, tick {t}"));
    }
    let still = cars.iter().filter(|&&c| s.is_protected(c)).count();
    assert!(
        still < protected,
        "cars turn solid as the corridor clears ({protected} → {still})"
    );
}

/// Drives `car` through the finish line (the start) from 4 m before it at 12 m/s.
fn through_start_line(s: &mut Sim, map: &LoadedMap, car: CarId) {
    let at = s.race().course.gate_route_point(0);
    let p = &map.map.route.points[at];
    s.place_car(
        car,
        SpawnPose {
            x: p.x as f32 / 1000.0 - 4.0,
            y: 0.85,
            z: p.z as f32 / 1000.0,
            heading: std::f32::consts::FRAC_PI_2,
        },
        0.0,
        [12.0, 0.0, 0.0],
    );
    steps(s, S / 2);
}

#[test]
fn a_mid_race_join_lands_about_3_s_behind_the_last_racer_with_its_gate_state() {
    let map = greybox(None);
    let mut s = sim(&map);
    let cars = s.spawn_grid(3);
    s.start_race(3);
    steps(&mut s, S);
    // Three racers down the main straight at different paces; car 2 is last.
    for &c in &cars {
        through_start_line(&mut s, &map, c);
    }
    let mut last_progress = Vec::new();
    for _ in 0..(6 * S) {
        for (i, &c) in cars.iter().enumerate() {
            s.set_input(
                c,
                DriveInput {
                    throttle: [30_000, 24_000, 16_000][i],
                    steer: 0,
                    brake: 0,
                },
            );
        }
        s.step();
        last_progress.push((s.tick(), s.race().progress_m(2)));
    }
    assert_eq!(s.race().last_racer(), Some(2));
    let now = s.race().progress_m(2);
    let three_s_ago = last_progress
        .iter()
        .rev()
        .find(|(t, _)| *t <= s.tick() - 3 * S)
        .unwrap()
        .1;
    let joined = s.drop_in();
    let rc = s.race().car(joined.0).unwrap().clone();
    let landed = s.race().progress_m(joined.0);
    assert!(rc.late, "marked as a late joiner");
    assert!(
        (rc.best_progress_mm as f32 / 1000.0 - three_s_ago).abs() < 1.0,
        "targets where the last racer was 3 s ago"
    );
    assert!(
        now - landed >= DROP_IN_MIN_GAP_M - 0.5,
        "behind the last racer: {landed} vs {now}"
    );
    assert_eq!(
        rc.gates_passed,
        s.race()
            .gates_for_progress(rc.best_progress_mm as f32 / 1000.0),
        "the gate state there"
    );
    assert!(rc.gates_passed >= 1);
    assert!(
        s.is_protected(joined) && !s.race().is_held(joined.0, s.tick()),
        "protected and immediately controllable"
    );
    let start = s.car_state(joined).unwrap().position;
    for _ in 0..(2 * S) {
        s.set_input(
            joined,
            DriveInput {
                throttle: 30_000,
                steer: 0,
                brake: 0,
            },
        );
        s.step();
    }
    let end = s.car_state(joined).unwrap().position;
    assert!(
        (end[0] - start[0]).hypot(end[2] - start[2]) > 3.0,
        "it drives"
    );

    // A stationary last racer still leaves a positive gap.
    for _ in 0..(5 * S) {
        for &c in &cars {
            s.set_input(
                c,
                DriveInput {
                    throttle: 0,
                    steer: 0,
                    brake: 32_767,
                },
            );
        }
        s.set_input(
            joined,
            DriveInput {
                throttle: 0,
                steer: 0,
                brake: 32_767,
            },
        );
        s.step();
    }
    let last = s.race().last_racer().unwrap();
    let again = s.drop_in();
    let gap =
        s.race().progress_m(last) - s.race().car(again.0).unwrap().best_progress_mm as f32 / 1000.0;
    assert!(
        gap >= DROP_IN_MIN_GAP_M - 0.01,
        "gap {gap} behind a stopped last racer"
    );
}

#[test]
fn a_crowded_tail_still_yields_a_controllable_protected_car_within_3_s() {
    let map = greybox(None);
    let mut s = sim(&map);
    let cars = s.spawn_grid(20);
    s.start_race(3);
    steps(&mut s, S);
    for &c in &cars {
        through_start_line(&mut s, &map, c);
    }
    // Park all 20 in a block on the main straight (x 115–145), the tail of the field, and throw debris in the gaps
    // within 30 m behind them.
    for (k, &c) in cars.iter().enumerate() {
        let (row, col) = ((k / 3) as f32, (k % 3) as f32 - 1.0);
        s.place_car(
            c,
            SpawnPose {
                x: 145.0 - row * 5.0,
                y: 0.85,
                z: col * 3.0,
                heading: std::f32::consts::FRAC_PI_2,
            },
            0.0,
            [0.0; 3],
        );
    }
    for k in 0..8 {
        let x = 112.0 - k as f32 * 3.5;
        s.spawn_debris(
            SpawnPose {
                x,
                y: 0.5,
                z: if k % 2 == 0 { -1.5 } else { 1.5 },
                heading: 0.3 * k as f32,
            },
            [0.6, 0.3, 0.8],
        );
    }
    steps(&mut s, 4 * S);
    let joined = s.drop_in();
    let at = s.tick();
    assert!(s.is_protected(joined), "protected from its first tick");
    let start = s.car_state(joined).unwrap().position;
    let mut moved_by = None;
    for _ in 0..(3 * S) {
        let before = protected_now(&s);
        s.set_input(
            joined,
            DriveInput {
                throttle: 30_000,
                steer: 0,
                brake: 0,
            },
        );
        s.step();
        assert_protection_ended_clear(&s, &before, "crowded tail");
        let p = s.car_state(joined).unwrap().position;
        if moved_by.is_none() && (p[0] - start[0]).hypot(p[2] - start[2]) > 2.0 {
            moved_by = Some(s.tick() - at);
        }
    }
    assert!(
        moved_by.is_some_and(|t| t <= 3 * S),
        "controllable within 3 s (moved 2 m after {moved_by:?} ticks)"
    );
}

#[test]
fn the_0_1_spawn_cap_never_returns() {
    // 0.1 (tests/unit/spawn-cap-regression.test.js): 16 authored spawns, modulo-wrapped, so player 17 got player 1's
    // spawn and later players were silently refused. Any N gets N distinct poses and N cars.
    let map = greybox(None);
    let mut s = sim(&map);
    let poses: Vec<SpawnPose> = (0..1000).map(|k| s.grid_pose(k)).collect();
    for (k, p) in poses.iter().enumerate().skip(1) {
        let d = (p.x - poses[0].x).hypot(p.z - poses[0].z);
        assert!(d > 1.0, "pose {k} reuses player 1's spawn ({d} m away)");
    }
    for i in 0..200 {
        for j in (i + 1)..200 {
            assert!(
                (poses[i].x - poses[j].x).hypot(poses[i].z - poses[j].z) > 0.3,
                "poses {i} and {j} coincide"
            );
        }
    }
    let cars = s.spawn_grid(200);
    assert_eq!(cars.len(), 200);
    assert_eq!(cars.last(), Some(&CarId(199)));
    steps(&mut s, 2);
    assert_eq!(s.cars().count(), 200, "nobody dropped");
}

#[test]
fn respawns_go_through_the_placement_service() {
    let map = greybox(None);
    let mut s = sim(&map);
    let cars = s.spawn_grid(2);
    steps(&mut s, 2 * S);
    // Park car 1 exactly on car 0's anchor (its grid slot), then throw car 0 out of bounds.
    let anchor = s.race().car(0).unwrap().anchor;
    s.place_car(cars[1], anchor, 0.0, [0.0; 3]);
    steps(&mut s, S);
    s.place_car(
        cars[0],
        SpawnPose {
            x: 400.0,
            y: 3.0,
            z: 0.0,
            heading: 0.0,
        },
        0.0,
        [0.0; 3],
    );
    steps(&mut s, 3);
    assert_eq!(
        s.race()
            .events()
            .iter()
            .filter(|(_, e)| matches!(
                e,
                jj_sim::race::Event::Respawned {
                    why: Respawned::OutOfBounds,
                    ..
                }
            ))
            .count(),
        1
    );
    assert!(
        s.is_protected(cars[0]),
        "a respawn comes with spawn protection"
    );
    let (a, b) = (s.footprint(cars[0]).unwrap(), s.footprint(cars[1]).unwrap());
    assert!(
        !overlaps(&a, &b),
        "it took a clear pose near its anchor, not the occupied one"
    );
    steps(&mut s, 3 * S);
    assert!(!s.is_protected(cars[0]));
    assert_no_solid_overlap(&s, "after the respawn");
}

#[test]
fn drop_ins_and_debris_replay_to_the_same_hash() {
    let map = greybox(None);
    let mut live = sim(&map);
    let cars = live.spawn_grid(4);
    live.start_race(3);
    for t in 0..(9 * S) {
        for (i, &c) in cars.iter().enumerate() {
            live.set_input(
                c,
                DriveInput {
                    throttle: 12_000 + 4_000 * i as i16,
                    steer: 0,
                    brake: 0,
                },
            );
        }
        if t == 300 {
            live.spawn_debris(
                SpawnPose {
                    x: 80.0,
                    y: 1.0,
                    z: 2.0,
                    heading: 0.0,
                },
                [0.5, 0.3, 0.5],
            );
        }
        if t == 700 || t == 900 {
            live.drop_in();
        }
        live.step();
    }
    let journal = Journal::from_bytes(&live.journal().to_bytes()).unwrap();
    let replay = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::provisional_cruz(),
        &journal,
        live.tick(),
    );
    assert_eq!(replay.cars().count(), 6);
    assert_eq!(replay.state_hash(), live.state_hash());
}
