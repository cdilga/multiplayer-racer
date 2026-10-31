//! br-bbki.26 (owner 2026-10-30/31): the arcade cars go where they are pointed at speed, and a lift-off or brake with
//! steer sets the car into a held, easy-to-catch corner-entry slide, for every roster car on the arcade controller.
//! Also the air-control and high-speed-steering asks of the same pass (docs/evidence/br-bbki.26/README.md).
//!
//! Skidpad (flat tarmac, `maps/test/skidpad.json`), the stick driven the way a phone does:
//! - **turn-in:** full steer from straight at 20, 30 and 35 m/s: the yaw rate 0.3 s later against the rate the stick asks
//!   (`Arcade::grip_yaw` with the load shift the held throttle gives), and the peak yaw rate (deg/s);
//! - **entry:** 25 m/s, lift-off (or a brake pulse) with full steer held: seconds to 20 deg of body slip, the range it
//!   holds while the steer is held, and seconds after a full countersteer to under 5 deg.
//!
//! `JJ_EVIDENCE_DIR` writes the table to `handling-bbki26.json`.

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::axis::quantise_axis;

const S: u64 = TICK_HZ as u64;

fn skidpad() -> LoadedMap {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../maps/test/skidpad.json");
    load_json(&std::fs::read(path).unwrap(), &Registry::generic()).expect("the skidpad loads")
}

fn roster() -> Vec<(String, VehicleProfile)> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    VehicleProfile::roster(&root).expect("the roster loads")
}

fn input(steer: f32, throttle: f32, brake: f32) -> DriveInput {
    DriveInput {
        steer: quantise_axis(steer),
        throttle: quantise_axis(throttle),
        brake: quantise_axis(brake),
        ..Default::default()
    }
}

struct Run {
    sim: Sim,
    car: jj_sim::CarId,
}

impl Run {
    fn new(map: &LoadedMap, p: &VehicleProfile, speed: f32) -> Self {
        let mut sim = Sim::new(map, &Registry::generic(), 1, p.clone());
        let car = sim.spawn_grid(1)[0];
        sim.place_car(
            car,
            SpawnPose {
                x: 0.0,
                y: 0.1,
                z: -300.0,
                heading: 0.0,
            },
            0.0,
            [0.0, 0.0, speed],
        );
        Self { sim, car }
    }

    fn step(&mut self, i: DriveInput) -> jj_sim::CarState {
        self.sim.set_input(self.car, i);
        self.sim.step();
        self.sim.car_state(self.car).unwrap()
    }
}

/// Signed body slip (deg): how far the travel is off the nose, + when the nose points left of it; 0 at a crawl.
fn slip(st: &jj_sim::CarState) -> f32 {
    let [vx, _, vz] = st.linvel;
    let speed = libm::hypotf(vx, vz);
    if speed < 2.0 {
        return 0.0;
    }
    let mut d = st.heading - libm::atan2f(vx, vz);
    while d < -std::f32::consts::PI {
        d += std::f32::consts::TAU;
    }
    while d > std::f32::consts::PI {
        d -= std::f32::consts::TAU;
    }
    d.to_degrees()
}

fn hold(speed: f32, target: f32) -> (f32, f32) {
    let e = target - speed;
    if e < -1.0 {
        (0.0, (-e * 0.2).min(1.0))
    } else {
        ((0.4 + e * 0.5).clamp(0.0, 1.0), 0.0)
    }
}

/// Full steer (left) from straight at `v`: (yaw rate at 0.3 s, the rate the stick asks, peak yaw within 0.6 s), deg/s.
fn turn_in(map: &LoadedMap, p: &VehicleProfile, v: f32) -> (f32, f32, f32) {
    let mut r = Run::new(map, p, v);
    let mut st = r.sim.car_state(r.car).unwrap();
    let mut th = 0.0;
    for _ in 0..S / 2 {
        let (t, br) = hold(st.forward_speed, v);
        th = t;
        st = r.step(input(0.0, t, br));
    }
    let (mut at, mut peak, mut sp) = (0.0f32, 0.0f32, v);
    for t in 0..3 * S / 5 {
        let (t2, br) = hold(st.forward_speed, v);
        th = t2;
        st = r.step(input(1.0, t2, br));
        peak = peak.max(st.angvel[1].to_degrees());
        if t + 1 == 3 * S / 10 {
            at = st.angvel[1].to_degrees();
            sp = st.forward_speed;
        }
    }
    let a = p.tuning.arcade.as_ref().expect("an arcade car");
    let ask = a.grip_yaw(
        1.0,
        sp,
        sp,
        p.tuning.max_steer_rad,
        p.tuning.steer_falloff_mps,
        p.wheelbase(),
        1.0,
    ) * a.shift_gain(-th);
    (at, ask.to_degrees(), peak)
}

