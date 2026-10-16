//! P1-FL04.2 arcade feel bank (R136, R138): the shipped cars on the arcade controller against the Cruz as it was before
//! (Rapier's own side friction, rear drive, the 0.55 / (1 + v / 25) steer falloff), on the flat 1 km tarmac skidpad
//! (`maps/test/skidpad.json`). Each run drives the stick the way a phone does and reads the car each tick:
//!
//! - **steady:** full lock at a held 10, 20 and 30 m/s, mean yaw rate over the last second of three;
//! - **turn-in:** a full-lock throw from straight at 20 and 30 m/s, the yaw rate 0.25 s later and its peak in 0.5 s;
//! - **punch:** at 6 m/s, coasting with full lock for 0.4 s, then the throttle punched to full for 1 s: the rear tyres'
//!   largest slip angle, the heading turned, then the catch (stick centred, throttle eased): seconds until the drift
//!   angle is under 5° and the yaw under 15 deg/s;
//! - **lift-off:** a 0.6-lock corner at 22 m/s on full throttle, then lifted: the yaw-rate gain over 0.5 s against
//!   staying on it;
//! - **recovery:** a full-lock throw at 25 m/s for 1.5 s, then the stick centred: seconds until the yaw stays under
//!   5 deg/s, and the lowest up-y over the run.
//!
//! Set `JJ_EVIDENCE_DIR` to write the table (`arcade-bank.json`); `JJ_ARCADE="turn_g=2.5,…"` tries arcade values on
//! every new car without a rebuild.

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::profile::Drive;
use jj_sim::{DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::axis::quantise_axis;

const S: u64 = TICK_HZ as u64;

fn skidpad() -> LoadedMap {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../maps/test/skidpad.json");
    load_json(&std::fs::read(path).unwrap(), &Registry::generic()).expect("the skidpad loads")
}

/// The Cruz as it was before FL04.2: rear drive, no arcade controller.
fn before() -> VehicleProfile {
    let mut p = VehicleProfile::cruz();
    p.tuning.arcade = None;
    p.tuning.drive = Drive::Rear;
    // As shipped before FL04.2 (the arcade Cruz eases its lock from 18 m/s).
    p.tuning.steer_falloff_mps = 25.0;
    p
}

fn tuned(mut p: VehicleProfile) -> VehicleProfile {
    if let Ok(tune) = std::env::var("JJ_ARCADE") {
        let mut v = serde_json::to_value(p.tuning.arcade.take().unwrap()).unwrap();
        for kv in tune.split(',').filter(|s| !s.is_empty()) {
            let (k, val) = kv.split_once('=').expect("JJ_ARCADE is field=value,…");
            v[k] = serde_json::from_str(val).expect("a JSON value");
        }
        p.tuning.arcade = Some(serde_json::from_value(v).expect("valid arcade"));
    }
    p
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

    fn rear_slip(&self) -> f32 {
        let w = self.sim.wheel_states(self.car).unwrap();
        w[w.len() / 2..]
            .iter()
            .filter(|w| w.in_contact)
            .map(|w| w.slip_deg.abs())
            .fold(0.0, f32::max)
    }
}

/// The drift angle (deg): how far the travel is off the nose, 0 at a crawl.
fn angle(st: &jj_sim::CarState) -> f32 {
    let [vx, _, vz] = st.linvel;
    let speed = libm::hypotf(vx, vz);
    if speed < 2.0 {
        return 0.0;
    }
    let lateral = speed * libm::sinf(libm::atan2f(vx, vz) - st.heading);
    libm::atan2f(lateral.abs(), st.forward_speed.abs()).to_degrees()
}

fn hold(speed: f32, target: f32) -> (f32, f32) {
    let e = target - speed;
    if e < -1.0 {
        (0.0, (-e * 0.2).min(1.0))
    } else {
        ((0.4 + e * 0.5).clamp(0.0, 1.0), 0.0)
    }
}

fn steady(map: &LoadedMap, p: &VehicleProfile, v: f32) -> (f32, f32) {
    let mut r = Run::new(map, p, v);
    let (mut sum, mut speed) = (0.0, 0.0);
    let mut st = r.sim.car_state(r.car).unwrap();
    for t in 0..3 * S {
        let (th, br) = hold(st.forward_speed, v);
        st = r.step(input(1.0, th, br));
        if t >= 2 * S {
            sum += st.angvel[1].abs().to_degrees();
            speed += st.forward_speed;
        }
    }
    (sum / S as f32, speed / S as f32)
}

/// A full-lock throw from straight at `v`: the yaw rate at 0.25 s and its peak within 0.5 s (deg/s).
fn turn_in(map: &LoadedMap, p: &VehicleProfile, v: f32) -> (f32, f32) {
    let mut r = Run::new(map, p, v);
    let mut st = r.sim.car_state(r.car).unwrap();
    for _ in 0..S / 2 {
        let (th, br) = hold(st.forward_speed, v);
        st = r.step(input(0.0, th, br));
    }
    let (mut at, mut peak) = (0.0, 0.0f32);
    for t in 0..S / 2 {
        let (th, br) = hold(st.forward_speed, v);
        st = r.step(input(1.0, th, br));
        let yaw = st.angvel[1].abs().to_degrees();
        peak = peak.max(yaw);
        if t + 1 == S / 4 {
            at = yaw;
        }
    }
    (at, peak)
}

/// The throttle punch at 6 m/s: (largest rear slip deg, heading turned deg) over the punch's second, then the catch's
/// seconds (`None`: not within 1.5 s) and the lowest up-y.
fn punch(map: &LoadedMap, p: &VehicleProfile) -> (f32, f32, Option<f32>, f32) {
    let mut r = Run::new(map, p, 6.0);
    let mut st = r.sim.car_state(r.car).unwrap();
    let mut min_up = 1.0f32;
    for _ in 0..2 * S / 5 {
        st = r.step(input(1.0, 0.0, 0.0));
    }
    let h0 = st.heading;
    let (mut slip, mut turned) = (0.0f32, 0.0f32);
    for _ in 0..S {
        st = r.step(input(1.0, 1.0, 0.0));
        slip = slip.max(r.rear_slip());
        min_up = min_up.min(st.up_y);
    }
    let mut d = st.heading - h0;
    while d < -std::f32::consts::PI {
        d += std::f32::consts::TAU;
    }
    turned = turned.max(d.abs().to_degrees());
    let mut caught = None;
    for t in 0..3 * S / 2 {
        st = r.step(input(0.0, 0.3, 0.0));
        min_up = min_up.min(st.up_y);
        if angle(&st) < 5.0 && st.angvel[1].abs().to_degrees() < 15.0 {
            caught.get_or_insert(t as f32 / S as f32);
        } else {
            caught = None;
        }
    }
    (slip, turned, caught, min_up)
}

fn lift_off(map: &LoadedMap, p: &VehicleProfile) -> f32 {
    let yaw_after = |lift: bool| {
        let mut r = Run::new(map, p, 22.0);
        for _ in 0..S {
            r.step(input(0.6, 1.0, 0.0));
        }
        let mut st = r.sim.car_state(r.car).unwrap();
        for _ in 0..S / 2 {
            st = r.step(input(0.6, if lift { 0.0 } else { 1.0 }, 0.0));
        }
        st.angvel[1].abs().to_degrees()
    };
    yaw_after(true) - yaw_after(false)
}

fn recovery(map: &LoadedMap, p: &VehicleProfile) -> (Option<f32>, f32) {
    let mut r = Run::new(map, p, 25.0);
    let mut min_up = 1.0f32;
    for _ in 0..3 * S / 2 {
        min_up = min_up.min(r.step(input(1.0, 0.5, 0.0)).up_y);
    }
    let mut settled = None;
    for t in 0..3 * S / 2 {
        let st = r.step(input(0.0, 0.3, 0.0));
        min_up = min_up.min(st.up_y);
        if st.angvel[1].abs().to_degrees() < 5.0 {
            settled.get_or_insert(t as f32 / S as f32);
        } else {
            settled = None;
        }
    }
    (settled, min_up)
}

#[derive(serde::Serialize)]
struct Row {
    car: String,
    drive: String,
    steady_yaw_deg_s: [f32; 3],
    steady_speed_mps: [f32; 3],
    turn_in_quarter_s_deg_s: [f32; 2],
    turn_in_peak_deg_s: [f32; 2],
    punch_rear_slip_deg: f32,
    punch_turned_deg: f32,
    punch_caught_s: Option<f32>,
    lift_off_gain_deg_s: f32,
    recovery_s: Option<f32>,
    min_up_y: f32,
}

fn row(map: &LoadedMap, car: &str, p: &VehicleProfile) -> Row {
    let s: Vec<(f32, f32)> = [10.0, 20.0, 30.0]
        .iter()
        .map(|&v| steady(map, p, v))
        .collect();
    let (t20, t30) = (turn_in(map, p, 20.0), turn_in(map, p, 30.0));
    let (punch_rear_slip_deg, punch_turned_deg, punch_caught_s, up_punch) = punch(map, p);
    let (recovery_s, up_rec) = recovery(map, p);
    Row {
        car: car.to_owned(),
        drive: format!("{:?}", p.tuning.drive),
        steady_yaw_deg_s: [s[0].0, s[1].0, s[2].0],
        steady_speed_mps: [s[0].1, s[1].1, s[2].1],
        turn_in_quarter_s_deg_s: [t20.0, t30.0],
        turn_in_peak_deg_s: [t20.1, t30.1],
        punch_rear_slip_deg,
        punch_turned_deg,
        punch_caught_s,
        lift_off_gain_deg_s: lift_off(map, p),
        recovery_s,
        min_up_y: up_punch.min(up_rec),
    }
}

#[test]
fn the_arcade_cars_hold_their_feel_envelopes() {
    let map = skidpad();
    let rows = vec![
        row(&map, "before (Cruz, Rapier, RWD)", &before()),
        row(&map, "cruz-missile", &tuned(VehicleProfile::cruz())),
        row(&map, "tradie-ute", &tuned(VehicleProfile::tradie_ute())),
    ];
    let table = serde_json::to_string_pretty(&rows).unwrap();
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(format!("{dir}/arcade-bank.json"), &table).unwrap();
    }
    for r in &rows {
        eprintln!(
            "{:28} {:5} steady {:5.1} {:5.1} {:5.1} deg/s @ {:4.1} {:4.1} {:4.1} | turn-in .25s {:5.1} {:5.1} peak {:5.1} {:5.1} | punch slip {:5.1} turned {:5.1} caught {:?} | lift +{:5.1} | recover {:?} up {:.2}",
            r.car,
            r.drive,
            r.steady_yaw_deg_s[0],
            r.steady_yaw_deg_s[1],
            r.steady_yaw_deg_s[2],
            r.steady_speed_mps[0],
            r.steady_speed_mps[1],
            r.steady_speed_mps[2],
            r.turn_in_quarter_s_deg_s[0],
            r.turn_in_quarter_s_deg_s[1],
            r.turn_in_peak_deg_s[0],
            r.turn_in_peak_deg_s[1],
            r.punch_rear_slip_deg,
            r.punch_turned_deg,
            r.punch_caught_s,
            r.lift_off_gain_deg_s,
            r.recovery_s,
            r.min_up_y
        );
    }
    let (old, cruz, ute) = (&rows[0], &rows[1], &rows[2]);
    // The roster's drivetrains match their real counterparts: the Cruze is front-driven, the ute rear-driven.
    assert_eq!(cruz.drive, "Front");
    assert_eq!(ute.drive, "Rear");
    // AC2: the FWD Cruz turns in at least twice as hard as before at 20 and 30 m/s (28 deg/s at 30 before), and its
    // steady turn at least doubles too: no heavy understeer.
    for k in 0..2 {
        assert!(
            cruz.turn_in_peak_deg_s[k] >= 2.0 * old.turn_in_peak_deg_s[k],
            "Cruz turn-in at {} m/s: {:.1} vs before {:.1}",
            [20, 30][k],
            cruz.turn_in_peak_deg_s[k],
            old.turn_in_peak_deg_s[k]
        );
        assert!(
            cruz.steady_yaw_deg_s[k + 1] >= 2.0 * old.steady_yaw_deg_s[k + 1],
            "Cruz steady at {} m/s: {:.1} vs before {:.1}",
            [20, 30][k],
            cruz.steady_yaw_deg_s[k + 1],
            old.steady_yaw_deg_s[k + 1]
        );
    }
    // AC2: the RWD punch at 6 m/s swings the tail out past 25° within the second and rotates the car; easing off and
    // centring catches it within a second.
    assert!(
        ute.punch_rear_slip_deg > 25.0,
        "Ute punch rear slip {:.1}",
        ute.punch_rear_slip_deg
    );
    assert!(
        ute.punch_turned_deg > 60.0,
        "Ute punch turned {:.1}",
        ute.punch_turned_deg
    );
    assert!(
        ute.punch_caught_s.is_some_and(|t| t < 1.0),
        "Ute catch {:?}",
        ute.punch_caught_s
    );
    // The FWD Cruz doesn't swing its tail on the same punch: it just pulls.
    assert!(
        cruz.punch_rear_slip_deg < 15.0,
        "Cruz punch rear slip {:.1}",
        cruz.punch_rear_slip_deg
    );
    for r in &rows[1..] {
        let id = &r.car;
        // Turning keeps the speed it was asked to hold (big readable speed).
        for k in 0..3 {
            assert!(
                (r.steady_speed_mps[k] - [10.0, 20.0, 30.0][k]).abs() < 1.5,
                "{id}: held speed {k}: {:.1}",
                r.steady_speed_mps[k]
            );
        }
        // Lifting off mid-corner tucks the nose in.
        assert!(
            r.lift_off_gain_deg_s > 3.0,
            "{id}: lift-off {:.1}",
            r.lift_off_gain_deg_s
        );
        // A full-lock throw at 25 m/s is caught within 0.5 s of centring, and nothing ever leans past 18°.
        assert!(
            r.recovery_s.is_some_and(|t| t < 0.5),
            "{id}: recovery {:?}",
            r.recovery_s
        );
        assert!(r.min_up_y > 0.95, "{id}: min up {:.2}", r.min_up_y);
    }
}
