//! P1-S05 scenario bank: race rules and recovery on the greybox (plan §7.4–§7.5).
//! - Out of bounds always recovers (0.1's oob-recovery spec, re-expressed).
//! - A flip from 12 inverted poses rights itself or is wrecked within 4 s of coming to rest.
//! - A shortcut across the infield doesn't count progress.
//! - The first finisher opens the 30 s window; an all-stuck race ends at `max(180 s, 2 × laps × refLap)`.
//! - Finished cars are ghosts to racers; Recover's rules and 2 s hold; races replay from the journal.

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::race::{Event, FLIP_REST_TICKS, RESPAWN_HOLD_TICKS, RaceEnd, Respawned};
use jj_sim::{CarId, DriveInput, Journal, Sim, SpawnPose, TICK_HZ, VehicleProfile, route_spawn};

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
const S: u64 = TICK_HZ as u64;

fn greybox() -> LoadedMap {
    load_json(GREYBOX.as_bytes(), &Registry::generic()).expect("the greybox validates")
}

fn sim(map: &LoadedMap, seed: u64) -> Sim {
    Sim::new(map, &Registry::generic(), seed, VehicleProfile::cruz())
}

fn steps(sim: &mut Sim, n: u64) {
    for _ in 0..n {
        sim.step();
    }
}

fn upright_on_wheels(sim: &Sim, car: CarId) -> bool {
    let s = sim.car_state(car).unwrap();
    s.up_y > 0.95 && s.wheels_in_contact == 4
}

fn respawns(sim: &Sim, car: u32, why: Respawned) -> usize {
    sim.race()
        .events()
        .iter()
        .filter(|(_, e)| matches!(e, Event::Respawned { car: c, why: w } if *c == car && *w == why))
        .count()
}

/// Gate `i` (race order, 0 = finish) as (x, z, unit tangent x, z).
fn gate(map: &LoadedMap, sim: &Sim, i: usize) -> (f32, f32, f32, f32) {
    let pts = &map.map.route.points;
    let at = sim.race().course.gate_route_point(i);
    let n = pts.len();
    let (a, b) = (&pts[(at + n - 1) % n], &pts[(at + 1) % n]);
    let (dx, dz) = ((b.x - a.x) as f32, (b.z - a.z) as f32);
    let len = dx.hypot(dz);
    (
        pts[at].x as f32 / 1000.0,
        pts[at].z as f32 / 1000.0,
        dx / len,
        dz / len,
    )
}

/// Drives `car` through gate `i`: placed 4 m before it, rolling forward at 12 m/s, for half a second.
fn drive_through(map: &LoadedMap, sim: &mut Sim, car: CarId, i: usize) {
    let (x, z, tx, tz) = gate(map, sim, i);
    let pose = SpawnPose {
        x: x - 4.0 * tx,
        y: 0.85,
        z: z - 4.0 * tz,
        heading: tx.atan2(tz),
    };
    sim.place_car(car, pose, 0.0, [12.0 * tx, 0.0, 12.0 * tz]);
    steps(sim, S / 2);
}

#[test]
fn out_of_bounds_always_recovers() {
    let map = greybox();
    let mut s = sim(&map, 1);
    let car = s.spawn_car(route_spawn(&map, 30, 0.0, 0.6));
    s.start_race(3);
    steps(&mut s, S);
    // Past the start line first, so the anchor is a gate: the finish line at route point 40.
    drive_through(&map, &mut s, car, 0);
    assert_eq!(s.race().car(0).unwrap().gates_passed, 1);
    let b = &map.map.header.bounds;
    let (x0, z0, x1, z1) = (
        b.min_x as f32 / 1000.0,
        b.min_z as f32 / 1000.0,
        b.max_x as f32 / 1000.0,
        b.max_z as f32 / 1000.0,
    );
    // Far past each edge, high in the air, below the kill plane inside the bounds, and flung off at speed: every one
    // respawns at the anchor, upright and on its wheels, never frozen off the map.
    let throws = [
        (
            SpawnPose {
                x: x1 + 50.0,
                y: 3.0,
                z: 0.0,
                heading: 0.0,
            },
            [0.0; 3],
        ),
        (
            SpawnPose {
                x: x0 - 50.0,
                y: 3.0,
                z: 10.0,
                heading: 0.0,
            },
            [0.0; 3],
        ),
        (
            SpawnPose {
                x: 100.0,
                y: 3.0,
                z: z1 + 20.0,
                heading: 0.0,
            },
            [0.0; 3],
        ),
        (
            SpawnPose {
                x: 100.0,
                y: 3.0,
                z: z0 - 20.0,
                heading: 0.0,
            },
            [0.0; 3],
        ),
        (
            SpawnPose {
                x: 60.0,
                y: -30.0,
                z: 20.0,
                heading: 0.0,
            },
            [0.0; 3],
        ),
        (
            SpawnPose {
                x: x1 - 5.0,
                y: 1.0,
                z: 20.0,
                heading: 1.57,
            },
            [40.0, 0.0, 0.0],
        ),
    ];
    for (k, (pose, v)) in throws.into_iter().enumerate() {
        s.place_car(car, pose, 0.0, v);
        steps(&mut s, 5 * S);
        assert_eq!(
            respawns(&s, 0, Respawned::OutOfBounds),
            k + 1,
            "throw {k} wasn't recovered"
        );
        let st = s.car_state(car).unwrap();
        assert!(
            !s.race().course.out_of_bounds(st.position),
            "throw {k}: still out of bounds at {:?}",
            st.position
        );
        assert!(
            upright_on_wheels(&s, car),
            "throw {k}: not upright on its wheels: {st:?}"
        );
        let anchor = s.race().car(0).unwrap().anchor;
        assert!(
            (st.position[0] - anchor.x).hypot(st.position[2] - anchor.z) < 1.0,
            "throw {k}: not at the anchor"
        );
    }
    assert_eq!(
        s.race().car(0).unwrap().gates_passed,
        1,
        "recovery never adds progress"
    );
}