#[derive(Debug, serde::Serialize)]
struct Entry {
    /// Seconds from the lift/brake + steer to 20 deg of body slip (None: never within 1.5 s).
    to_20_s: Option<f32>,
    /// Smallest and largest body slip while the steer is held, after reaching 20 (deg).
    hold_min_deg: f32,
    hold_max_deg: f32,
    /// Seconds after the countersteer pulse starts until the slip is under 5 deg (None: not within 1.5 s).
    caught_s: Option<f32>,
    min_up_y: f32,
    exit_speed_mps: f32,
}

/// A 25 m/s corner entry: a second of straight, then (lift: throttle off; else a 0.5 s brake pulse) with full steer held
/// for 1.8 s, then a countersteer pulse.
fn entry(map: &LoadedMap, p: &VehicleProfile, brake: bool) -> Entry {
    let mut r = Run::new(map, p, 25.0);
    let mut st = r.sim.car_state(r.car).unwrap();
    let mut min_up = 1.0f32;
    for _ in 0..S {
        let (th, br) = hold(st.forward_speed, 25.0);
        st = r.step(input(0.0, th, br));
    }
    let (mut to20, mut lo, mut hi) = (None, f32::MAX, f32::MIN);
    let hold_ticks = 9 * S / 5;
    for t in 0..hold_ticks {
        let b = if brake && t < S / 2 { 0.6 } else { 0.0 };
        st = r.step(input(1.0, 0.0, b));
        min_up = min_up.min(st.up_y);
        let a = slip(&st);
        if std::env::var("JJ_TRACE").is_ok() && t % 12 == 0 {
            eprintln!(
                "t {t} slip {a:.1} yaw {:.1} v {:.1}",
                st.angvel[1].to_degrees(),
                st.forward_speed
            );
        }
        if to20.is_none() && a > 20.0 {
            to20 = Some((t + 1) as f32 / S as f32);
        }
        if to20.is_some() {
            lo = lo.min(a);
            hi = hi.max(a);
        }
    }
    let mut caught = None;
    for t in 0..3 * S / 2 {
        st = r.step(input(if t < S / 5 { -1.0 } else { 0.0 }, 0.0, 0.0));
        min_up = min_up.min(st.up_y);
        if std::env::var("JJ_TRACE").is_ok() && t % 12 == 0 {
            eprintln!(
                "c {t} slip {:.1} yaw {:.1}",
                slip(&st),
                st.angvel[1].to_degrees()
            );
        }
        if slip(&st).abs() < 5.0 {
            caught.get_or_insert((t + 1) as f32 / S as f32);
        } else {
            caught = None;
        }
    }
    Entry {
        to_20_s: to20,
        hold_min_deg: lo,
        hold_max_deg: hi,
        caught_s: caught,
        min_up_y: min_up,
        exit_speed_mps: st.forward_speed,
    }
}

#[derive(Debug, serde::Serialize)]
struct Row {
    car: String,
    /// [20, 30, 35] m/s: yaw at 0.3 s, asked, peak (deg/s).
    turn_in_deg_s: [[f32; 3]; 3],
    entry_lift: Entry,
    entry_brake: Entry,
}

