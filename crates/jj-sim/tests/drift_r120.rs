//! R120 (owner playtest 1, br-gw74.4): the drift is a tool. On a flat tarmac lot a car at 20 m/s turns 90°, driven the
//! way a player does it (a heading-seeking steer, full throttle):
//! - **grip**: brake to a cornering speed, turn, then flat out;
//! - **drift**: full lock with the handbrake until near the new heading, countersteer (the same heading-seeking steer
//!   catches the slide), then let the handbrake go, which fires the drift-exit boost ("drop a gear and disappear");
//! - **no countersteer**: full lock and the handbrake held regardless, which spins.
//!
//! The drift makes the corner and its exit boost fires; holding the slide without countersteer spins (yaw past the
//! corner by far). Coming out ahead of grip is br-gw74.4.1's to tune at the couch (the tuning menu has every number).

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{CarId, DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::axis::quantise_axis;

const S: u64 = TICK_HZ as u64;

/// The Cruz Missile, with `JJ_TUNE` overrides (`drift_rear_grip=0.5,…`) to try values without a rebuild.
fn cruz() -> VehicleProfile {
    let Ok(tune) = std::env::var("JJ_TUNE") else {
        return VehicleProfile::cruz();
    };
    let mut v = serde_json::to_value(VehicleProfile::cruz()).unwrap();
    for kv in tune.split(',').filter(|s| !s.is_empty()) {
        let (k, val) = kv.split_once('=').unwrap();
        v["tuning"][k] = serde_json::from_str(val).unwrap();
    }
    serde_json::from_value(v).unwrap()
}

/// The surface-strips test map, every cell tarmac and flat, nothing on it: a 380 × 170 m lot.
fn lot() -> LoadedMap {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../maps/test/surface-strips.json"
    );
    let mut v: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let t = &mut v["terrain"];
    let n = t["surfaces"].as_array().unwrap().len();
    t["surfaces"] = serde_json::json!(vec!["tarmac"; n]);
    t["heights"] = serde_json::json!(vec![0; n]);
    v["props"] = serde_json::json!([]);
    v["dressing"] = serde_json::json!([]);
    load_json(
        serde_json::to_string(&v).unwrap().as_bytes(),
        &Registry::generic(),
    )
    .expect("the lot loads")
}

#[derive(Clone, Copy, PartialEq)]
enum Line {
    Grip,
    Drift,
    NoCountersteer,
}

struct Run {
    /// The rear tyres' largest slip angle while the handbrake was on (deg), and how long it was on (s).
    rear_slip_deg: f32,
    drift_s: f32,
    /// How long the rear slid past 10° (the meter's real-drift bar) while it was on (s).
    slip10_s: f32,
    along: f32,
    heading_change_deg: f32,
    exit_boosts: u32,
}

fn wrap(a: f32) -> f32 {
    (a + std::f32::consts::PI).rem_euclid(std::f32::consts::TAU) - std::f32::consts::PI
}

