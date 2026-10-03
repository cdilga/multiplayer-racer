//! P1-S07: the autopilot on the greybox.
//! - It completes three laps unaided, then coasts its cool-down on autopilot.
//! - Handback on fresh deliberate input blends at a tick boundary with no jolt (no yaw or acceleration spike in the
//!   signature); a heartbeat or a noisy axis isn't deliberate.
//! - It recovers itself after being stuck 3 s, and its state (target, look-ahead) is introspectable.

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::autopilot::{
    HANDBACK_TICKS, MAX_SPEED, MIN_LOOK_AHEAD_M, MIN_SPEED, Mode, STUCK_TICKS, is_deliberate,
};
use jj_sim::race::{Event, Respawned};
use jj_sim::{CarId, DriveInput, Journal, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::axis::{dequantise_axis, quantise_axis};

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
const S: u64 = TICK_HZ as u64;

fn greybox() -> LoadedMap {
    load_json(GREYBOX.as_bytes(), &Registry::generic()).expect("the greybox validates")
}

fn sim(map: &LoadedMap, seed: u64) -> Sim {
    Sim::new(map, &Registry::generic(), seed, VehicleProfile::cruz())
}

fn input(throttle: f32, steer: f32, brake: f32) -> DriveInput {
    DriveInput {
        throttle: quantise_axis(throttle),
        steer: quantise_axis(steer),
        brake: quantise_axis(brake),
    }
}

#[test]
fn the_autopilot_completes_three_laps_unaided_then_cools_down() {
    let map = greybox();
    for seed in [5, 6, 7] {
        let mut s = sim(&map, seed);
        let car = s.spawn_grid(1)[0];
        s.start_race(3);
        s.set_autopilot(car, true);
        while !s.race().is_finished(car.0) && s.tick() < 300 * S {
            s.step();
        }
        let rc = s.race().car(car.0).unwrap();
        assert!(
            rc.finished_at.is_some(),
            "seed {seed}: three laps in {} s",
            s.tick() / S
        );
        assert_eq!(
            (s.race().laps_completed(car.0), rc.wrecks, rc.recoveries),
            (3, 0, 0),
            "seed {seed}: unaided"
        );
        // A finished car coasts its cool-down on autopilot.
        for _ in 0..(5 * S) {
            s.step();
        }
        assert_eq!(s.autopilot_state(car).map(|a| a.mode), Some(Mode::CoolDown));
        assert!(
            s.car_state(car).unwrap().forward_speed > 2.0,
            "seed {seed}: still moving on its cool-down lap"
        );
    }
}

#[test]
fn handback_blends_at_a_tick_boundary_with_no_jolt() {
    let map = greybox();
    let mut s = sim(&map, 8);
    let car = s.spawn_grid(1)[0];
    s.start_race(3);
    s.set_autopilot(car, true);
    // Drive until the autopilot is cornering hard: the worst moment to let go of the wheel.
    while s.autopilot_state(car).is_none_or(|a| a.steer.abs() < 0.3) {
        s.step();
        assert!(s.tick() < 60 * S, "the autopilot never cornered");
    }
    // The yaw rate and forward speed per tick, to look for a spike.
    let sample = |s: &Sim| {
        let st = s.car_state(car).unwrap();
        (st.angvel[1].to_degrees(), st.forward_speed)
    };
    let mut before = Vec::new();
    for _ in 0..(S / 2) {
        s.step();
        before.push(sample(&s));
    }
    let autopilot_steer = dequantise_axis(s.applied_input(car).unwrap().steer);
    // The player comes back with a different, deliberate input: straight ahead, light throttle.
    let player = input(0.4, 0.0, 0.0);
    assert!(is_deliberate(s.applied_input(car).unwrap(), player));
    s.set_input(car, player);
    s.set_autopilot(car, false);
    let at = s.tick();
    let mut steers = vec![autopilot_steer];
    let mut during = Vec::new();
    for _ in 0..(S / 2) {
        s.step();
        steers.push(dequantise_axis(s.applied_input(car).unwrap().steer));
        during.push(sample(&s));
    }
    // A blend: the applied steering walks from the autopilot's to the player's in equal steps, then is the player's.
    let step = (autopilot_steer - 0.0).abs() / HANDBACK_TICKS as f32;
    for w in steers.windows(2).take(HANDBACK_TICKS as usize) {
        assert!(
            (w[1] - w[0]).abs() <= step + 0.002,
            "applied steering jumped: {:?}",
            w
        );
    }
    assert_eq!(
        s.applied_input(car),
        Some(player),
        "the player has the car after the blend"
    );
    assert!(!s.has_autopilot(car));
    assert!(s.tick() >= at + HANDBACK_TICKS);
    // The signature: no yaw-acceleration or speed spike beyond what the autopilot itself was doing.
    let yaw_jerk = |v: &[(f32, f32)]| {
        v.windows(2)
            .map(|w| (w[1].0 - w[0].0).abs())
            .fold(0.0f32, f32::max)
    };
    let accel = |v: &[(f32, f32)]| {
        v.windows(2)
            .map(|w| (w[1].1 - w[0].1).abs())
            .fold(0.0f32, f32::max)
    };
    let (yaw_before, yaw_during) = (yaw_jerk(&before), yaw_jerk(&during));
    let (acc_before, acc_during) = (accel(&before), accel(&during));
    assert!(
        yaw_during <= yaw_before.max(1.0) * 1.5,
        "yaw-rate change per tick {yaw_during} vs {yaw_before} before"
    );
    assert!(
        acc_during <= acc_before.max(0.05) * 2.0,
        "speed change per tick {acc_during} vs {acc_before} before"
    );
}

#[test]
fn a_heartbeat_or_a_noisy_axis_is_not_deliberate() {
    let held = input(0.5, -0.2, 0.0);
    assert!(
        !is_deliberate(held, held),
        "a heartbeat repeats the same input"
    );
    assert!(
        !is_deliberate(held, input(0.55, -0.12, 0.05)),
        "a noisy axis wobbles a little"
    );
    assert!(is_deliberate(held, input(0.5, 0.4, 0.0)), "steering across");
    assert!(is_deliberate(held, input(0.0, -0.2, 0.8)), "braking");
}

#[test]
fn it_recovers_itself_after_being_stuck_3_s_and_its_state_is_introspectable() {
    let map = greybox();
    let mut s = sim(&map, 9);
    let car = s.spawn_grid(1)[0];
    s.start_race(3);
    for _ in 0..S {
        s.step();
    }
    // Box the car in with four huge debris blocks it can't push, 0.3 m clear of its hull (it faces +x on the grid).
    let p = s.car_state(car).unwrap().position;
    let [half_w, _, half_l] = VehicleProfile::cruz().chassis_half();
    let (gx, gz) = (half_l + 2.2 + 0.3, half_w + 2.2 + 0.3);
    for (dx, dz) in [(gx, 0.0), (-gx, 0.0), (0.0, gz), (0.0, -gz)] {
        s.spawn_debris(
            SpawnPose {
                x: p[0] + dx,
                y: 1.6,
                z: p[2] + dz,
                heading: 0.0,
            },
            [2.2, 1.5, 2.2],
        );
    }
    for _ in 0..S {
        s.step();
    }
    s.set_autopilot(car, true);
    let on = s.tick();
    s.step();
    // Introspection: where it's heading and why.
    let a = s.autopilot_state(car).expect("the autopilot is driving");
    let st = s.car_state(car).unwrap();
    let d = (a.target[0] - st.position[0]).hypot(a.target[1] - st.position[2]);
    assert!(
        a.look_ahead_m >= MIN_LOOK_AHEAD_M && (d - a.look_ahead_m).abs() < 4.0,
        "target {d} m ahead, look-ahead {}",
        a.look_ahead_m
    );
    assert!((MIN_SPEED..=MAX_SPEED).contains(&a.target_speed));
    while !s.race().events().iter().any(|(_, e)| {
        matches!(
            e,
            Event::Respawned {
                why: Respawned::Recover,
                ..
            }
        )
    }) {
        s.step();
        assert!(
            s.tick() <= on + STUCK_TICKS + S / 2,
            "no self-recovery after being stuck"
        );
    }
    assert!(s.tick() >= on + STUCK_TICKS, "not before 3 s stuck");
    assert!(s.has_autopilot(car), "still on autopilot after recovering");
}

#[test]
fn autopilot_takeovers_and_handbacks_replay_to_the_same_hash() {
    let map = greybox();
    let mut live = sim(&map, 10);
    let cars = live.spawn_grid(2);
    live.start_race(3);
    for t in 0..(20 * S) {
        live.set_input(cars[1], input(0.6, 0.0, 0.0));
        if t == 10 {
            live.set_autopilot(cars[0], true);
        }
        if t == 600 {
            live.set_autopilot(cars[1], true);
        }
        if t == 1500 {
            live.set_input(cars[0], input(0.3, 0.2, 0.0));
            live.set_autopilot(cars[0], false);
        }
        live.step();
    }
    let journal = Journal::from_bytes(&live.journal().to_bytes()).unwrap();
    let replay = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        &journal,
        live.tick(),
    );
    assert_eq!(replay.state_hash(), live.state_hash());
    assert_eq!(replay.applied_input(CarId(0)), live.applied_input(CarId(0)));
}