#[test]
fn full_steer_turns_the_car_promptly_and_a_lift_or_brake_sets_a_held_catchable_entry_slide() {
    let map = skidpad();
    let mut rows = vec![];
    for (id, p) in roster()
        .into_iter()
        .filter(|(_, p)| p.tuning.arcade.is_some())
    {
        let t = [20.0, 30.0, 35.0].map(|v| {
            let (a, b, c) = turn_in(&map, &p, v);
            [a, b, c]
        });
        rows.push(Row {
            car: id,
            turn_in_deg_s: t,
            entry_lift: entry(&map, &p, false),
            entry_brake: entry(&map, &p, true),
        });
    }
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            format!("{dir}/handling-bbki26.json"),
            serde_json::to_string_pretty(&rows).unwrap(),
        )
        .unwrap();
    }
    for r in &rows {
        eprintln!(
            "{:16} turn-in(at .3s, asked, peak) 20: {:?} 30: {:?} 35: {:?}",
            r.car, r.turn_in_deg_s[0], r.turn_in_deg_s[1], r.turn_in_deg_s[2]
        );
        eprintln!("{:16} lift  {:?}", "", r.entry_lift);
        eprintln!("{:16} brake {:?}", "", r.entry_brake);
    }
    let mut fails = vec![];
    for r in &rows {
        for (k, v) in [20, 30].iter().enumerate() {
            let [at, ask, _] = r.turn_in_deg_s[k];
            if (at - ask).abs() > 0.1 * ask {
                fails.push(format!(
                    "{}: yaw {at:.1} vs asked {ask:.1} at {v} m/s",
                    r.car
                ));
            }
        }
        for (name, e) in [("lift", &r.entry_lift), ("brake", &r.entry_brake)] {
            if !e.to_20_s.is_some_and(|t| t <= 0.6) {
                fails.push(format!("{} {name}: 20 deg in {:?}", r.car, e.to_20_s));
            }
            if e.hold_min_deg < 15.0 || e.hold_max_deg > 35.0 {
                fails.push(format!(
                    "{} {name}: holds {:.1}..{:.1}",
                    r.car, e.hold_min_deg, e.hold_max_deg
                ));
            }
            if !e.caught_s.is_some_and(|t| t < 1.0) {
                fails.push(format!("{} {name}: caught {:?}", r.car, e.caught_s));
            }
            if e.min_up_y < 0.95 {
                fails.push(format!("{} {name}: up {:.2}", r.car, e.min_up_y));
            }
        }
    }
    assert!(fails.is_empty(), "{fails:#?}");
}

/// Thrown up from 30 m at 20 m/s (a long flight), the stick neutral for 0.4 s and then held: the largest body yaw rate
/// (full steer) and pitch rate (full throttle) the air control gives within 0.6 s of the stick moving, deg/s.
fn air_rates(map: &LoadedMap, p: &VehicleProfile) -> (f32, f32) {
    let rate = |steer: f32, throttle: f32| {
        let mut r = Run::new(map, p, 20.0);
        r.sim.place_car(
            r.car,
            SpawnPose {
                x: 0.0,
                y: 30.0,
                z: -300.0,
                heading: 0.0,
            },
            0.0,
            [0.0, 1.0, 20.0],
        );
        for _ in 0..2 * S / 5 {
            r.step(input(0.0, 0.0, 0.0));
        }
        let mut peak = 0.0f32;
        for _ in 0..3 * S / 5 {
            let st = r.step(input(steer, throttle, 0.0));
            let w = st.angvel;
            peak = peak.max(if steer != 0.0 { w[1].abs() } else { w[0].abs() }.to_degrees());
        }
        peak
    };
    (rate(1.0, 0.0), rate(0.0, 1.0))
}

#[test]
fn air_control_turns_the_car_in_flight_gently() {
    let map = skidpad();
    let mut table = vec![];
    for (id, p) in roster() {
        let (yaw, pitch) = air_rates(&map, &p);
        eprintln!("{id:16} air yaw {yaw:.1} deg/s, pitch {pitch:.1} deg/s");
        table.push((id, yaw, pitch));
        // br-bbki.26: a car in the air turns noticeably less than the 90 / 100 deg/s of before (owner 2026-10-31).
        assert!(yaw <= 60.0, "air yaw {yaw:.1} deg/s");
        assert!(pitch <= 80.0, "air pitch {pitch:.1} deg/s");
        assert!(
            yaw >= 25.0 && pitch >= 25.0,
            "air control still answers: {yaw:.1} {pitch:.1}"
        );
    }
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            format!("{dir}/air-bbki26.json"),
            serde_json::to_string_pretty(&table).unwrap(),
        )
        .unwrap();
    }
}
