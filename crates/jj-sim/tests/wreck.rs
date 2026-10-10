//! P1-S04c (plan §6.3, §7.3a): wrecks, husks and respawn.
//!
//! - a lost wheel (after its R121 grace), a stuck flip and an out-of-bounds fall each wreck the car: every part still on it pops off as
//!   debris, its chassis stays where it was as a husk (a dynamic body), and the player is back at their own anchor, on a
//!   fresh intact car with the same identity, after the 2 s hold;
//! - husks and parts stay dynamic for the round (and an out-of-bounds husk is caught by a plane under the map and sleeps
//!   there: never despawned, bounded cost);
//! - the mass in the world adds up across a wreck, a wreck never injects energy, and the whole thing replays bit for bit.
//!
//! The scenarios `two-wheels-off`, `debris-pile-exit` (and `oob-recover`, `flip-recover` with their husk assertions) are
//! `scenarios/affordances/*.json`, run by `jj sim` and `crates/jj-tools/tests/scenarios.rs`.

use std::path::Path;

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::damage::{DamageEvent, PARTS, PartState, WreckWhy, part_index};
use jj_sim::race::RESPAWN_HOLD_TICKS;
use jj_sim::{CarId, DriveInput, Journal, PropKind, Sim, SpawnPose, TICK_HZ, VehicleProfile};

const S: u64 = TICK_HZ as u64;

fn yard() -> LoadedMap {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    load_json(
        &std::fs::read(root.join("scenarios/damage/yard.json")).expect("yard"),
        &Registry::generic(),
    )
    .expect("the yard validates")
}

fn rig(map: &LoadedMap, n: usize) -> Sim {
    let mut sim = Sim::new(map, &Registry::generic(), 21, VehicleProfile::cruz());
    for i in 0..n {
        sim.spawn_car(SpawnPose {
            x: -60.0 + 12.0 * i as f32,
            y: 0.1,
            z: -20.0,
            heading: 0.0,
        });
    }
    steps(&mut sim, 2 * S);
    sim
}

fn steps(sim: &mut Sim, n: u64) {
    for _ in 0..n {
        sim.step();
    }
}

fn at(x: f32, y: f32, z: f32) -> SpawnPose {
    SpawnPose {
        x,
        y,
        z,
        heading: 90f32.to_radians(),
    }
}

fn wrecks(sim: &Sim, car: u32) -> u32 {
    sim.race().car(car).map_or(0, |c| c.wrecks)
}

fn husks(sim: &Sim) -> Vec<usize> {
    sim.prop_kinds()
        .iter()
        .enumerate()
        .filter(|(_, k)| **k == PropKind::Husk)
        .map(|(i, _)| i)
        .collect()
}

/// The anchor of the cars `rig` spawns: where each started.
fn anchor(i: usize) -> [f32; 2] {
    [-60.0 + 12.0 * i as f32, -20.0]
}

fn near(p: [f32; 3], x: f32, z: f32, within: f32) -> bool {
    (p[0] - x).hypot(p[2] - z) < within
}