fn drive(map: &LoadedMap, line: Line) -> Run {
    let mut sim = Sim::new(map, &Registry::generic(), 1, cruz());
    let car = sim.spawn_grid(1)[0];
    let (x0, z0) = (-120.0, -40.0);
    sim.place_car(
        car,
        SpawnPose {
            x: x0,
            y: 0.1,
            z: z0,
            heading: 0.0,
        },
        0.0,
        [0.0, 0.0, 20.0],
    );
    // Which way a positive steer turns: the target is 90° that way.
    let target = {
        let mut probe = Sim::new(map, &Registry::generic(), 1, cruz());
        let c = probe.spawn_grid(1)[0];
        probe.place_car(
            c,
            SpawnPose {
                x: x0,
                y: 0.1,
                z: z0,
                heading: 0.0,
            },
            0.0,
            [0.0, 0.0, 20.0],
        );
        for _ in 0..S / 4 {
            probe.set_input(
                c,
                DriveInput {
                    steer: quantise_axis(1.0),
                    throttle: quantise_axis(0.5),
                    ..Default::default()
                },
            );
            probe.step();
        }
        let h = probe.car_state(c).unwrap().heading;
        std::f32::consts::FRAC_PI_2 * h.signum()
    };
    let sign = target.signum();
    let mut drifting_done = false;
    let (mut rear_slip_deg, mut drift_ticks, mut slip_ticks) = (0.0f32, 0u64, 0u64);
    for _ in 0..4 * S {
        let st = sim.car_state(car).unwrap();
        let err = wrap(target - st.heading);
        // A player's steer: toward the new heading, proportionally (it countersteers a slide by itself).
        let seek = (err * sign * 2.5).clamp(-1.0, 1.0) * sign;
        let speed = st.forward_speed;
        let input = match line {
            Line::Grip => {
                let turning = err.abs() > 0.15;
                let brake = turning && speed > 12.0;
                DriveInput {
                    steer: quantise_axis(seek),
                    throttle: quantise_axis(if brake { 0.0 } else { 1.0 }),
                    brake: quantise_axis(if brake { 1.0 } else { 0.0 }),
                    ..Default::default()
                }
            }
            Line::Drift => {
                // Handbrake until within 25° of the new heading; then let it go (the exit boost) and drive on.
                if err.abs() < 0.44 {
                    drifting_done = true;
                }
                DriveInput {
                    steer: quantise_axis(seek),
                    throttle: quantise_axis(1.0),
                    drift: !drifting_done,
                    ..Default::default()
                }
            }
            Line::NoCountersteer => DriveInput {
                steer: quantise_axis(sign),
                throttle: quantise_axis(1.0),
                drift: true,
                ..Default::default()
            },
        };
        sim.set_input(car, input);
        sim.step();
        if input.drift {
            drift_ticks += 1;
            let w = sim.wheel_states(car).unwrap();
            let slip = w[2].slip_deg.abs().max(w[3].slip_deg.abs());
            rear_slip_deg = rear_slip_deg.max(slip);
            if slip >= 10.0 {
                slip_ticks += 1;
            }
        }
    }
    let st = sim.car_state(car).unwrap();
    let (dx, dz) = (st.position[0] - x0, st.position[2] - z0);
    Run {
        rear_slip_deg,
        drift_s: drift_ticks as f32 / S as f32,
        slip10_s: slip_ticks as f32 / S as f32,
        along: dx * target.sin() + dz * target.cos(),
        heading_change_deg: wrap(st.heading).to_degrees().abs(),
        exit_boosts: sim.action_state(CarId(car.0)).unwrap().exit_boosts,
    }
}

#[test]
fn a_countersteered_drift_makes_the_corner_and_fires_its_exit_boost_and_without_countersteer_it_spins()
 {
    let map = lot();
    let (grip, drift, spin) = (
        drive(&map, Line::Grip),
        drive(&map, Line::Drift),
        drive(&map, Line::NoCountersteer),
    );
    println!(
        "4 s after a 90° turn from 20 m/s: grip {:.1} m along (heading {:.0}°), drift {:.1} m ({:.0}°, {} exit boost, handbrake {:.2} s, rear slip {:.0}°, past 10° for {:.2} s), no countersteer {:.1} m ({:.0}°)",
        grip.along,
        grip.heading_change_deg,
        drift.along,
        drift.heading_change_deg,
        drift.exit_boosts,
        drift.drift_s,
        drift.rear_slip_deg,
        drift.slip10_s,
        spin.along,
        spin.heading_change_deg
    );
    assert!(
        (70.0..=110.0).contains(&grip.heading_change_deg),
        "grip made the corner"
    );
    assert!(
        (70.0..=110.0).contains(&drift.heading_change_deg),
        "the drift made the corner"
    );
    assert_eq!(
        drift.exit_boosts, 1,
        "letting the handbrake go fired the exit boost"
    );
    // "Faster than grip through the same corner" is the couch's to tune with the tuning menu (drift rear grip, the
    // exit boost): br-gw74.4.1. Today a drift at 20 m/s scrubs more speed than its exit boost gives back.
    assert!(
        drift.along > 0.25 * grip.along,
        "the drift isn't a dead end: {:.1} vs {:.1} m",
        drift.along,
        grip.along
    );
    assert!(
        spin.heading_change_deg > 140.0 || spin.along < grip.along - 10.0,
        "without countersteer it spins or runs wide: {:.0}°, {:.1} m",
        spin.heading_change_deg,
        spin.along
    );
}
