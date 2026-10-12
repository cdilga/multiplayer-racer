//! R120 (owner playtest 1, br-gw74.4): the drift is a tool. On a flat tarmac lot a car at 20 m/s turns 90°, driven the
//! way a player does it (a heading-seeking steer, full throttle):
//! - **grip**: brake to a cornering speed, turn, then flat out;
//! - **drift**: full lock with the handbrake until near the new heading, countersteer (the same heading-seeking steer
//!   catches the slide), then let the handbrake go, which fires the drift-exit boost ("drop a gear and disappear");
//! - **no countersteer**: full lock and the handbrake held regardless, which spins.
//!
//! The drift makes the corner, its exit boost fires and it comes out ahead of grip (br-gw74.4.1); holding the slide
//! without countersteer spins (yaw past the corner by far). A second fixture holds a 3 s drift with countersteer and
//! keeps the yaw rate bounded, and shows the same drift with the wheel held at lock swinging round (AC3 of br-gw74.4).

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{CarId, DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::axis::quantise_axis;

const S: u64 = TICK_HZ as u64;
/// The drivers' feel for the corner: steer easing per rad/s of yaw, and how far ahead (s) the handbrake release looks.
const YAW_DAMP: f32 = 0.4;
const RELEASE_LEAD_S: f32 = 0.2;

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
        // A player's steer: toward the new heading, proportionally, and easing off as the nose swings round (yaw rate).
        let yaw = st.angvel[1];
        let seek = ((err * 2.5 - YAW_DAMP * yaw) * sign).clamp(-1.0, 1.0) * sign;
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
                // Handbrake until the nose, carried on at its yaw rate for `RELEASE_LEAD_S`, is within 25° of the new heading; then let it go (the exit boost) and drive on.
                if (err - RELEASE_LEAD_S * yaw).abs() < 0.44 {
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
    // R120's bar (br-gw74.4.1): the same corner, drifted and boosted, comes out ahead of grip, 4 s in.
    assert!(
        drift.along >= grip.along + 3.0,
        "the drift beats grip by 3 m: {:.1} vs {:.1} m",
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

/// Which way a positive steer turns the car (+1 or -1, the sign of the heading change it produces).
fn turn_sign(map: &LoadedMap) -> f32 {
    let mut sim = Sim::new(map, &Registry::generic(), 1, cruz());
    let car = sim.spawn_grid(1)[0];
    let pose = SpawnPose {
        x: -120.0,
        y: 0.1,
        z: -40.0,
        heading: 0.0,
    };
    sim.place_car(car, pose, 0.0, [0.0, 0.0, 20.0]);
    for _ in 0..S / 4 {
        sim.set_input(
            car,
            DriveInput {
                steer: quantise_axis(1.0),
                throttle: quantise_axis(0.5),
                ..Default::default()
            },
        );
        sim.step();
    }
    sim.car_state(car).unwrap().heading.signum()
}

/// A 3 s handbrake drift from 20 m/s. Full lock turns it in for 0.4 s; then either the wheel stays at lock
/// (`countersteer = false`) or the driver countersteers to hold a steady yaw rate. Returns the largest yaw rate
/// (rad/s), the largest angle between the car's heading and its travel (deg), the rear tyres' largest slip angle (deg)
/// and the speed at the end (m/s).
fn hold_drift(map: &LoadedMap, countersteer: bool) -> (f32, f32, f32, f32) {
    let sign = turn_sign(map);
    let mut sim = Sim::new(map, &Registry::generic(), 1, cruz());
    let car = sim.spawn_grid(1)[0];
    let pose = SpawnPose {
        x: -120.0,
        y: 0.1,
        z: -150.0,
        heading: 0.0,
    };
    sim.place_car(car, pose, 0.0, [0.0, 0.0, 20.0]);
    let (mut max_yaw, mut max_slide, mut rear_slip) = (0.0f32, 0.0f32, 0.0f32);
    for tick in 0..3 * S {
        let yaw = sim.car_state(car).unwrap().angvel[1] * sign;
        // Countersteer: aim for a steady turn rate; steering against a faster swing is the right stick's job.
        let steer = if !countersteer || tick < S * 2 / 5 {
            1.0
        } else {
            ((HOLD_YAW - yaw) * 1.5).clamp(-1.0, 1.0)
        };
        sim.set_input(
            car,
            DriveInput {
                steer: quantise_axis(steer * sign),
                throttle: quantise_axis(1.0),
                drift: true,
                ..Default::default()
            },
        );
        sim.step();
        let st = sim.car_state(car).unwrap();
        max_yaw = max_yaw.max(st.angvel[1].abs());
        let w = sim.wheel_states(car).unwrap();
        rear_slip = rear_slip.max(w[2].slip_deg.abs().max(w[3].slip_deg.abs()));
        if st.linvel[0].hypot(st.linvel[2]) > 3.0 {
            let travel = st.linvel[0].atan2(st.linvel[2]);
            max_slide = max_slide.max(wrap(st.heading - travel).to_degrees().abs());
        }
    }
    let st = sim.car_state(car).unwrap();
    (
        max_yaw,
        max_slide,
        rear_slip,
        st.linvel[0].hypot(st.linvel[2]),
    )
}

/// The steady yaw rate (rad/s) the countersteering driver holds.
const HOLD_YAW: f32 = 1.0;

#[test]
fn holding_countersteer_keeps_the_yaw_rate_bounded_through_a_three_second_drift() {
    let map = lot();
    let (yaw, slide, rear, speed) = hold_drift(&map, true);
    let (yaw_lock, slide_lock, _, speed_lock) = hold_drift(&map, false);
    println!(
        "3 s drift: countersteer max yaw {yaw:.2} rad/s, rear slip {rear:.0}°, slide {slide:.0}°, {speed:.1} m/s at the end; wheel held at lock max yaw {yaw_lock:.2} rad/s, slide {slide_lock:.0}°, {speed_lock:.1} m/s"
    );
    assert!(rear >= 10.0, "it is a real drift: rear slip {rear:.0}°");
    assert!(yaw < 2.0, "the yaw rate stays bounded: {yaw:.2} rad/s");
    assert!(
        slide < 80.0,
        "no spin: the nose stays within {slide:.0}° of travel"
    );
    assert!(
        speed > 5.0,
        "the drift is still a drift, not a stop: {speed:.1} m/s"
    );
    assert!(
        yaw_lock > yaw * 1.2 && slide_lock > slide + 30.0,
        "the same drift with the wheel held at lock swings round harder (yaw {yaw_lock:.2} vs {yaw:.2} rad/s, slide {slide_lock:.0}° vs {slide:.0}°)"
    );
}
