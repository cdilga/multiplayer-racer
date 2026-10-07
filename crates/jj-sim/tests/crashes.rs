//! P1-G05's staged collisions on the sim alone (plan §13.2 JN4, §6.3): the numbers the browser journey
//! (`web/tests/journeys/jn4-crashes.test.mjs`) plays through the real host come from `scenarios/crashes/jn4-crashes.json`
//! and are calibrated here. Four cars wait out their spawn protection, then each stage teleports them (the F05b setup)
//! with a velocity while their controllers hold DRIVE at the stage's throttle. After every stage the named parts must be
//! in the named states; the whole run replays to the same full-state hash; afterwards every car drives away or has
//! wrecked and respawned at its anchor, and every piece of debris is still a dynamic body in the world.
//! `JJ_CRASH_PRINT=1` prints each stage's non-intact parts (the calibration read-out).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use jj_map::{Registry, load_json};
use jj_sim::damage::PART_NAMES;
use jj_sim::{CarId, DriveInput, Journal, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use serde::Deserialize;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Crashes {
    map: String,
    seed: u64,
    park: Vec<[f32; 2]>,
    stages: Vec<Stage>,
    #[serde(default)]
    drive_away: Option<DriveAway>,
    #[allow(dead_code)]
    scenario: String,
    #[allow(dead_code)]
    what: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Stage {
    name: String,
    place: Vec<Place>,
    throttle: f32,
    ticks: u64,
    expect: BTreeMap<String, BTreeMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Place {
    car: u32,
    x: f32,
    z: f32,
    heading_deg: f32,
    linvel: [f32; 3],
}

/// After the last stage every controller holds DRIVE forward for `ticks`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DriveAway {
    throttle: f32,
    ticks: u64,
    /// A car that wasn't wrecked has moved at least this far (m) from where the stage left it.
    min_travel_m: f32,
    /// A car still under `STUCK_M` of travel after this many ticks (two cars nose to nose with a fallen bumper between them
    /// can't both push through) goes to the autopilot, which presses Recover after 3 s stuck: the car respawns at its anchor
    /// after the 2 s hold. The room never waits on it.
    hand_to_autopilot_after_ticks: u64,
}

/// Under this much travel by `hand_to_autopilot_after_ticks` counts as stuck.
const STUCK_M: f32 = 3.0;

fn q(v: f32) -> i16 {
    (v.clamp(-1.0, 1.0) * 32767.0) as i16
}

fn pos(sim: &Sim, car: u32) -> [f32; 3] {
    sim.car_state(CarId(car)).expect("car").position
}

struct Outcome {
    hash: [u8; 32],
    journal: Journal,
    sim: Sim,
}

fn run(c: &Crashes, print: bool) -> Outcome {
    let map = load_json(
        &std::fs::read(repo().join(&c.map)).expect("map"),
        &Registry::generic(),
    )
    .expect("map validates");
    let mut sim = Sim::new(&map, &Registry::generic(), c.seed, VehicleProfile::cruz());
    let cars = c.park.len() as u32;
    for (i, p) in c.park.iter().enumerate() {
        sim.spawn_car(SpawnPose {
            x: p[0],
            y: 0.1,
            z: p[1],
            heading: 90f32.to_radians(),
        });
        let _ = i;
    }
    for _ in 0..2 * TICK_HZ {
        sim.step();
    }
    for car in 0..cars {
        assert!(
            !sim.is_protected(CarId(car)),
            "car {car} still protected after the wait"
        );
    }
    for stage in &c.stages {
        // Everyone not in the stage waits at their parking spot.
        for car in 0..cars {
            let at = c.park[car as usize];
            let (pose, v) = match stage.place.iter().find(|p| p.car == car) {
                Some(p) => (
                    SpawnPose {
                        x: p.x,
                        y: 0.05,
                        z: p.z,
                        heading: p.heading_deg.to_radians(),
                    },
                    p.linvel,
                ),
                None => (
                    SpawnPose {
                        x: at[0],
                        y: 0.05,
                        z: at[1],
                        heading: 90f32.to_radians(),
                    },
                    [0.0; 3],
                ),
            };
            sim.place_car(CarId(car), pose, 0.0, v);
        }
        for _ in 0..stage.ticks {
            for p in &stage.place {
                sim.set_input(
                    CarId(p.car),
                    DriveInput {
                        throttle: q(stage.throttle),
                        ..Default::default()
                    },
                );
            }
            sim.step();
        }
        let mut seen = String::new();
        for car in 0..cars {
            let states = sim.part_states(CarId(car)).expect("car");
            let health = sim.part_health(CarId(car)).expect("car");
            let want = stage.expect.get(&car.to_string());
            for (i, name) in PART_NAMES.iter().enumerate() {
                if states[i].name() != "intact" {
                    seen += &format!(" car{car}.{name}={}({:.0})", states[i].name(), health[i]);
                }
                if let Some(w) = want.and_then(|w| w.get(*name)) {
                    assert_eq!(
                        states[i].name(),
                        w,
                        "stage {}: car {car} {name} (health {:.1})",
                        stage.name,
                        health[i]
                    );
                }
            }
        }
        if print {
            println!("{}:{seen}", stage.name);
        }
    }
    let before_debris = sim.debris_footprints().len();
    if let Some(d) = &c.drive_away {
        let before: Vec<[f32; 3]> = (0..cars).map(|car| pos(&sim, car)).collect();
        let wrecks0: Vec<u32> = (0..cars)
            .map(|car| sim.race().car(car).map_or(0, |c| c.wrecks + c.recoveries))
            .collect();
        for t in 0..d.ticks {
            if t == d.hand_to_autopilot_after_ticks {
                for car in 0..cars {
                    let (a, b) = (before[car as usize], pos(&sim, car));
                    if ((a[0] - b[0]).powi(2) + (a[2] - b[2]).powi(2)).sqrt() < STUCK_M {
                        sim.set_autopilot(CarId(car), true);
                        if print {
                            println!("drive-away car {car}: stuck, handed to the autopilot");
                        }
                    }
                }
            }
            for car in 0..cars {
                if sim.has_autopilot(CarId(car)) {
                    continue;
                }
                sim.set_input(
                    CarId(car),
                    DriveInput {
                        throttle: q(d.throttle),
                        ..Default::default()
                    },
                );
            }
            sim.step();
        }
        for car in 0..cars {
            let (a, b) = (before[car as usize], pos(&sim, car));
            let moved = ((a[0] - b[0]).powi(2) + (a[2] - b[2]).powi(2)).sqrt();
            // Wrecked, or recovered (the autopilot pressed Recover): respawned at its anchor either way.
            let wrecked =
                sim.race().car(car).map_or(0, |c| c.wrecks + c.recoveries) > wrecks0[car as usize];
            if print {
                println!("drive-away car {car}: moved {moved:.1} m, wrecked {wrecked}");
            }
            assert!(
                wrecked || moved >= d.min_travel_m,
                "car {car} stayed stuck: moved {moved:.1} m"
            );
        }
    }
    assert!(
        sim.debris_footprints().len() >= before_debris,
        "no debris vanished while the cars drove away"
    );
    // Every piece that came off is still a dynamic body in the world (debris never freezes, merges or expires, R86).
    let n = sim.debris_footprints().len();
    assert!(n >= 3, "the crashes left debris: {n}");
    for i in 0..n {
        assert_eq!(
            sim.debris_dynamic(i),
            Some(true),
            "debris body {i} is dynamic"
        );
    }
    let journal = Journal::from_bytes(&sim.journal().to_bytes()).expect("journal");
    Outcome {
        hash: sim.state_hash(),
        journal,
        sim,
    }
}

#[test]
fn the_staged_crashes_take_their_parts_loose_then_off_and_replay_to_the_same_state() {
    let c: Crashes = serde_json::from_slice(
        &std::fs::read(repo().join("scenarios/crashes/jn4-crashes.json")).expect("scenario"),
    )
    .expect("parse");
    let print = std::env::var("JJ_CRASH_PRINT").is_ok();
    let a = run(&c, print);
    let map = load_json(
        &std::fs::read(repo().join(&c.map)).expect("map"),
        &Registry::generic(),
    )
    .expect("map validates");
    let replayed = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        &a.journal,
        a.sim.tick(),
    );
    assert_eq!(
        replayed.state_hash(),
        a.hash,
        "the journal replays to the same full-state hash"
    );
    assert_eq!(
        run(&c, false).hash,
        a.hash,
        "a second run is bit for bit the first"
    );
}
