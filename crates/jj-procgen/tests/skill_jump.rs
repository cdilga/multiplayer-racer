//! P1-FL20 AC3 (br-bbki.23, R132, R129): a skill jump. The same jump, the Feel Lab's canyon leap
//! (`maps/lab/canyon-leap.json`), flown by a player's Cruz: what happens depends on how it is approached and what the
//! stick does in the air. Taken at speed with the nose matched to the landing, it lands clean and the landing boost
//! pays (faster after than before); nosed down it lands bad and loses speed; over-rotated it crashes and is righted; too
//! slow it falls short into the canyon and respawns. Prints each run (`--nocapture`).
#![cfg(not(target_arch = "wasm32"))]

use jj_map::load_json;
use jj_sim::air::LandingTier;
use jj_sim::journal::SpawnPose;
use jj_sim::race::Event;
use jj_sim::{DriveInput, Sim, TICK_HZ, VehicleProfile};

fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[derive(Debug)]
struct Leap {
    tier: Option<LandingTier>,
    /// Speed just before touchdown and half a second after it (m/s).
    before_mps: f32,
    after_mps: f32,
    respawned: bool,
}

/// Approach at `approach_mps` with full throttle for `throttle_ticks`, then hold `air` (throttle, brake) until it lands,
/// then full throttle again. Speeds are horizontal.
fn leap(approach_mps: f32, throttle_ticks: u64, air: (i16, i16)) -> Leap {
    let bytes = std::fs::read(root().join("maps/lab/canyon-leap.json")).unwrap();
    let map = load_json(&bytes, &jj_procgen::registry()).expect("the lab scene loads");
    let mut sim = Sim::new(&map, &jj_procgen::registry(), 1, VehicleProfile::cruz());
    let car = sim.spawn_grid(1)[0];
    sim.start_race(1);
    // Past the countdown (a held grid ignores DRIVE, R127) and out of spawn protection.
    for _ in 0..(6 * TICK_HZ) {
        sim.step();
    }
    sim.set_autopilot(car, false);
    sim.place_car(
        car,
        SpawnPose {
            x: -43.796,
            y: 20.42,
            z: 45.0,
            heading: (-90.0f32).to_radians(),
        },
        0.0,
        [-approach_mps, 0.0, 0.0],
    );
    let life = sim.car_life(car);
    let seen = sim.race().events().len();
    let (mut flying, mut touchdown, mut before, mut after) = (false, None, 0.0f32, 0.0f32);
    for t in 0..(6 * TICK_HZ as u64) {
        // On the run-up the throttle; in the air the stick under test; once down, back on the throttle.
        let (throttle, brake) = if touchdown.is_some() || t < throttle_ticks {
            (i16::MAX, 0)
        } else {
            air
        };
        sim.set_input(
            car,
            DriveInput {
                throttle,
                brake,
                ..Default::default()
            },
        );
        sim.step();
        if sim.car_life(car) != life {
            break;
        }
        let st = sim.car_state(car).unwrap();
        // Horizontal speed: the fall's vertical speed is not pace.
        let speed = st.linvel[0].hypot(st.linvel[2]);
        let air_now = st.wheels_in_contact == 0;
        if t > 40 && air_now {
            flying = true;
        }
        if flying && touchdown.is_none() {
            if air_now {
                before = speed;
            } else {
                touchdown = Some(t);
            }
        }
        if touchdown.is_some_and(|at| t == at + u64::from(TICK_HZ) / 2) {
            after = speed;
        }
    }
    let tier = sim.race().events()[seen..]
        .iter()
        .find_map(|(_, e)| match e {
            Event::Landed { car: c, tier, .. } if *c == car.0 => Some(*tier),
            _ => None,
        });
    Leap {
        tier,
        before_mps: before,
        after_mps: after,
        respawned: sim.car_life(car) != life,
    }
}

#[test]
fn the_same_jump_lands_clean_bad_crashed_or_short_by_the_players_approach_and_stick() {
    // At speed (full throttle from 22 m/s to the lip), four ways to fly it.
    let ok = leap(22.0, 66, (0, 0)); // stick neutral: the lip's pitch against the landing decides
    let clean = leap(22.0, 66, (0, 8_000)); // a touch of brake noses it onto the landing slope
    let bad = leap(22.0, 66, (0, i16::MAX)); // full brake: nose first
    let crash = leap(22.0, 66, (i16::MAX, 0)); // throttle pinned: over-rotated, tail first
    // Too slow, no throttle: it falls short into the canyon.
    let short = leap(10.0, 0, (0, 0));
    for (name, l) in [
        ("neutral", &ok),
        ("touch of brake", &clean),
        ("full brake", &bad),
        ("throttle pinned", &crash),
        ("too slow", &short),
    ] {
        eprintln!("{name}: {l:?}");
    }
    assert_eq!(ok.tier, Some(LandingTier::Ok), "{ok:?}");
    assert_eq!(clean.tier, Some(LandingTier::Clean), "{clean:?}");
    assert_eq!(bad.tier, Some(LandingTier::Bad), "{bad:?}");
    assert_eq!(crash.tier, Some(LandingTier::Crash), "{crash:?}");
    assert!(
        !(ok.respawned || clean.respawned || bad.respawned || crash.respawned),
        "every flight at speed clears the gap"
    );
    // Skill pays: half a second after touchdown, back on the throttle.
    assert!(
        clean.after_mps > clean.before_mps,
        "the clean landing comes out faster than it went in: {clean:?}"
    );
    assert!(
        clean.after_mps > ok.after_mps + 2.0,
        "the clean landing's boost: {clean:?} vs {ok:?}"
    );
    assert!(
        bad.after_mps < ok.after_mps - 3.0,
        "the bad landing costs speed: {bad:?} vs {ok:?}"
    );
    assert!(
        crash.after_mps < clean.after_mps,
        "a crash is righted but slower than a clean landing: {crash:?}"
    );
    assert!(
        short.respawned,
        "too slow falls short and respawns: {short:?}"
    );
}
