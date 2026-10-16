//! P1-FL19 br-bbki.22 (R134, Burnout lens): carnage pays in every race. A ram that wrecks or spins another car is the
//! attacker's takedown and fills their boost meter; a glancing touch, or a bump that leaves the other car going its way,
//! doesn't. Attribution is the damage records' (the episode's other car, a wreck's instigator), on the damage yard.
//!   cargo test -p jj-sim --test takedown --release

use std::path::{Path, PathBuf};

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::damage::{DamageEvent, part_index};
use jj_sim::takedown::{Takedown, TakedownHow};
use jj_sim::{CarId, Sim, SpawnPose, VehicleProfile};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn yard() -> LoadedMap {
    load_json(
        &std::fs::read(repo().join("scenarios/damage/yard.json")).expect("map"),
        &Registry::generic(),
    )
    .expect("yard validates")
}

/// Where a car starts on the yard: x, z (m), heading (degrees, 0 = +z, 90 = +x) and speed along it (m/s).
type Start = (f32, f32, f32, f32);

/// A crash: car 0 (the victim) and car 1 (the attacker) at their starts, `weak` a victim part set nearly broken.
struct Crash {
    victim: Start,
    attacker: Start,
    weak: Option<&'static str>,
}

/// What came of a crash: the takedowns, the attacker's boost meter, whether the cars hit at all, and the final hash.
struct Outcome {
    log: Vec<Takedown>,
    meter: f32,
    hit: bool,
    hash: [u8; 32],
}

/// Runs a crash for 4 s, the attacker's boost meter emptied as it starts.
fn run(c: &Crash) -> Outcome {
    let m = yard();
    let mut sim = Sim::new(&m, &Registry::generic(), 7, VehicleProfile::cruz());
    let cars = sim.spawn_grid(2);
    // Out of spawn protection first (it ghosts cars to each other), as the damage bank's t-bone fixture does.
    for _ in 0..240 {
        sim.step();
    }
    let place = |sim: &mut Sim, car: CarId, (x, z, deg, v): Start| {
        let h = deg.to_radians();
        sim.place_car(
            car,
            SpawnPose {
                x,
                y: 0.05,
                z,
                heading: h,
            },
            0.0,
            [v * libm::sinf(h), 0.0, v * libm::cosf(h)],
        );
    };
    place(&mut sim, cars[0], c.victim);
    place(&mut sim, cars[1], c.attacker);
    if let Some(part) = c.weak {
        sim.set_part_health(cars[0], part_index(part).expect("a part") as u8, 1.0);
    }
    sim.set_boost_meter(cars[1], 0.0);
    for _ in 0..480 {
        sim.step();
    }
    Outcome {
        log: sim.takedowns().to_vec(),
        meter: sim.action_state(cars[1]).unwrap().boost,
        hit: sim.damage_events().iter().any(|(_, e)| {
            matches!(e, DamageEvent::Episode(r) if r.car == 0 && r.other == jj_sim::damage::OtherBody::Car { car: 1 })
        }),
        hash: sim.state_hash(),
    }
}

/// A stationary victim facing +z, rammed across its rear quarter at 22 m/s: knocked sideways (about 85 degrees).
const REAR_QUARTER: Crash = Crash {
    victim: (60.0, -30.0, 0.0, 0.0),
    attacker: (50.0, -32.0, 90.0, 22.0),
    weak: None,
};
/// T-boned across its front axle at 40 m/s: spun round.
const T_BONE: Crash = Crash {
    victim: (60.0, -30.0, 0.0, 0.0),
    attacker: (46.0, -28.5, 90.0, 40.0),
    weak: None,
};
/// Its front-left wheel nearly broken, rammed there from its left at 12 m/s: the wheel comes off and the car is wrecked.
const WHEEL_OFF: Crash = Crash {
    victim: (60.0, -30.0, 0.0, 0.0),
    attacker: (72.0, -28.6, -90.0, 12.0),
    weak: Some("wheel_FL"),
};
/// The same rear quarter at 16 m/s: a real hit, but the car only swings about 50 degrees and keeps its line.
const BUMP: Crash = Crash {
    victim: (60.0, -30.0, 0.0, 0.0),
    attacker: (52.0, -31.4, 90.0, 16.0),
    weak: None,
};
/// Both heading +z, the attacker drifting into the victim's side at 8 degrees: a door-to-door rub.
const RUB: Crash = Crash {
    victim: (60.0, -30.0, 0.0, 10.0),
    attacker: (57.6, -36.0, 8.0, 13.0),
    weak: None,
};

#[test]
fn a_ram_that_spins_or_wrecks_the_other_car_fills_the_attackers_boost() {
    for (name, c, how) in [
        ("rear quarter", REAR_QUARTER, TakedownHow::Spin),
        ("t-bone", T_BONE, TakedownHow::Spin),
        ("wheel off", WHEEL_OFF, TakedownHow::Wreck),
    ] {
        let o = run(&c);
        assert_eq!(o.log.len(), 1, "{name}: one takedown {:?}", o.log);
        let t = o.log[0];
        assert_eq!((t.attacker, t.victim, t.how), (1, 0, how), "{name}: {t:?}");
        assert!(
            o.meter > 0.99,
            "{name}: the attacker's boost is full ({})",
            o.meter
        );
    }
}

#[test]
fn a_glancing_touch_or_a_bump_pays_nothing() {
    for (name, c) in [("bump", BUMP), ("rub", RUB)] {
        let o = run(&c);
        assert!(o.log.is_empty(), "{name}: {:?}", o.log);
        assert!(
            o.meter < 0.9,
            "{name}: the meter only recharged ({})",
            o.meter
        );
    }
    assert!(run(&BUMP).hit, "the bump is a real hit (a damage episode)");
}

#[test]
fn a_takedown_replays_bit_for_bit() {
    let (a, b) = (run(&REAR_QUARTER), run(&REAR_QUARTER));
    assert_eq!(a.log, b.log);
    assert_eq!(a.hash, b.hash);
}
