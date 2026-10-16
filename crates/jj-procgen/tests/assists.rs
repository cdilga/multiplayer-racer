//! P1-FL06 AC2 (R128): skill still shows on every assist level. Round a Feel Lab scene (`maps/lab/canyon-leap.json`,
//! P1-FL09), two drivers who drive well lap the same car, one with assists Off and one with Lots. Driving well is
//! scripted: pure pursuit on the route line, flat out, braking late and hard only for the corner speed the car's own
//! turn (`arcade.turn_g`) allows, and taking the scene's features at their design speeds: the canyon leap inside its
//! speed window, the crest at the speed it keeps a car grounded. (The autopilot is no yardstick here: it is a cautious
//! bot that Lots' auto-throttle speeds up.) The Off driver is faster: Lots' brake assist and slide catch hold a good
//! driver back.
#![cfg(not(target_arch = "wasm32"))]

use jj_map::load_json;
use jj_sim::DriveInput;
use jj_sim::assist::AssistLevel;
use jj_sim::autopilot::{Path, Pose2};
use jj_sim::{Sim, TICK_HZ, VehicleProfile};
use jj_types::axis::quantise_axis;

const S: u64 = TICK_HZ as u64;
const LAPS: u32 = 2;

fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Lateral acceleration the good driver corners at: 45 % of the car's authored turn, the fastest clean share for the
/// Cruz here (Off, 2 laps: 0.35 76.4 s, 0.45 72.8 s; from 0.55 it runs wide into the rock walls and loses a minute).
const CORNER_SHARE: f32 = 0.45;
/// The braking the good driver plans with (m/s²): late and hard.
const BRAKE: f32 = 12.0;

/// A crest keeps a car grounded up to this speed (features::design), m/s.
const CREST_MPS: f32 = 25.0;

/// The speed a good driver takes each route point at, for the scene's features: a gap leap's run-up (60 m), gap and
/// landing at the middle of its speed window, a crest from 60 m before it to its end at the crest's design speed.
fn feature_limits(map: &jj_map::LoadedMap) -> Vec<f32> {
    let pts = &map.map.route.points;
    let n = pts.len();
    let mut limit = vec![f32::INFINITY; n];
    let mut cap = |from: usize, to: usize, v: f32| {
        let mut i = from % n;
        loop {
            limit[i] = limit[i].min(v);
            if i == to % n {
                break;
            }
            i = (i + 1) % n;
        }
    };
    for f in &map.map.features {
        if let Some(d) = jj_map::setpiece::GapLeap::of(f) {
            let mid = ((d.min_speed + d.max_speed) / 2.0) as f32;
            cap(d.from as usize + n - 24, d.to as usize, mid);
        } else if f.kind == jj_map::FeatureKind::Crest {
            let base = (0..n)
                .min_by_key(|&i| {
                    let (dx, dz) = (
                        i64::from(pts[i].x - f.pose.x),
                        i64::from(pts[i].z - f.pose.z),
                    );
                    dx * dx + dz * dz
                })
                .unwrap();
            cap(
                base + n - 24,
                base + f.params["lengthMm"] as usize / 2_500,
                CREST_MPS,
            );
        }
    }
    limit
}

/// Seconds to finish [`LAPS`] laps driving well, at `level`.
fn lap_time(map: &jj_map::LoadedMap, profile: &VehicleProfile, level: AssistLevel) -> f32 {
    let mut sim = Sim::new(map, &jj_procgen::registry(), 5, profile.clone());
    let car = sim.spawn_grid(1)[0];
    sim.set_assist(car, level);
    sim.start_race(LAPS);
    let path = Path::new(map);
    let a_lat = profile.tuning.arcade.as_ref().unwrap().turn_g * 9.81 * CORNER_SHARE;
    let limits = feature_limits(map);
    // `JJ_TRACE=1` prints the run once a second.
    let trace = std::env::var_os("JJ_TRACE").is_some();
    let pts = &map.map.route.points;
    let mut idx = None;
    while !sim.race().is_finished(car.0) {
        assert!(sim.tick() < 300 * S, "{level:?}: laps the scene");
        let s = sim.car_state(car).unwrap();
        let pose = Pose2 {
            x: s.position[0],
            y: s.position[1],
            z: s.position[2],
            heading: s.heading,
            forward_speed: s.forward_speed,
        };
        let line = path.probe(
            idx,
            pose,
            profile.steer_lock(s.forward_speed),
            profile.wheelbase(),
            [0.8, 6.0, BRAKE],
        );
        idx = Some(line.idx);
        let corner = if line.max_curvature > 1e-4 {
            (a_lat / line.max_curvature).sqrt()
        } else {
            f32::INFINITY
        };
        // Brake in time for the features ahead (150 m): v² = limit² + 2·BRAKE·distance.
        let n = pts.len();
        let (mut ahead, mut dist) = (f32::INFINITY, 0.0f32);
        for k in 0..60 {
            let (a, b) = (&pts[(line.idx + k) % n], &pts[(line.idx + k + 1) % n]);
            ahead = ahead.min((limits[(line.idx + k) % n].powi(2) + 2.0 * BRAKE * dist).sqrt());
            dist += ((b.x - a.x) as f32).hypot((b.z - a.z) as f32) / 1000.0;
        }
        let target = corner.min(ahead);
        let over = s.forward_speed - target;
        let input = DriveInput {
            throttle: quantise_axis(if over < 0.0 { 1.0 } else { 0.0 }),
            brake: quantise_axis((over * 0.5).clamp(0.0, 1.0)),
            steer: quantise_axis(line.steer),
            ..DriveInput::default()
        };
        sim.set_input(car, input);
        sim.step();
        if trace && sim.tick() % S == 0 {
            let s = sim.car_state(car).unwrap();
            eprintln!(
                "  {level:?} t {:>4} idx {:>3} v {:>5.1} target {:>5.1} y {:>5.1} upY {:.2} steer {:>5.2} progress {:.0}",
                sim.tick() / S,
                line.idx,
                s.forward_speed,
                target,
                s.position[1],
                s.up_y,
                line.steer,
                sim.race().progress_m(car.0)
            );
        }
    }
    let rc = sim.race().car(car.0).unwrap();
    eprintln!(
        "  {level:?}: wrecks {} recoveries {}",
        rc.wrecks, rc.recoveries
    );
    sim.tick() as f32 / TICK_HZ as f32
}

#[test]
fn an_off_driver_beats_a_lots_driver_round_a_lab_scene_when_both_drive_well() {
    let bytes = std::fs::read(root().join("maps/lab/canyon-leap.json")).unwrap();
    let map = load_json(&bytes, &jj_procgen::registry()).expect("the lab scene loads");
    for (id, profile) in VehicleProfile::roster(&root()).unwrap() {
        if profile.tuning.arcade.is_none() {
            continue; // the bikes keep Rapier's tyres (no arcade controller to assist)
        }
        let off = lap_time(&map, &profile, AssistLevel::Off);
        let lots = lap_time(&map, &profile, AssistLevel::Lots);
        eprintln!("{id}: Off {off:.2} s, Lots {lots:.2} s over {LAPS} laps");
        assert!(
            off < lots,
            "{id}: Off {off:.2} s must beat Lots {lots:.2} s"
        );
    }
}
