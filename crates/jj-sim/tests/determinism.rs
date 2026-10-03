//! Determinism (plan §7.2): the same map, seed and inputs give the same full-state hash on two runs, and replaying the
//! applied-tick journal (round-tripped through its bytes) reproduces it.

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{DriveInput, Journal, Sim, VehicleProfile, route_spawn};

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");

fn greybox() -> LoadedMap {
    load_json(GREYBOX.as_bytes(), &Registry::generic()).expect("the greybox validates")
}

/// Two cars on the main straight; a scripted minute of throttle, steering and braking.
fn session(seed: u64, ticks: u64) -> Sim {
    let map = greybox();
    let mut sim = Sim::new(
        &map,
        &Registry::generic(),
        seed,
        VehicleProfile::provisional_cruz(),
    );
    let a = sim.spawn_car(route_spawn(&map, 16, -2.0, 0.6));
    let b = sim.spawn_car(route_spawn(&map, 16, 2.0, 0.6));
    for t in 0..ticks {
        let phase = (t / 120) % 4;
        let input = |k: i16| DriveInput {
            throttle: if phase < 2 { 26_000 } else { 0 },
            steer: if phase == 1 { 6_000 * k } else { 0 },
            brake: if phase == 3 { 20_000 } else { 0 },
        };
        sim.set_input(a, input(1));
        sim.set_input(b, input(-1));
        sim.step();
    }
    sim
}

#[test]
fn same_inputs_and_seed_give_the_same_hash() {
    let (x, y) = (session(7, 600), session(7, 600));
    assert_eq!(x.state_hash(), y.state_hash());
    assert_ne!(
        session(8, 600).state_hash(),
        x.state_hash(),
        "the seed is part of the state"
    );
    let moved = x.car_state(jj_sim::CarId(0)).unwrap();
    assert!(
        moved.position[0] > 10.0,
        "the cars actually drove: x = {:.1}",
        moved.position[0]
    );
}

#[test]
fn journal_replay_reproduces_the_hash() {
    let ticks = 600;
    let live = session(11, ticks);
    let journal = Journal::from_bytes(&live.journal().to_bytes()).expect("the journal round-trips");
    assert_eq!(&journal, live.journal());
    let replayed = Sim::replay(
        &greybox(),
        &Registry::generic(),
        VehicleProfile::provisional_cruz(),
        &journal,
        ticks,
    );
    assert_eq!(replayed.tick(), ticks);
    assert_eq!(
        replayed.state_hash(),
        live.state_hash(),
        "replay = live, bit for bit"
    );
}

#[test]
fn placing_a_car_is_journaled_so_the_run_still_replays() {
    let map = greybox();
    let mut live = Sim::new(
        &map,
        &Registry::generic(),
        3,
        VehicleProfile::provisional_cruz(),
    );
    let car = live.spawn_car(route_spawn(&map, 16, 0.0, 0.6));
    let teleport = jj_sim::SpawnPose {
        x: 60.0,
        y: 1.5,
        z: 3.0,
        heading: 1.2,
    };
    for t in 0..480 {
        if t == 200 {
            live.place_car(car, teleport, 0.0, [4.0, 0.0, 6.0]);
        }
        live.set_input(
            car,
            DriveInput {
                throttle: 20_000,
                steer: 0,
                brake: 0,
            },
        );
        live.step();
    }
    assert!(
        live.journal()
            .setup
            .iter()
            .any(|(t, s)| *t == 200 && matches!(s, jj_sim::journal::Setup::PlaceCar { .. }))
    );
    let journal = Journal::from_bytes(&live.journal().to_bytes()).unwrap();
    let replayed = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::provisional_cruz(),
        &journal,
        480,
    );
    assert_eq!(
        replayed.state_hash(),
        live.state_hash(),
        "a placed car replays bit for bit"
    );
    // And the place took effect: the car left the straight (z = 0) sideways, where the unplaced control run stays on it.
    let placed = live.car_state(car).unwrap();
    let mut control = Sim::new(
        &map,
        &Registry::generic(),
        3,
        VehicleProfile::provisional_cruz(),
    );
    let c = control.spawn_car(route_spawn(&map, 16, 0.0, 0.6));
    for _ in 0..480 {
        control.set_input(
            c,
            DriveInput {
                throttle: 20_000,
                steer: 0,
                brake: 0,
            },
        );
        control.step();
    }
    let stayed = control.car_state(c).unwrap();
    assert!(
        stayed.position[2].abs() < 0.5,
        "control left the straight: {:?}",
        stayed.position
    );
    assert!(
        placed.position[2] > 3.0,
        "the placed car should have moved off sideways: {:?}",
        placed.position
    );
}
