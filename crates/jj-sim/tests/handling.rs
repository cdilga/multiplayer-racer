//! P1-FL04 handling bank (R128): every arcade handling preset (Kart, Rally, Hooligan) on every drivetrain (rear, front,
//! all), against the Cruz Missile as it was (Rapier's own side friction), on a flat 1 km tarmac skidpad
//! (`maps/test/skidpad.json`). Each run drives the stick the way a phone does and reads the car's state each tick:
//!
//! - **steady:** full lock at a held 10, 20 and 30 m/s (a speed-holding throttle), the mean yaw rate over the last
//!   second of three;
//! - **lift-off:** a 0.6-lock corner at 22 m/s on full throttle, then the throttle let go: the yaw rate's gain over the
//!   next half second against the same corner kept on the throttle;
//! - **power:** full lock at the limit at 15 m/s, then floored against held for a second: the rear tyres' largest slip
//!   angle and the mean yaw rate (rear drive steps out and rotates, front drive pushes);
//! - **recovery:** a full-lock throw at 25 m/s for 1.5 s, then the stick centred: the yaw rate must die within 1.5 s and
//!   the car stay upright.
//!
//! Set `JJ_EVIDENCE_DIR` to write the table (`handling-bank.json`); the envelopes below are its accepted numbers.

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::profile::Drive;
use jj_sim::vehicle::handling::Handling;
use jj_sim::{DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::axis::quantise_axis;

const S: u64 = TICK_HZ as u64;

fn skidpad() -> LoadedMap {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../maps/test/skidpad.json");
    load_json(&std::fs::read(path).unwrap(), &Registry::generic()).expect("the skidpad loads")
}

/// The Cruz with a handling preset (`None`: as before FL04) and a drivetrain.
fn car(handling: Option<&str>, drive: Drive) -> VehicleProfile {
    let mut p = VehicleProfile::cruz();
    p.tuning.handling = handling.map(|id| tuned(Handling::preset(id).expect("a preset")));
    p.tuning.drive = drive;
    p
}

/// `JJ_HANDLING="yaw_rate_deg_s=0,rear_grip=0.9"` tries handling values on every preset without a rebuild.
fn tuned(h: Handling) -> Handling {
    let Ok(tune) = std::env::var("JJ_HANDLING") else {
        return h;
    };
    let mut v = serde_json::to_value(h).unwrap();
    for kv in tune.split(',').filter(|s| !s.is_empty()) {
        let (k, val) = kv.split_once('=').expect("JJ_HANDLING is field=value,…");
        v[k] = serde_json::from_str(val).expect("a JSON value");
    }
    serde_json::from_value(v).expect("valid handling")
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

    /// The rear wheels' largest slip angle this tick (deg, wheels in contact).
    fn rear_slip(&self) -> f32 {
        let w = self.sim.wheel_states(self.car).unwrap();
        w[w.len() / 2..]
            .iter()
            .filter(|w| w.in_contact)
            .map(|w| w.slip_deg.abs())
            .fold(0.0, f32::max)
    }
}

/// A throttle that holds `target` m/s.
fn hold(speed: f32, target: f32) -> (f32, f32) {
    let e = target - speed;
    if e < -1.0 {
        (0.0, (-e * 0.2).min(1.0))
    } else {
        ((0.4 + e * 0.5).clamp(0.0, 1.0), 0.0)
    }
}

/// Mean |yaw rate| (deg/s) over the last second of 3 s at full lock, holding `v` m/s; and the speed it held.
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

/// Yaw-rate gain (deg/s) over 0.5 s after lifting off mid-corner, less the same with the throttle kept on.
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

/// Full lock at the limit (15 m/s held for 1 s), then 1 s of full throttle against 1 s more of the held speed: the
/// rear tyres' largest slip (deg), the mean yaw rate (deg/s) and the body's mean sideslip (deg, how far the car's
/// travel is off its nose) over that second, `(floored, held)` each.
fn power(map: &LoadedMap, p: &VehicleProfile) -> ([f32; 2], [f32; 2], [f32; 2]) {
    let go = |floor: bool| {
        let mut r = Run::new(map, p, 15.0);
        let mut st = r.sim.car_state(r.car).unwrap();
        for _ in 0..S {
            let (th, br) = hold(st.forward_speed, 15.0);
            st = r.step(input(1.0, th, br));
        }
        let (mut slip, mut yaw, mut beta) = (0.0f32, 0.0f32, 0.0f32);
        for _ in 0..S {
            let (th, br) = if floor {
                (1.0, 0.0)
            } else {
                hold(st.forward_speed, 15.0)
            };
            st = r.step(input(1.0, th, br));
            slip = slip.max(r.rear_slip());
            yaw += st.angvel[1].abs().to_degrees() / S as f32;
            let [vx, _, vz] = st.linvel;
            let lateral = libm::hypotf(vx, vz) * libm::sinf(libm::atan2f(vx, vz) - st.heading);
            beta += libm::atan2f(lateral.abs(), st.forward_speed.abs()).to_degrees() / S as f32;
        }
        (slip, yaw, beta)
    };
    let (f, h) = (go(true), go(false));
    ([f.0, h.0], [f.1, h.1], [f.2, h.2])
}

/// Seconds after centring the stick until |yaw rate| stays under 5 deg/s (`None`: not within 1.5 s); the lowest up-y.
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
    preset: String,
    drive: String,
    steady_yaw_deg_s: [f32; 3],
    steady_speed_mps: [f32; 3],
    lift_off_gain_deg_s: f32,
    power_rear_slip_deg: [f32; 2],
    power_yaw_deg_s: [f32; 2],
    power_sideslip_deg: [f32; 2],
    recovery_s: Option<f32>,
    min_up_y: f32,
}