#[test]
fn a_lost_wheel_wrecks_the_car_after_its_grace_and_it_respawns_at_its_anchor() {
    // R121 (amends P1-S04c's two-wheel rule): one wheel off and the car drives on for the profile's grace, then it is
    // wrecked and respawns fresh.
    let map = yard();
    let mut sim = rig(&map, 2);
    sim.place_car(CarId(0), at(20.0, 0.05, -30.0), 0.0, [14.0, 0.0, 0.0]);
    steps(&mut sim, 30);
    let [ax, az] = anchor(0);
    assert_eq!(wrecks(&sim, 0), 0);
    let grace =
        (sim.profile().tuning.damage.wheel_loss_respawn_s * jj_sim::TICK_HZ as f32).round() as u64;
    sim.set_part_health(CarId(0), part_index("wheel_FL").unwrap() as u8, 0.0);
    steps(&mut sim, grace - 2);
    assert_eq!(
        wrecks(&sim, 0),
        0,
        "a lost wheel drives on through its grace"
    );
    let before = sim.car_state(CarId(0)).unwrap().position;
    steps(&mut sim, 4);
    assert_eq!(wrecks(&sim, 0), 1, "and is a wreck when it runs out");
    // The husk stays where the car was, a dynamic body; every part is debris; the other car was never touched.
    let h = husks(&sim);
    assert_eq!(h.len(), 1);
    assert_eq!(sim.debris_dynamic(h[0]), Some(true));
    let hp = sim.debris_poses()[h[0]].0;
    assert!(
        near(hp, before[0], before[2], 8.0),
        "the husk is where the car crashed: {hp:?} vs {before:?}"
    );
    let parts: Vec<usize> = sim
        .prop_kinds()
        .iter()
        .enumerate()
        .filter(|(_, k)| **k == PropKind::Part)
        .map(|(i, _)| i)
        .collect();
    assert_eq!(parts.len(), PARTS - 1, "all ten parts are debris");
    // The player is at their own anchor on a fresh car, held for the 2 s respawn hold, protected, intact, same CarId.
    let now = sim.car_state(CarId(0)).unwrap();
    assert!(
        near(now.position, ax, az, 6.0),
        "respawned at the anchor: {:?}",
        now.position
    );
    assert!(sim.race().is_held(0, sim.tick()), "held for the respawn");
    assert!(sim.is_protected(CarId(0)), "under spawn protection");
    assert!(
        sim.part_states(CarId(0))
            .unwrap()
            .iter()
            .all(|s| *s == PartState::Intact)
    );
    assert!(
        (sim.car_mass(CarId(0)).unwrap() - 1200.0).abs() < 0.01,
        "a fresh intact car"
    );
    assert_eq!(wrecks(&sim, 1), 0);
    // The mass in the world: the husk and the ten parts are the old chassis' 1200 kg.
    let junk: f32 = h
        .iter()
        .chain(&parts)
        .map(|&i| sim.debris_mass(i).unwrap())
        .sum();
    assert!((junk - 1200.0).abs() < 0.5, "husk + parts = {junk} kg");
    // About 2 s later the player drives the fresh car.
    steps(&mut sim, RESPAWN_HOLD_TICKS + 5);
    assert!(!sim.race().is_held(0, sim.tick()));
    for _ in 0..S {
        sim.set_input(
            CarId(0),
            DriveInput {
                throttle: 20_000,
                ..Default::default()
            },
        );
        sim.step();
    }
    assert!(
        sim.car_state(CarId(0)).unwrap().forward_speed > 2.0,
        "it drives again"
    );
    // The event says why, with the wheel's cause (scenery: set by command, no instigator).
    assert!(sim.damage_events().iter().any(|(_, e)| matches!(
        e,
        DamageEvent::Wrecked {
            car: 0,
            why: WreckWhy::WheelLoss,
            ..
        }
    )));
}

#[test]
fn stuck_flip_and_out_of_bounds_wrecks_leave_husks_that_persist_dynamic() {
    let map = yard();
    let mut sim = rig(&map, 3);
    // Car 0: out of bounds past +x. Car 1: a stuck flip (the wreck the race issues 3 s into a failed assist). Car 2 stays.
    sim.place_car(CarId(0), at(400.0, 3.0, -30.0), 0.0, [30.0, 0.0, 0.0]);
    sim.place_car(CarId(1), at(30.0, 0.05, -30.0), 0.0, [0.0; 3]);
    steps(&mut sim, 10);
    assert!(sim.wreck(CarId(1)));
    steps(&mut sim, 5);
    assert_eq!(
        (wrecks(&sim, 0), wrecks(&sim, 1), wrecks(&sim, 2)),
        (1, 1, 0)
    );
    assert_eq!(husks(&sim).len(), 2);
    assert!(
        sim.damage_events().iter().any(|(_, e)| matches!(
            e,
            DamageEvent::Wrecked {
                car: 0,
                why: WreckWhy::OutOfBounds,
                ..
            }
        )) && sim.damage_events().iter().any(|(_, e)| matches!(
            e,
            DamageEvent::Wrecked {
                car: 1,
                why: WreckWhy::Flipped,
                ..
            }
        )),
        "events carry the cause"
    );
    // Thirty seconds on (round end): every husk and part is still there, still dynamic; the one that fell off the map is
    // asleep on the catch plane, below the kill plane (-20 m), not still falling and not gone.
    let n = sim.prop_kinds().len();
    steps(&mut sim, 30 * S);
    assert_eq!(sim.prop_kinds().len(), n, "nothing was despawned");
    for i in 0..n {
        assert_eq!(sim.debris_dynamic(i), Some(true), "body {i} is dynamic");
    }
    let oob = husks(&sim)[0];
    let p = sim.debris_poses()[oob].0;
    assert!(
        p[1] < -20.0 && p[1] > -45.0,
        "the OOB husk rests on the catch plane at y = {}",
        p[1]
    );
    assert_eq!(
        sim.debris_sleeping(oob),
        Some(true),
        "and sleeps there: bounded cost"
    );
    // Both players are back on their own anchors with the same ids.
    for i in 0..2 {
        let [ax, az] = anchor(i);
        assert!(near(
            sim.car_state(CarId(i as u32)).unwrap().position,
            ax,
            az,
            6.0
        ));
    }
}