#[test]
fn a_flip_from_12_inverted_poses_rights_itself_or_is_wrecked_within_4_s_of_rest() {
    let map = greybox();
    let base = route_spawn(&map, 20, 0.0, 1.4);
    let poses: [(f32, f32); 12] = [
        (180.0, 0.0),
        (170.0, 0.0),
        (-170.0, 0.0),
        (150.0, 0.0),
        (-150.0, 0.0),
        (135.0, 0.0),
        (-135.0, 0.0),
        (90.0, 0.0),
        (-90.0, 0.0),
        (180.0, 90.0),
        (180.0, 45.0),
        (120.0, -30.0),
    ];
    let mut righted_by_assist = 0;
    for (roll, yaw) in poses {
        let mut s = sim(&map, 2);
        let car = s.spawn_car(base);
        s.place_car(
            car,
            SpawnPose {
                heading: base.heading + yaw.to_radians(),
                ..base
            },
            roll.to_radians(),
            [0.0; 3],
        );
        steps(&mut s, 10 * S);
        let ev = s.race().events();
        let assist = ev
            .iter()
            .find_map(|(t, e)| matches!(e, Event::AssistStarted { .. }).then_some(*t));
        match assist {
            None => {
                // It fell back onto its wheels by itself.
                assert!(
                    upright_on_wheels(&s, car),
                    "roll {roll} yaw {yaw}: no assist and not upright"
                );
            }
            Some(started) => {
                let rest = started + 1 - FLIP_REST_TICKS;
                let resolved = ev
                    .iter()
                    .find_map(|(t, e)| {
                        matches!(
                            e,
                            Event::Righted { .. }
                                | Event::Respawned {
                                    why: Respawned::FlipWreck,
                                    ..
                                }
                        )
                        .then_some((*t, *e))
                    })
                    .unwrap_or_else(|| panic!("roll {roll} yaw {yaw}: the assist never resolved"));
                assert!(
                    resolved.0 - rest <= 4 * S,
                    "roll {roll} yaw {yaw}: resolved {} ticks after rest",
                    resolved.0 - rest
                );
                if matches!(resolved.1, Event::Righted { .. }) {
                    righted_by_assist += 1;
                }
                assert!(
                    upright_on_wheels(&s, car),
                    "roll {roll} yaw {yaw}: not upright at the end"
                );
            }
        }
    }
    assert!(
        righted_by_assist >= 6,
        "the assist should right most inverted cars, righted {righted_by_assist}"
    );
}

#[test]
fn a_shortcut_across_the_infield_doesnt_count_progress() {
    let map = greybox();
    let mut s = sim(&map, 3);
    let car = s.spawn_car(route_spawn(&map, 30, 0.0, 0.6));
    s.start_race(3);
    steps(&mut s, S);
    drive_through(&map, &mut s, car, 0);
    let before = s.race().progress_m(0);
    // From x = 110 on the main straight, straight up the infield (+z), across the back straight at z = 30 between later
    // gates, and on towards the top of the map.
    s.place_car(
        car,
        SpawnPose {
            x: 110.0,
            y: 0.85,
            z: 3.0,
            heading: 0.0,
        },
        0.0,
        [0.0, 0.0, 14.0],
    );
    for _ in 0..(5 * S) {
        s.set_input(
            car,
            DriveInput {
                throttle: 26_000,
                steer: 0,
                brake: 0,
            },
        );
        s.step();
    }
    let st = s.car_state(car).unwrap();
    assert!(
        st.position[2] > 40.0,
        "the car really crossed the infield and the back straight: {:?}",
        st.position
    );
    let c = s.race().car(0).unwrap();
    assert_eq!(c.gates_passed, 1, "no gate after the start line counts");
    let legal = s.race().progress_m(0);
    let (gx, ..) = gate(&map, &s, 1);
    assert!(
        legal <= before.max(0.0) + (gx - 100.0) + 0.01,
        "legal progress {legal} stays inside the first stretch"
    );
    // A nearest-point projection would have credited the back straight, about 100 m further round.
    assert!(legal < 45.0, "legal progress {legal}");
}

