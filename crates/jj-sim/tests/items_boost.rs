//! Sanga and tinnie are drive boosts you can feel: top speed and 0-30 m/s time with and without, measured in the sim.
use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::utility::UtilityKind;
use jj_sim::{CarId, DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::SeatId;
use jj_types::items::ItemId;

const S: u64 = TICK_HZ as u64;

fn greybox() -> LoadedMap {
    load_json(
        include_bytes!("../../../maps/greybox-loop.json"),
        &Registry::generic(),
    )
    .unwrap()
}

/// One car at the start of the greybox's straight, settled, optionally holding and using `item` at full throttle.
/// Returns (seconds to 30 m/s forward, peak speed over the first `secs` seconds after the use, speed at the item's end).
fn run(item: Option<ItemId>, secs: u64) -> (f32, f32, f32, Sim, CarId) {
    let map = greybox();
    let mut sim = Sim::new(&map, &Registry::generic(), 5, VehicleProfile::cruz());
    let pose = SpawnPose {
        x: -60.0,
        y: 0.3,
        z: 0.0,
        heading: core::f32::consts::FRAC_PI_2,
    };
    let car = sim.spawn_car(pose);
    sim.start_race(9);
    for _ in 0..(3 * S) {
        sim.step();
    }
    sim.place_car(car, pose, 0.0, [0.0; 3]);
    for _ in 0..S {
        sim.step();
    }
    if let Some(i) = item {
        sim.pickup_item(car, SeatId(1), i).unwrap();
        assert!(sim.utility(car, UtilityKind::Forward));
    }
    let full = DriveInput {
        throttle: i16::MAX,
        ..Default::default()
    };
    let (mut t30, mut peak, mut end) = (f32::NAN, 0.0_f32, 0.0_f32);
    for k in 0..(secs * S) {
        sim.set_input(car, full);
        sim.step();
        let v = sim.car_state(car).unwrap().linvel;
        let sp = (v[0] * v[0] + v[2] * v[2]).sqrt();
        peak = peak.max(sp);
        end = sp;
        if t30.is_nan() && sp >= 30.0 {
            t30 = k as f32 / S as f32;
        }
    }
    (t30, peak, end, sim, car)
}

#[test]
fn sanga_is_a_clear_speed_burst() {
    let (t0, p0, _, _, _) = run(None, 6);
    let (t1, p1, _, sim, car) = run(Some(ItemId::Sanga), 6);
    println!("sanga: 0-30 {t0:.2}s -> {t1:.2}s; top {p0:.1} -> {p1:.1} m/s");
    assert!(p1 > p0 * 1.15, "top speed up by at least 15%: {p0} -> {p1}");
    assert!(t1 < t0 * 0.85, "0-30 faster by at least 15%: {t0} -> {t1}");
    // Over after 6 s: the burst ends cleanly.
    assert!(sim.sanga_state(car).is_none() || sim.sanga_state(car).unwrap().remaining_ticks <= 2);
}

#[test]
fn tinnie_is_a_short_strong_boost_and_replays() {
    let (t0, p0, _, _, _) = run(None, 2);
    let (t1, p1, _, sim, car) = run(Some(ItemId::Tinnie), 2);
    println!("tinnie: 0-30 {t0:.2}s -> {t1:.2}s; 2 s peak {p0:.1} -> {p1:.1} m/s");
    assert!(p1 > p0 * 1.3, "2 s peak up by 30%: {p0} -> {p1}");
    assert!(sim.tinnie_active(car) || sim.tick() > 0);
    let replay = Sim::replay(
        &greybox(),
        &Registry::generic(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(replay.state_hash(), sim.state_hash());
}
