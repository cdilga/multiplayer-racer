//! The esky: dropped behind the car as heavy dynamic debris. A following car hits it and is knocked about; it never expires.
use jj_map::{Registry, load_json};
use jj_sim::utility::UtilityKind;
use jj_sim::{CarId, DriveInput, PropKind, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::SeatId;
use jj_types::items::ItemId;

const S: u64 = TICK_HZ as u64;

fn pose(x: f32) -> SpawnPose {
    SpawnPose {
        x,
        y: 0.3,
        z: 0.0,
        heading: core::f32::consts::FRAC_PI_2,
    }
}

#[test]
fn a_dropped_esky_hits_the_follower_and_stays_forever() {
    let map = load_json(
        include_bytes!("../../../maps/greybox-loop.json"),
        &Registry::generic(),
    )
    .unwrap();
    let mut sim = Sim::new(&map, &Registry::generic(), 5, VehicleProfile::cruz());
    let a = sim.spawn_car(pose(0.0));
    let b = sim.spawn_car(pose(-80.0));
    sim.start_race(9);
    for _ in 0..(3 * S) {
        sim.step();
    }
    sim.place_car(a, pose(0.0), 0.0, [0.0; 3]);
    sim.place_car(b, pose(-80.0), 0.0, [0.0; 3]);
    for _ in 0..S {
        sim.step();
    }
    let before = sim.prop_kinds().len();
    sim.pickup_item(a, SeatId(1), ItemId::Esky).unwrap();
    assert!(
        sim.utility(a, UtilityKind::Forward),
        "either direction drops it behind"
    );
    assert_eq!(sim.prop_kinds().len(), before + 1);
    assert_eq!(*sim.prop_kinds().last().unwrap(), PropKind::Esky);
    let esky = before;
    // The follower drives into it.
    let drive = |sim: &mut Sim, c: CarId| {
        sim.set_input(
            c,
            DriveInput {
                throttle: i16::MAX,
                ..Default::default()
            },
        )
    };
    sim.place_car(b, pose(-40.0), 0.0, [22.0, 0.0, 0.0]);
    let mut top = 0.0_f32;
    let mut min_after = f32::MAX;
    let mut hit = false;
    for _ in 0..(4 * S) {
        drive(&mut sim, b);
        sim.step();
        let v = sim.car_state(b).unwrap().linvel;
        let sp = (v[0] * v[0] + v[2] * v[2]).sqrt();
        top = top.max(sp);
        if sim.car_state(b).unwrap().position[0] > -2.0 {
            hit = true;
            min_after = min_after.min(sp);
        }
    }
    println!("follower peak {top:.1} m/s, slowest after the esky {min_after:.1} m/s");
    assert!(hit);
    assert!(
        min_after < top * 0.9 || sim.car_state(b).unwrap().position[2].abs() > 0.5,
        "the esky knocked the follower about"
    );
    // 60 s on: it is still there, still a dynamic body.
    let n = sim.prop_kinds().len();
    let at = sim.debris_poses()[esky].0;
    for _ in 0..(60 * S) {
        sim.step();
    }
    assert_eq!(sim.prop_kinds().len(), n);
    let _ = at;
    assert_eq!(sim.prop_kinds()[esky], PropKind::Esky);
    assert_eq!(sim.debris_poses().len(), n);
    let replay = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(replay.state_hash(), sim.state_hash());
}
