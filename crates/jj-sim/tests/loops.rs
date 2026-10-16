//! br-xlvx.6.2 (Loops): driving the loop on the hand-made loop map (maps/test/loop.json). A car on the deck keeps its
//! drive all the way round and the loop's assist (its own params) holds it on through the top; at the posted speed every
//! roster vehicle completes it, upside down at the top, and the run replays bit for bit; too slow, the assist lets go and
//! the car falls off and respawns before the loop.

use std::path::{Path, PathBuf};

use jj_map::looping::LoopDesign;
use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{CarId, DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};

const MAP: &str = include_str!("../../../maps/test/loop.json");
const S: u64 = TICK_HZ as u64;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn map() -> LoadedMap {
    load_json(MAP.as_bytes(), &Registry::generic()).expect("the loop map validates")
}

fn design(m: &LoadedMap) -> LoopDesign {
    m.map.features.iter().find_map(LoopDesign::of).expect("the map has a loop")
}

/// What a run through the loop did.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Run {
    /// Out of the exit, on the road beyond it, upright and moving.
    completed: bool,
    /// The car's lowest up·Y: below −0.9 it went upside down at the top.
    min_up_y: f32,
    /// Its highest point, m.
    max_y: f32,
    respawned: bool,
    /// The tick of the first respawn and where it put the car (route-plan x, m).
    respawn_x: Option<f32>,
    entry_speed: f32,
}

/// Starts a car `back` m before the loop's entry, heading into it at `speed`, the throttle held (`throttle`) and the wheel
/// straight, and runs it for up to 12 s.
fn take(m: &LoadedMap, profile: VehicleProfile, seed: u64, speed: f32, throttle: bool, back: f32) -> (Run, Sim, CarId) {
    let d = design(m);
    let e = &m.map.route.points[d.entry];
    let x_exit = m.map.route.points[d.exit].x as f32 / 1000.0;
    let z_exit = m.map.route.points[d.exit].z as f32 / 1000.0;
    let mut sim = Sim::with_profiles(m, &Registry::generic(), seed, vec![profile]);
    let car = sim.spawn_grid(1)[0];
    let pose = SpawnPose {
        x: e.x as f32 / 1000.0 - back,
        y: e.y as f32 / 1000.0 + 0.3,
        z: e.z as f32 / 1000.0,
        heading: core::f32::consts::FRAC_PI_2,
    };
    sim.place_car(car, pose, 0.0, [speed, 0.0, 0.0]);
    sim.set_input(car, DriveInput { throttle: if throttle { i16::MAX } else { 0 }, ..Default::default() });
    let life = sim.car_life(car);
    let mut run = Run {
        completed: false,
        min_up_y: 1.0,
        max_y: f32::MIN,
        respawned: false,
        respawn_x: None,
        entry_speed: 0.0,
    };
    for _ in 0..12 * S {
        sim.step();
        let st = sim.car_state(car).unwrap();
        if sim.car_life(car) != life {
            run.respawned = true;
            run.respawn_x = Some(st.position[0]);
            break;
        }
        if run.entry_speed == 0.0 && st.position[0] >= e.x as f32 / 1000.0 {
            run.entry_speed = st.forward_speed;
        }
        run.min_up_y = run.min_up_y.min(st.up_y);
        run.max_y = run.max_y.max(st.position[1]);
        if st.position[0] > x_exit + 25.0 && (st.position[2] - z_exit).abs() < 4.0 && st.up_y > 0.9 && st.forward_speed > 3.0 {
            run.completed = true;
            break;
        }
    }
    (run, sim, car)
}

/// The posted speed (jj_map::looping::posted_entry_mps), m/s: a coasting car still has the loop's minimum at the top.
fn posted(m: &LoadedMap) -> f32 {
    jj_map::looping::posted_entry_mps(&design(m), 9.81) as f32
}

