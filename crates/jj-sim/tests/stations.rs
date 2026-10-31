//! P1-W04: item stations in the sim. The greybox with a row of stations added on its main straight: a car driving
//! through is offered the box's item; a successful pickup takes the box, which recharges for 5 s; a full queue leaves it
//! for the next car; the draw depends only on the run, the station and its count; it all replays bit for bit.

use jj_map::{LoadedMap, Registry, kit::ITEM_STATION, load_json};
use jj_sim::items::stations::RECHARGE_TICKS;
use jj_sim::{CarId, DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::SeatId;
use jj_types::items::ItemId;

const S: u64 = TICK_HZ as u64;

/// The greybox with one station on the main straight's centre line at x = 120 m.
fn station_map() -> LoadedMap {
    let mut v: serde_json::Value =
        serde_json::from_slice(include_bytes!("../../../maps/greybox-loop.json")).unwrap();
    v["dressing"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "kitPiece": ITEM_STATION,
            "pose": {"x": 120000, "y": 0, "z": 0, "yaw": 0},
            "params": {},
            "collides": false
        }));
    load_json(&serde_json::to_vec(&v).unwrap(), &Registry::generic())
        .expect("a station on the straight validates")
}

fn start(map: &LoadedMap, seed: u64) -> (Sim, Vec<CarId>) {
    let mut sim = Sim::new(map, &Registry::generic(), seed, VehicleProfile::cruz());
    let cars = vec![
        sim.spawn_car(SpawnPose {
            x: 90.0,
            y: 0.3,
            z: 0.0,
            heading: core::f32::consts::FRAC_PI_2,
        }),
        sim.spawn_car(SpawnPose {
            x: 70.0,
            y: 0.3,
            z: 0.0,
            heading: core::f32::consts::FRAC_PI_2,
        }),
    ];
    sim.start_race(9);
    for _ in 0..(3 * S) {
        sim.step();
    }
    (sim, cars)
}

/// Drives `car` at 15 m/s through the station from 15 m short of it, claiming any offer as a host does. Returns the
/// items it was offered.
fn drive_through(sim: &mut Sim, car: CarId, seat: SeatId) -> Vec<ItemId> {
    sim.place_car(
        car,
        SpawnPose {
            x: 105.0,
            y: 0.3,
            z: 0.0,
            heading: core::f32::consts::FRAC_PI_2,
        },
        0.0,
        [15.0, 0.0, 0.0],
    );
    let mut offered = Vec::new();
    for _ in 0..(2 * S) {
        sim.set_input(
            car,
            DriveInput {
                throttle: i16::MAX / 3,
                ..Default::default()
            },
        );
        sim.step();
        for o in sim.station_offers().to_vec() {
            if o.car == car.0 {
                offered.push(o.item);
                if sim.pickup_item(car, seat, o.item).is_ok() {
                    sim.take_station(o.station);
                }
            }
        }
    }
    sim.set_input(car, DriveInput::default());
    offered
}

#[test]
fn a_car_through_the_box_gets_its_item_and_the_station_recharges_for_5_s() {
    let map = station_map();
    let (mut sim, cars) = start(&map, 3);
    assert_eq!(sim.stations().len(), 1);
    let item = sim.stations()[0].draw(3, 0);
    let offered = drive_through(&mut sim, cars[0], SeatId(1));
    assert_eq!(offered.first(), Some(&item), "the box holds the draw");
    assert_eq!(
        sim.items().queue(cars[0].0).front.map(|h| h.item),
        Some(item)
    );
    let st = sim.stations()[0];
    assert_eq!(st.taken, 1);
    assert!(!st.ready(sim.tick()), "taken: recharging");
    assert!(
        st.ready_at > sim.tick() && st.ready_at <= sim.tick() + RECHARGE_TICKS,
        "ready again within 5 s: {} at tick {}",
        st.ready_at,
        sim.tick()
    );
    // A second car straight through: nothing while it recharges.
    assert!(
        drive_through(&mut sim, cars[1], SeatId(2)).is_empty(),
        "no offer while recharging"
    );
    // After the 5 s it is back, with the next draw.
    while !sim.stations()[0].ready(sim.tick()) {
        sim.step();
    }
    let next = sim.stations()[0].draw(3, 0);
    assert_eq!(
        drive_through(&mut sim, cars[1], SeatId(2)).first(),
        Some(&next)
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

#[test]
fn a_full_queue_leaves_the_box_for_the_next_car() {
    let map = station_map();
    let (mut sim, cars) = start(&map, 4);
    sim.pickup_item(cars[0], SeatId(1), ItemId::Sanga).unwrap();
    sim.pickup_item(cars[0], SeatId(1), ItemId::Sanga).unwrap();
    let offered = drive_through(&mut sim, cars[0], SeatId(1));
    assert!(!offered.is_empty(), "it was offered");
    assert_eq!(
        sim.stations()[0].taken,
        0,
        "a full queue doesn't take the box"
    );
    assert!(sim.stations()[0].ready(sim.tick()));
    assert!(!drive_through(&mut sim, cars[1], SeatId(2)).is_empty());
    assert_eq!(sim.stations()[0].taken, 1, "the next car does");
}

#[test]
fn draws_are_the_run_s_alone_not_the_race_order() {
    let map = station_map();
    // The same seed: the same sequence of draws whichever car takes them.
    let draws = |seed: u64, first: usize| {
        let (mut sim, cars) = start(&map, seed);
        let mut got = Vec::new();
        for k in 0..4 {
            let c = cars[(first + k) % 2];
            while !sim.stations()[0].ready(sim.tick()) {
                sim.step();
            }
            got.push(drive_through(&mut sim, c, SeatId(c.0 + 1)).first().copied());
            sim.recover(c);
            for _ in 0..(3 * S) {
                sim.step();
            }
        }
        got
    };
    assert_eq!(draws(11, 0), draws(11, 1));
    // Both items come out of the pool across seeds.
    let all: Vec<_> = (0..16).flat_map(|s| draws(s, 0)).flatten().collect();
    assert!(ItemId::ALL.iter().all(|i| all.contains(i)), "{all:?}");
}