fn row(map: &LoadedMap, preset: Option<&str>, drive: Drive) -> Row {
    let p = car(preset, drive);
    let s: Vec<(f32, f32)> = [10.0, 20.0, 30.0]
        .iter()
        .map(|&v| steady(map, &p, v))
        .collect();
    let (power_rear_slip_deg, power_yaw_deg_s, power_sideslip_deg) = power(map, &p);
    let (recovery_s, min_up_y) = recovery(map, &p);
    Row {
        preset: preset.unwrap_or("before").to_owned(),
        drive: format!("{drive:?}"),
        steady_yaw_deg_s: [s[0].0, s[1].0, s[2].0],
        steady_speed_mps: [s[0].1, s[1].1, s[2].1],
        lift_off_gain_deg_s: lift_off(map, &p),
        power_rear_slip_deg,
        power_yaw_deg_s,
        power_sideslip_deg,
        recovery_s,
        min_up_y,
    }
}

#[test]
fn every_preset_and_drivetrain_holds_its_handling_envelopes() {
    let map = skidpad();
    let mut rows = vec![row(&map, None, Drive::Rear)];
    for (id, _) in Handling::presets() {
        for drive in [Drive::Rear, Drive::Front, Drive::All] {
            rows.push(row(&map, Some(&id), drive));
        }
    }
    let table = serde_json::to_string_pretty(&rows).unwrap();
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(format!("{dir}/handling-bank.json"), &table).unwrap();
    }
    for r in &rows {
        eprintln!(
            "{:9} {:5} steady {:5.1} {:5.1} {:5.1} deg/s @ {:4.1} {:4.1} {:4.1} m/s | lift +{:5.1} | power slip {:5.1}/{:5.1} yaw {:5.1}/{:5.1} beta {:4.1}/{:4.1} | recover {:?} up {:.2}",
            r.preset,
            r.drive,
            r.steady_yaw_deg_s[0],
            r.steady_yaw_deg_s[1],
            r.steady_yaw_deg_s[2],
            r.steady_speed_mps[0],
            r.steady_speed_mps[1],
            r.steady_speed_mps[2],
            r.lift_off_gain_deg_s,
            r.power_rear_slip_deg[0],
            r.power_rear_slip_deg[1],
            r.power_yaw_deg_s[0],
            r.power_yaw_deg_s[1],
            r.power_sideslip_deg[0],
            r.power_sideslip_deg[1],
            r.recovery_s,
            r.min_up_y
        );
    }
    let before = &rows[0];
    let find = |preset: &str, drive: &str| {
        rows.iter()
            .find(|r| r.preset == preset && r.drive == drive)
            .unwrap()
    };
    // AC2: the understeer fix, measured against the car as it was in the same harness (28 deg/s at 30 m/s).
    let kart = find("kart", "Rear");
    assert!(
        kart.steady_yaw_deg_s[2] >= 2.0 * before.steady_yaw_deg_s[2],
        "Kart at 30 m/s turns {:.1} deg/s, under 2x the old {:.1}",
        kart.steady_yaw_deg_s[2],
        before.steady_yaw_deg_s[2]
    );
    for r in &rows[1..] {
        let id = format!("{} {}", r.preset, r.drive);
        // Every preset turns harder than the old car at 20 and 30 m/s and holds the speed it was asked for.
        for k in 1..3 {
            assert!(
                r.steady_yaw_deg_s[k] > before.steady_yaw_deg_s[k],
                "{id}: steady yaw {k}"
            );
            assert!(
                (r.steady_speed_mps[k] - [10.0, 20.0, 30.0][k]).abs() < 1.0,
                "{id}: held speed"
            );
        }
        // Lifting off mid-corner rotates the car.
        assert!(
            r.lift_off_gain_deg_s > 8.0,
            "{id}: lift-off {:.1}",
            r.lift_off_gain_deg_s
        );
        // A full-lock throw at 25 m/s is caught within 0.6 s of centring the stick, upright.
        assert!(
            r.recovery_s.is_some_and(|t| t < 0.6),
            "{id}: recovery {:?}",
            r.recovery_s
        );
        assert!(r.min_up_y > 0.95, "{id}: min up {:.2}", r.min_up_y);
    }
    for preset in ["kart", "rally", "hooligan"] {
        let (rwd, fwd) = (find(preset, "Rear"), find(preset, "Front"));
        // Power oversteer: floored at the limit, the rear-driven car's rear slips more than the front-driven one's.
        assert!(
            rwd.power_rear_slip_deg[0] > fwd.power_rear_slip_deg[0],
            "{preset}: RWD rear slip {:.1} vs FWD {:.1}",
            rwd.power_rear_slip_deg[0],
            fwd.power_rear_slip_deg[0]
        );
        // FWD push: floored, the front-driven car turns slower than the rear-driven one (Rally, Hooligan); the Kart is
        // planted by design, its drivetrains within 5 %.
        let (r, f) = (rwd.power_yaw_deg_s[0], fwd.power_yaw_deg_s[0]);
        if preset == "kart" {
            assert!(
                (f - r).abs() / r < 0.05,
                "kart: FWD {f:.1} vs RWD {r:.1} under power"
            );
        } else {
            assert!(f < r, "{preset}: FWD {f:.1} not pushing against RWD {r:.1}");
        }
    }
}