/// AC1: at the posted speed, on the throttle with the wheel straight, every roster vehicle (bikes included) completes the
/// loop on every seed: up the deck, upside down at the top (2R up), out of the exit and on along the road.
#[test]
fn at_the_posted_speed_every_roster_vehicle_completes_the_loop_upside_down_at_the_top() {
    let m = map();
    let d = design(&m);
    let v = posted(&m);
    let mut bad = Vec::new();
    for (name, profile) in VehicleProfile::roster(&root()).unwrap() {
        for seed in 0..3 {
            // Arriving at the posted speed: started at it 5 m before the entry.
            let (r, ..) = take(&m, profile.clone(), seed, v, true, 5.0);
            eprintln!("{name} seed {seed}: {r:?}");
            let top = 2.0 * d.radius_m as f32;
            if !(r.completed && r.min_up_y < -0.9 && r.max_y > top - 1.0 && !r.respawned) {
                bad.push(format!("{name} seed {seed}: {r:?}"));
            }
        }
    }
    assert!(bad.is_empty(), "posted {v:.1} m/s:\n{}", bad.join("\n"));
}

/// AC1, faster: a car arriving well over the posted speed is carried round too (the ride never throws it off).
#[test]
fn faster_than_the_posted_speed_still_completes() {
    let m = map();
    for speed in [posted(&m) + 5.0, 35.0, 45.0] {
        let (r, ..) = take(&m, VehicleProfile::cruz(), 1, speed, true, 5.0);
        assert!(r.completed && r.min_up_y < -0.9, "{speed:.1} m/s: {r:?}");
    }
}

/// AC2: too slow (coasting in well under the posted speed), the loop lets the car go on the way up; it falls off and
/// respawns before the loop, facing along the road.
#[test]
fn too_slow_falls_off_and_respawns_before_the_loop_facing_the_road() {
    let m = map();
    let d = design(&m);
    let entry_x = m.map.route.points[d.entry].x as f32 / 1000.0;
    for (seed, speed) in [(0, 13.0), (1, 15.0), (2, posted(&m) - 3.0)] {
        let (r, sim, car) = take(&m, VehicleProfile::cruz(), seed, speed, false, 2.0);
        assert!(!r.completed && r.respawned, "{speed:.1} m/s: {r:?}");
        assert!(r.max_y > 2.0, "{speed:.1} m/s: it got onto the loop before falling: {r:?}");
        let x = r.respawn_x.unwrap();
        assert!(x < entry_x - 5.0, "respawned at x {x:.1}, the loop's entry is at {entry_x:.1}");
        let st = sim.car_state(car).unwrap();
        assert!((st.heading - core::f32::consts::FRAC_PI_2).abs() < 0.3, "facing along the road: heading {}", st.heading);
    }
}

/// AC1: a run through the loop replays bit for bit (the full-state hash, ride included).
#[test]
fn a_run_through_the_loop_replays_bit_for_bit() {
    let m = map();
    let hash = || {
        let (r, sim, _) = take(&m, VehicleProfile::tradie_ute(), 4, posted(&m), true, 5.0);
        assert!(r.completed);
        sim.state_hash()
    };
    assert_eq!(hash(), hash());
}

/// The ride books its work: through the whole loop, the bodies' energy never rises above what the ledger authorises
/// (the engine, the ride's own changes) by more than a little solver noise.
#[test]
fn the_ride_gains_no_unbooked_energy() {
    let m = map();
    let d = design(&m);
    let e = &m.map.route.points[d.entry];
    let mut sim = Sim::with_profiles(&m, &Registry::generic(), 2, vec![VehicleProfile::cruz()]);
    let car = sim.spawn_grid(1)[0];
    let pose = SpawnPose { x: e.x as f32 / 1000.0 - 5.0, y: 0.3, z: 0.0, heading: core::f32::consts::FRAC_PI_2 };
    sim.place_car(car, pose, 0.0, [posted(&m), 0.0, 0.0]);
    sim.set_input(car, DriveInput { throttle: i16::MAX, ..Default::default() });
    let (e0, l0) = sim.energy_j();
    let mut worst = 0.0f64;
    for _ in 0..4 * S {
        sim.step();
        let (e1, l1) = sim.energy_j();
        worst = worst.max((e1 - e0) - (l1 - l0));
    }
    let scale = 0.5 * 1200.0 * f64::from(posted(&m)).powi(2);
    assert!(worst < 0.05 * scale, "unbooked energy gain {worst:.0} J (the car's entry kinetic energy {scale:.0} J)");
}