#[test]
fn the_first_finisher_opens_the_30_s_window() {
    let map = greybox();
    let mut s = sim(&map, 4);
    let a = s.spawn_car(route_spawn(&map, 30, -3.0, 0.6));
    let b = s.spawn_car(route_spawn(&map, 30, 3.0, 0.6));
    s.start_race(1);
    steps(&mut s, S);
    let n = s.race().course.gate_count();
    for i in 0..=n {
        drive_through(&map, &mut s, a, i % n);
    }
    let finished = s
        .race()
        .car(0)
        .unwrap()
        .finished_at
        .expect("car A finished its lap");
    assert_eq!(s.race().first_finish, Some(finished));
    assert!(s.is_ghost(a) && !s.is_ghost(b));
    assert_eq!(s.race().over, None, "B is still racing");
    while s.race().over.is_none() {
        s.step();
    }
    assert_eq!(s.race().over, Some((finished + 30 * S, RaceEnd::Window)));
    let standings = s.race().standings();
    assert_eq!(
        standings.iter().map(|r| r.car).collect::<Vec<_>>(),
        vec![0, 1]
    );
    assert_eq!(standings[0].laps, 1);
}

#[test]
fn an_all_stuck_race_ends_at_the_deadline() {
    let map = greybox();
    let ref_lap_s = u64::from(map.map.header.ref_lap_ms) / 1000;
    for laps in [3, 1] {
        let mut s = sim(&map, 5);
        let cars = [
            s.spawn_car(route_spawn(&map, 30, -3.0, 0.6)),
            s.spawn_car(route_spawn(&map, 30, 3.0, 0.6)),
        ];
        steps(&mut s, 2 * S);
        let start = s.tick();
        s.start_race(laps);
        let expect = start + 180.max(2 * u64::from(laps) * ref_lap_s) * S;
        assert_eq!(s.race().deadline(), Some(expect));
        while s.race().over.is_none() {
            s.step();
        }
        assert_eq!(
            s.race().over,
            Some((expect, RaceEnd::Deadline)),
            "laps {laps}"
        );
        assert!(cars.iter().all(|&c| !s.race().is_finished(c.0)));
    }
}

#[test]
fn finished_cars_are_ghosts_to_racers() {
    let map = greybox();
    let mut s = sim(&map, 6);
    let a = s.spawn_car(route_spawn(&map, 30, 0.0, 0.6));
    let b = s.spawn_car(route_spawn(&map, 10, 0.0, 0.6));
    s.start_race(1);
    steps(&mut s, S);
    let n = s.race().course.gate_count();
    for i in 0..=n {
        drive_through(&map, &mut s, a, i % n);
    }
    assert!(s.is_ghost(a));
    // Park the ghost, then drop the racer straight onto it: B falls through A to the road.
    let park = route_spawn(&map, 20, 0.0, 0.6);
    s.place_car(a, park, 0.0, [0.0; 3]);
    steps(&mut s, S);
    s.place_car(
        b,
        SpawnPose {
            y: park.y + 2.5,
            ..park
        },
        0.0,
        [0.0; 3],
    );
    steps(&mut s, 2 * S);
    let (ya, yb) = (
        s.car_state(a).unwrap().position[1],
        s.car_state(b).unwrap().position[1],
    );
    assert!(
        (ya - yb).abs() < 0.1,
        "B sits on the road through the ghost (A y {ya}, B y {yb})"
    );
}

