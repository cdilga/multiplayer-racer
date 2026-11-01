//! br-8h3u.8: contact with items bounces the car oddly (owner 2026-10-24: "Sometimes, when I contact items, I bounce
//! funnily"). A car driving into each in-world item at racing speeds is knocked about, never launched or spun: its
//! vertical and angular velocity stay inside a stated envelope.
//!   cargo test -p jj-sim --test item_contact --release -- --nocapture
use jj_map::{Registry, load_json};
use jj_sim::{CarId, DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::SeatId;
use jj_types::items::ItemId;

const S: u64 = TICK_HZ as u64;

fn pose(x: f32, z: f32) -> SpawnPose {
    SpawnPose {
        x,
        y: 0.3,
        z,
        heading: core::f32::consts::FRAC_PI_2,
    }
}

/// What the hitting car did over the contact.
#[derive(Debug, Clone, Copy)]
struct Hit {
    touched: bool,
    up_mps: f32,
    spin_rps: f32,
    rise_m: f32,
    min_up_y: f32,
}

#[derive(Clone, Copy, Debug)]
enum Item {
    /// A dropped esky (the heavy box), met square or with a wheel only.
    Esky,
    /// A loose piece of debris the size of a door.
    Debris,
}

/// Puts `item` on the greybox's main straight at x = 0 and drives a Cruz into it from 40 m back at `speed`, flat out,
/// `lateral` m off its centre; follows it 3 s.
fn hit(item: Item, speed: f32, lateral: f32) -> Hit {
    let map = load_json(
        include_bytes!("../../../maps/greybox-loop.json"),
        &Registry::generic(),
    )
    .unwrap();
    let mut sim = Sim::new(&map, &Registry::generic(), 5, VehicleProfile::cruz());
    let a = sim.spawn_car(pose(3.0, 0.0));
    let b = sim.spawn_car(pose(-80.0, 0.0));
    sim.start_race(9);
    for _ in 0..(3 * S) {
        sim.step();
    }
    sim.place_car(a, pose(3.0, 0.0), 0.0, [0.0; 3]);
    sim.place_car(b, pose(-80.0, 0.0), 0.0, [0.0; 3]);
    for _ in 0..S {
        sim.step();
    }
    match item {
        Item::Esky => {
            sim.pickup_item(a, SeatId(1), ItemId::Esky).unwrap();
            assert!(sim.utility(a, jj_sim::utility::UtilityKind::Forward));
        }
        Item::Debris => sim.spawn_debris(pose(0.0, 0.0), [0.6, 0.05, 0.5]),
    }
    // Let it settle, then move the dropper well out of the way.
    for _ in 0..(2 * S) {
        sim.step();
    }
    sim.place_car(a, pose(200.0, 0.0), 0.0, [0.0; 3]);
    let ground = {
        let st = sim.car_state(b).unwrap();
        st.position[1]
    };
    sim.place_car(b, pose(-40.0, lateral), 0.0, [speed, 0.0, 0.0]);
    let drive = |sim: &mut Sim, c: CarId| {
        sim.set_input(
            c,
            DriveInput {
                throttle: i16::MAX,
                ..Default::default()
            },
        )
    };
    let mut h = Hit {
        touched: false,
        up_mps: 0.0,
        spin_rps: 0.0,
        rise_m: 0.0,
        min_up_y: 1.0,
    };
    for _ in 0..(3 * S) {
        drive(&mut sim, b);
        sim.step();
        let st = sim.car_state(b).unwrap();
        if st.position[0] < -6.0 {
            continue;
        }
        h.touched = true;
        h.up_mps = h.up_mps.max(st.linvel[1]);
        let w = st.angvel;
        h.spin_rps = h
            .spin_rps
            .max((w[0] * w[0] + w[1] * w[1] + w[2] * w[2]).sqrt());
        h.rise_m = h.rise_m.max(st.position[1] - ground);
        h.min_up_y = h.min_up_y.min(st.up_y);
    }
    h
}

#[test]
fn driving_into_items_knocks_the_car_about_without_launching_or_spinning_it() {
    let mut bad = Vec::new();
    for item in [Item::Esky, Item::Debris] {
        for speed in [12.0, 22.0, 32.0, 40.0] {
            for lateral in [0.0, 0.8] {
                let h = hit(item, speed, lateral);
                eprintln!("{item:?} {speed} m/s, {lateral} m off: {h:?}");
                if !h.touched
                    || h.up_mps > UP_MPS
                    || h.spin_rps > SPIN_RPS
                    || h.rise_m > RISE_M
                    || h.min_up_y < 0.5
                {
                    bad.push(format!("{item:?} {speed} m/s {lateral} m: {h:?}"));
                }
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

/// The envelope: a car meeting an item is knocked about (slowed, nudged, the nose bumped) but never thrown into the air
/// or set spinning. Starting values, tunable.
const UP_MPS: f32 = 3.0;
const SPIN_RPS: f32 = 3.0;
const RISE_M: f32 = 0.8;
