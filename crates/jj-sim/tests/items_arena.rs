//! A derby always has item boxes around: seeded, deterministic, scattered over the bowl's floor, recharging, journalled.
use jj_map::{Registry, load_json};
use jj_sim::{CarId, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::SeatId;

const S: u64 = TICK_HZ as u64;
const BOWL: &[u8] = include_bytes!("../../../maps/derby-bowl-16.json");

/// The bowl without its rock dressing (the generic registry has no rocks; the bowl feature is what places boxes).
fn bowl() -> jj_map::LoadedMap {
    let mut v: serde_json::Value = serde_json::from_slice(BOWL).unwrap();
    v["dressing"] = serde_json::json!([]);
    load_json(&serde_json::to_vec(&v).unwrap(), &Registry::generic()).unwrap()
}

fn start(seed: u64) -> (Sim, CarId, jj_map::LoadedMap) {
    let map = bowl();
    let mut sim = Sim::new(&map, &Registry::generic(), seed, VehicleProfile::cruz());
    let car = sim.spawn_car(SpawnPose {
        x: 0.0,
        y: 0.5,
        z: 0.0,
        heading: 0.0,
    });
    sim.start_derby(120 * S);
    (sim, car, map)
}

#[test]
fn a_derby_scatters_many_seeded_boxes_and_hands_them_out() {
    let (sim, car, map) = start(7);
    let n = sim.stations().len();
    println!("derby-bowl-16: {n} item boxes");
    assert!(n >= 20, "lots of boxes: {n}");
    let (sim2, ..) = start(7);
    assert_eq!(sim.stations(), sim2.stations(), "same seed, same boxes");
    let (sim3, ..) = start(8);
    assert_ne!(sim.stations(), sim3.stations(), "another seed, other boxes");
    // Drive the car onto a box: it is offered one, takes it, and the box recharges.
    let mut sim = sim;
    let target = sim.stations()[0].position;
    sim.place_car(
        car,
        SpawnPose {
            x: target[0],
            y: target[1] + 0.3,
            z: target[2],
            heading: 0.0,
        },
        0.0,
        [0.0; 3],
    );
    for _ in 0..(6 * S) {
        sim.step();
    }
    let mut got = false;
    for _ in 0..S {
        sim.step();
        for o in sim.station_offers().to_vec() {
            if o.car == car.0 && sim.pickup_item(car, SeatId(1), o.item).is_ok() {
                sim.take_station(o.station);
                got = true;
            }
        }
    }
    assert!(got, "a box in the derby arena was offered and taken");
    assert!(sim.items().queue(car.0).front.is_some());
    assert!(
        sim.stations()
            .iter()
            .any(|s| s.taken == 1 && !s.ready(sim.tick()))
    );
    let replay = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(replay.state_hash(), sim.state_hash());
    assert_eq!(replay.stations(), sim.stations());
}