#[test]
fn a_wreck_never_injects_energy_and_replays_bit_for_bit() {
    let map = yard();
    let mut sim = rig(&map, 1);
    sim.place_car(CarId(0), at(10.0, 0.05, -30.0), 0.0, [14.0, 0.0, 0.0]);
    let e0 = sim.energy_j();
    let start = e0.0 - e0.1;
    let mut worst = f64::NEG_INFINITY;
    for t in 0..(8 * S) {
        if t == 40 {
            sim.set_part_health(CarId(0), part_index("wheel_FR").unwrap() as u8, 0.0);
            sim.set_part_health(CarId(0), part_index("wheel_RL").unwrap() as u8, 0.0);
        }
        sim.step();
        let e = sim.energy_j();
        worst = worst.max(e.0 - e.1 - start);
    }
    assert_eq!(wrecks(&sim, 0), 1);
    assert!(worst <= 250.0, "energy rose {worst:.1} J across a wreck");
    let journal = Journal::from_bytes(&sim.journal().to_bytes()).expect("journal");
    let replayed = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        &journal,
        sim.tick(),
    );
    assert_eq!(replayed.state_hash(), sim.state_hash(), "the wreck replays");
    assert_eq!(husks(&replayed).len(), 1);
}

/// R121 (owner playtest 1): damage doesn't slow a car until a wheel comes off. A Cruz Missile with every part loose
/// (each just under its loose threshold) laps the greybox on the autopilot within 1 % of an undamaged one on the same
/// seed, and it is never wrecked for it.
#[test]
fn a_car_with_every_part_loose_laps_as_fast_as_an_intact_one() {
    const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
    let map = load_json(GREYBOX.as_bytes(), &Registry::generic()).expect("the greybox validates");
    let s = u64::from(TICK_HZ);
    let lap = |loose: bool, seed: u64| {
        let mut sim = Sim::new(&map, &Registry::generic(), seed, VehicleProfile::cruz());
        let car = sim.spawn_grid(1)[0];
        sim.start_race(1);
        sim.set_autopilot(car, true);
        if loose {
            let d = sim.profile().tuning.damage.clone();
            for (i, name) in jj_sim::damage::PART_NAMES.iter().enumerate().skip(1) {
                let max = match *name {
                    "front" => d.health_front,
                    "back" => d.health_back,
                    n if n.starts_with("door") => d.health_door,
                    _ => d.health_wheel,
                };
                sim.set_part_health(car, i as u8, max * d.loose_fraction * 0.9);
            }
            assert!(
                sim.part_states(car)
                    .unwrap()
                    .iter()
                    .skip(1)
                    .all(|p| *p == PartState::Loose),
                "every part is loose"
            );
        }
        while !sim.race().is_finished(car.0) && sim.tick() < 200 * s {
            sim.step();
        }
        let rc = sim.race().car(car.0).unwrap();
        assert_eq!(rc.wrecks, 0, "loose parts never wreck a car");
        rc.finished_at.expect("the lap finishes") as f64 / s as f64
    };
    for seed in [5, 6] {
        let (intact, loose) = (lap(false, seed), lap(true, seed));
        assert!(
            (loose - intact).abs() <= intact * 0.01,
            "seed {seed}: loose {loose:.2} s vs intact {intact:.2} s"
        );
    }
}