/// AC4: the autopilot (bots, dropouts) takes the Cruz round three laps of the greybox unaided on every preset.
#[test]
fn the_autopilot_finishes_three_laps_on_every_preset() {
    let map = load_json(
        include_str!("../../../maps/greybox-loop.json").as_bytes(),
        &Registry::generic(),
    )
    .expect("the greybox loads");
    for (id, _) in Handling::presets() {
        let mut s = Sim::new(&map, &Registry::generic(), 5, car(Some(&id), Drive::Rear));
        let c = s.spawn_grid(1)[0];
        s.start_race(3);
        s.set_autopilot(c, true);
        while !s.race().is_finished(c.0) && s.tick() < 300 * S {
            s.step();
        }
        let rc = s.race().car(c.0).unwrap();
        assert!(
            rc.finished_at.is_some(),
            "{id}: three laps in {} s",
            s.tick() / S
        );
        assert_eq!((rc.wrecks, rc.recoveries), (0, 0), "{id}: unaided");
        eprintln!("{id}: three laps in {:.1} s", s.tick() as f32 / S as f32);
    }
}

/// Presets switch live: a running car takes a new handling between ticks (the Feel Lab, FL03) and keeps driving.
#[test]
fn a_preset_switches_mid_run() {
    let map = skidpad();
    let mut r = Run::new(&map, &car(None, Drive::Rear), 20.0);
    for (k, (_, h)) in Handling::presets().into_iter().enumerate() {
        let mut t = r.sim.profile().tuning.clone();
        t.handling = Some(h);
        r.sim.set_tuning(t);
        for _ in 0..S {
            let st = r.step(input(if k % 2 == 0 { 1.0 } else { -1.0 }, 0.6, 0.0));
            assert!(st.up_y > 0.95 && st.forward_speed > 5.0);
        }
    }
}