#[test]
fn recover_needs_a_slow_or_inverted_car_and_holds_it_for_2_s() {
    let map = greybox();
    let mut s = sim(&map, 7);
    let car = s.spawn_car(route_spawn(&map, 20, 0.0, 0.6));
    steps(&mut s, 2 * S);
    // Moving fast: refused.
    s.place_car(car, route_spawn(&map, 20, 0.0, 0.4), 0.0, [15.0, 0.0, 0.0]);
    s.step();
    assert!(!s.recover(car));
    // Braked to a stop (released once stopped, since a held brake reverses) and stopped for over a second: accepted,
    // respawned at the anchor and held.
    for _ in 0..(3 * S) {
        let rolling = s.car_state(car).unwrap().forward_speed > 0.3;
        s.set_input(
            car,
            DriveInput {
                throttle: 0,
                steer: 0,
                brake: if rolling { 32_767 } else { 0 },
            },
        );
        s.step();
    }
    s.set_input(car, DriveInput::default());
    steps(&mut s, 3 * S / 2);
    assert!(s.car_state(car).unwrap().linvel[0].abs() < 0.5, "stopped");
    assert!(s.recover(car));
    let at = s.tick();
    for _ in 0..RESPAWN_HOLD_TICKS {
        s.set_input(
            car,
            DriveInput {
                throttle: 32_767,
                steer: 0,
                brake: 0,
            },
        );
        assert!(s.race().is_held(0, s.tick()));
        s.step();
    }
    assert!(
        s.car_state(car).unwrap().linvel[0].abs() < 0.5,
        "no controls during the 2 s hold"
    );
    assert!(!s.race().is_held(0, at + RESPAWN_HOLD_TICKS));
    assert!(
        !s.recover(car),
        "not again straight away (it's moving under throttle)"
    );
    // Inverted (on its roof): accepted at once. (On its side the Cruz's round flanks roll it back onto its wheels.)
    s.place_car(
        car,
        route_spawn(&map, 60, 0.0, 1.7),
        std::f32::consts::PI,
        [0.0; 3],
    );
    steps(&mut s, S / 2);
    assert!(s.recover(car));
    assert_eq!(s.race().car(0).unwrap().recoveries, 2);
}

#[test]
fn a_race_with_commands_replays_to_the_same_hash() {
    let map = greybox();
    let mut live = sim(&map, 8);
    let a = live.spawn_car(route_spawn(&map, 30, -3.0, 0.6));
    live.spawn_car(route_spawn(&map, 30, 3.0, 0.6));
    live.start_race(2);
    for t in 0..(12 * S) {
        live.set_input(
            a,
            DriveInput {
                throttle: if t < 600 { 30_000 } else { 0 },
                steer: 0,
                brake: 0,
            },
        );
        if t == 700 {
            live.place_car(a, route_spawn(&map, 60, 0.0, 1.3), 3.1, [0.0; 3]);
        }
        if t == 1100 {
            live.recover(a);
        }
        live.step();
    }
    let journal = Journal::from_bytes(&live.journal().to_bytes()).unwrap();
    let replay = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        &journal,
        live.tick(),
    );
    assert_eq!(replay.state_hash(), live.state_hash());
    assert_eq!(replay.race().events(), live.race().events());
}

#[test]
fn finishes_carry_a_crossing_fraction_and_progress_keeps_its_high_water_mark() {
    let map = greybox();
    let mut s = sim(&map, 9);
    let a = s.spawn_car(route_spawn(&map, 30, -3.0, 0.6));
    let b = s.spawn_car(route_spawn(&map, 30, 3.0, 0.6));
    s.start_race(1);
    steps(&mut s, S);
    let n = s.race().course.gate_count();
    for i in 0..=n {
        drive_through(&map, &mut s, a, i % n);
    }
    let ca = s.race().car(a.0).unwrap();
    assert!(ca.finished_at.is_some());
    // 12 m/s is 0.1 m per tick: the line falls somewhere inside the finishing step.
    assert!(ca.finish_fraction > 0, "fraction {}", ca.finish_fraction);
    // B crosses the start line, drives on, then reverses: its high-water mark is the furthest it got, and when.
    drive_through(&map, &mut s, b, 0);
    let (mut max_mm, mut max_tick) = (0u64, 0u64);
    for t in 0..(4 * S) {
        let throttle = if t < S { 30_000 } else { -30_000 };
        s.set_input(
            b,
            DriveInput {
                throttle,
                steer: 0,
                brake: 0,
            },
        );
        s.step();
        let mm = (s.race().progress_m(b.0) * 1000.0) as u64;
        if mm > max_mm {
            (max_mm, max_tick) = (mm, s.tick());
        }
    }
    let cb = s.race().car(b.0).unwrap();
    assert_eq!(
        (cb.best_progress_mm, cb.best_progress_tick),
        (max_mm, max_tick),
        "the high-water mark and its tick"
    );
    assert!(
        (s.race().progress_m(b.0) * 1000.0) < max_mm as f32 - 1000.0,
        "current progress fell back well behind it"
    );
    assert_eq!(
        s.race()
            .standings()
            .iter()
            .map(|r| r.car)
            .collect::<Vec<_>>(),
        vec![0, 1]
    );
}
