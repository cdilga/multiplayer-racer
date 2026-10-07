//! P1-S04b (plan §6.3, §13b.1): loose springs, detaching and persistent debris, with the energy accounting.
//!
//! - detached parts inherit `v + ω × r` (plus the small kick), stay dynamic, sleep and wake on contact;
//! - mass totals match before and after a detach;
//! - nothing in the sim ever converts debris to static, deletes it, merges it or budgets it (source scan + a long run);
//! - a loose part swings inside its limits, and loose springs, detach kicks and a 20-part pile never inject energy beyond
//!   the solver's tolerance, with a solver-stress rerun at doubled iterations (`energyGainJ`, the shared Energy metric).
//!
//! `JJ_DEBRIS_EVIDENCE=1 cargo test -p jj-sim --test debris` rewrites `docs/evidence/P1-S04b/energy.json`.

use std::path::{Path, PathBuf};

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::damage::{PART_NAMES, PARTS, PartState, part_index};
use jj_sim::{CarId, DriveInput, PropKind, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use serde_json::{Value, json};

const S: u64 = TICK_HZ as u64;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn yard() -> LoadedMap {
    load_json(
        &std::fs::read(repo().join("scenarios/damage/yard.json")).expect("yard"),
        &Registry::generic(),
    )
    .expect("the yard validates")
}

/// `n` cars spawned in the open and past their spawn protection.
fn rig(map: &LoadedMap, n: usize, seed: u64) -> Sim {
    let mut sim = Sim::new(map, &Registry::generic(), seed, VehicleProfile::cruz());
    for i in 0..n {
        sim.spawn_car(SpawnPose {
            x: -60.0 + 12.0 * i as f32,
            y: 0.1,
            z: -20.0,
            heading: 0.0,
        });
    }
    steps(&mut sim, 2 * S, |_, _| {});
    sim
}

fn steps(sim: &mut Sim, n: u64, mut each: impl FnMut(&mut Sim, u64)) {
    for t in 0..n {
        each(sim, t);
        sim.step();
    }
}

fn at(x: f32, z: f32, heading_deg: f32) -> SpawnPose {
    SpawnPose {
        x,
        y: 0.05,
        z,
        heading: heading_deg.to_radians(),
    }
}

fn part(name: &str) -> u8 {
    part_index(name).expect("part name") as u8
}

fn gain(sim: &Sim, e0: (f64, f64)) -> f64 {
    let e = sim.energy_j();
    (e.0 - e.1) - (e0.0 - e0.1)
}

/// The most the world's energy minus the ledger rose above where it started while `run` stepped the sim, J.
fn max_gain(sim: &mut Sim, n: u64, mut each: impl FnMut(&mut Sim, u64)) -> f64 {
    let e0 = sim.energy_j();
    let mut worst = f64::NEG_INFINITY;
    for t in 0..n {
        each(sim, t);
        sim.step();
        worst = worst.max(gain(sim, e0));
    }
    worst
}

fn debris_of_part(sim: &Sim, car: u32, name: &str) -> Option<usize> {
    (0..sim.prop_kinds().len())
        .find(|&i| sim.debris_part(i) == Some((CarId(car), PART_NAMES[usize::from(part(name))])))
}

// ---------------------------------------------------------------------------------------------------------------

#[test]
fn a_detached_part_inherits_the_chassis_velocity_and_mass_adds_up() {
    let map = yard();
    let mut sim = rig(&map, 1, 1);
    sim.place_car(CarId(0), at(20.0, -30.0, 90.0), 0.0, [12.0, 0.0, 0.0]);
    steps(&mut sim, 30, |_, _| {});
    let m0 = sim.car_mass(CarId(0)).unwrap();
    assert!(
        (m0 - 1200.0).abs() < 0.01,
        "the chassis starts at the profile's mass: {m0}"
    );
    let before = sim.car_state(CarId(0)).unwrap();
    for name in ["front", "door_FL", "wheel_RR"] {
        sim.set_part_health(CarId(0), part(name), 0.0);
    }
    sim.step();
    assert_eq!(sim.part_state(CarId(0), "front"), Some(PartState::Detached));
    let mut total = sim.car_mass(CarId(0)).unwrap();
    for name in ["front", "door_FL", "wheel_RR"] {
        let i = debris_of_part(&sim, 0, name).unwrap_or_else(|| panic!("{name} became debris"));
        assert_eq!(sim.prop_kinds()[i], PropKind::Part);
        let v = sim.debris_linvel(i).unwrap();
        // v + ω × r + a 1.5 m/s kick: within a few m/s of the chassis' 12 m/s (ω is small here, r within 2.3 m).
        let (dx, dy, dz) = (
            v[0] - before.linvel[0],
            v[1] - before.linvel[1],
            v[2] - before.linvel[2],
        );
        let off = (dx * dx + dy * dy + dz * dz).sqrt();
        assert!(
            off < 2.5,
            "{name} left at {off:.2} m/s relative to the chassis"
        );
        assert!(v[0] > 9.0, "{name} carries the car's speed along +x: {v:?}");
        assert_eq!(sim.debris_dynamic(i), Some(true));
        total += sim.debris_mass(i).unwrap();
    }
    assert!(
        (total - m0).abs() < 0.05,
        "chassis + the three parts = {total} kg, was {m0}"
    );
    let remaining = sim.car_mass(CarId(0)).unwrap();
    assert!(
        remaining < m0 - 100.0,
        "the chassis lost the parts' mass: {remaining}"
    );
}

#[test]
fn debris_persists_dynamic_sleeps_and_wakes_on_contact() {
    let map = yard();
    let mut sim = rig(&map, 2, 2);
    sim.place_car(CarId(0), at(20.0, -30.0, 90.0), 0.0, [0.0; 3]);
    sim.place_car(CarId(1), at(20.0, -20.0, 90.0), 0.0, [0.0; 3]);
    steps(&mut sim, 20, |_, _| {});
    sim.set_part_health(CarId(0), part("door_FL"), 0.0);
    sim.set_part_health(CarId(0), part("front"), 0.0);
    steps(&mut sim, 12 * S, |_, _| {});
    let door = debris_of_part(&sim, 0, "door_FL").expect("door debris");
    let front = debris_of_part(&sim, 0, "front").expect("bumper debris");
    for i in [door, front] {
        assert_eq!(sim.debris_dynamic(i), Some(true), "never static");
        assert_eq!(
            sim.debris_sleeping(i),
            Some(true),
            "settled and asleep after 12 s"
        );
    }
    let count = sim.prop_kinds().len();
    // A car drives into the sleeping bumper: it wakes.
    let p = sim.debris_poses()[front].0;
    sim.place_car(CarId(1), at(p[0] - 12.0, p[2], 90.0), 0.0, [10.0, 0.0, 0.0]);
    steps(&mut sim, 2 * S, |_, _| {});
    assert_eq!(
        sim.debris_sleeping(front),
        Some(false),
        "contact woke the bumper"
    );
    assert!(sim.prop_kinds().len() >= count, "nothing was removed");
    assert_eq!(sim.debris_dynamic(front), Some(true));
}

#[test]
fn nothing_converts_deletes_merges_or_budgets_debris() {
    // The source scan: no code path in the sim makes a body static, removes one, truncates the prop list or names a
    // cap, budget or lifetime for debris.
    const FORBIDDEN: [&str; 14] = [
        "set_body_type",
        "RigidBodyType::Fixed",
        "RigidBodyBuilder::fixed",
        "RigidBodyBuilder::kinematic",
        "bodies.remove",
        "remove_rigid_body",
        "props.remove",
        "props.retain",
        "props.truncate",
        "props.swap_remove",
        "props.clear",
        "MAX_DEBRIS",
        "debris_cap",
        "debris_budget",
    ];
    let mut files = Vec::new();
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }
    walk(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    let mut hits = Vec::new();
    for f in &files {
        let text = std::fs::read_to_string(f).unwrap();
        for (n, line) in text.lines().enumerate() {
            let code = line.split("//").next().unwrap_or("");
            for pat in FORBIDDEN {
                if code.contains(pat) {
                    hits.push(format!("{}:{}: {pat}", f.display(), n + 1));
                }
            }
            let lower = code.to_lowercase();
            for word in ["ttl", "expire", "lifetime"] {
                if lower
                    .split(|c: char| !c.is_alphanumeric())
                    .any(|w| w == word)
                {
                    hits.push(format!("{}:{}: {word}", f.display(), n + 1));
                }
            }
        }
    }
    assert!(hits.is_empty(), "debris rules:\n{}", hits.join("\n"));

    // And the behaviour: a minute on, with parts off and cars driving through them, every debris body is still there,
    // still dynamic.
    let map = yard();
    let mut sim = rig(&map, 3, 3);
    for (i, x) in [(0u32, 20.0f32), (1, 30.0), (2, 40.0)] {
        sim.place_car(CarId(i), at(x, -30.0, 90.0), 0.0, [8.0, 0.0, 0.0]);
        for name in ["front", "back", "door_FR", "wheel_FL"] {
            sim.set_part_health(CarId(i), part(name), 0.0);
        }
    }
    steps(&mut sim, 5, |_, _| {});
    let n = sim.prop_kinds().len();
    assert_eq!(n, 12, "twelve parts came off");
    steps(&mut sim, 60 * S, |sim, t| {
        if t % 600 == 0 {
            sim.place_car(CarId(0), at(10.0, -30.0, 90.0), 0.0, [9.0, 0.0, 0.0]);
        }
    });
    assert!(sim.prop_kinds().len() >= n, "no debris was removed");
    for i in 0..sim.prop_kinds().len() {
        assert_eq!(
            sim.debris_dynamic(i),
            Some(true),
            "debris {i} is still dynamic"
        );
    }
}

#[test]
fn a_loose_part_swings_inside_its_limits_and_settles() {
    let map = yard();
    let mut sim = rig(&map, 1, 4);
    sim.place_car(CarId(0), at(10.0, -30.0, 90.0), 0.0, [10.0, 0.0, 0.0]);
    steps(&mut sim, 5, |_, _| {});
    // Every part but the core goes loose (health at a third).
    for i in 1..PARTS {
        sim.set_part_health(CarId(0), i as u8, 1.0);
    }
    let profile = VehicleProfile::cruz();
    let mut seen = [0.0f32; PARTS];
    for t in 0..(6 * S) {
        let steer = if (t / 60) % 2 == 0 { 20_000 } else { -20_000 };
        sim.set_input(
            CarId(0),
            DriveInput {
                throttle: 8_000,
                steer,
                ..Default::default()
            },
        );
        sim.step();
        let a = sim.part_angles(CarId(0)).unwrap();
        for i in 1..PARTS {
            let (_, lo, hi) = profile.geometry.parts[i].hinge.expect("hinged");
            let deg = a[i].to_degrees();
            assert!(
                deg >= lo - 1e-3 && deg <= hi + 1e-3,
                "{} at {deg:.2}° outside [{lo}, {hi}]",
                PART_NAMES[i]
            );
            seen[i] = seen[i].max(deg.abs());
        }
    }
    for name in ["door_FL", "door_FR", "door_RL", "door_RR"] {
        let i = usize::from(part(name));
        assert!(seen[i] > 5.0, "{name} swung ({:.1}° at most)", seen[i]);
    }
    // Intact parts don't move.
    let mut sim2 = rig(&map, 1, 4);
    sim2.place_car(CarId(0), at(10.0, -30.0, 90.0), 0.0, [10.0, 0.0, 0.0]);
    steps(&mut sim2, 120, |_, _| {});
    assert!(
        sim2.part_angles(CarId(0))
            .unwrap()
            .iter()
            .all(|&a| a == 0.0)
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Energy accounting (plan §13b.1)

/// The solver's tolerance on `energyGainJ`: the rise of kinetic + potential − authorised work above its start. Cars
/// settle on springs the energy accounting doesn't count (suspension, tyres) and contacts resolve with a little
/// penetration, so a small positive residual is the solver's, not the sim's; the baseline (no damage, same drive) sets it.
const TOLERANCE_J: f64 = 250.0;

fn energy_rows(factor: usize) -> Vec<(String, f64)> {
    let map = yard();
    let mut rows = Vec::new();
    let scale = |sim: &mut Sim| sim.scale_solver_iterations(factor);

    // Baseline: the same coast with nothing damaged.
    let mut sim = rig(&map, 1, 10);
    scale(&mut sim);
    sim.place_car(CarId(0), at(10.0, -30.0, 90.0), 0.0, [14.0, 0.0, 0.0]);
    rows.push((
        "baseline-coast".to_owned(),
        max_gain(&mut sim, 5 * S, |_, _| {}),
    ));

    // Loose springs: every part loose, the car shaken by a slalom.
    let mut sim = rig(&map, 1, 11);
    scale(&mut sim);
    sim.place_car(CarId(0), at(10.0, -30.0, 90.0), 0.0, [14.0, 0.0, 0.0]);
    for i in 1..PARTS {
        sim.set_part_health(CarId(0), i as u8, 1.0);
    }
    rows.push((
        "loose-springs-slalom".to_owned(),
        max_gain(&mut sim, 5 * S, |sim, t| {
            let steer = if (t / 50) % 2 == 0 { 20_000 } else { -20_000 };
            sim.set_input(
                CarId(0),
                DriveInput {
                    steer,
                    ..Default::default()
                },
            );
        }),
    ));

    // Detach kicks: a car at speed loses its bumper, a door and a wheel on the same tick.
    let mut sim = rig(&map, 1, 12);
    scale(&mut sim);
    sim.place_car(CarId(0), at(10.0, -30.0, 90.0), 0.0, [14.0, 0.0, 0.0]);
    rows.push((
        "detach-kicks".to_owned(),
        max_gain(&mut sim, 5 * S, |sim, t| {
            if t == 30 {
                for name in ["front", "door_FL", "wheel_RR"] {
                    sim.set_part_health(CarId(0), part(name), 0.0);
                }
            }
        }),
    ));

    // A 20-part pile: two parked cars lose every part at once.
    let mut sim = rig(&map, 2, 13);
    scale(&mut sim);
    sim.place_car(CarId(0), at(20.0, -30.0, 90.0), 0.0, [0.0; 3]);
    sim.place_car(CarId(1), at(30.0, -30.0, 90.0), 0.0, [0.0; 3]);
    rows.push((
        "debris-pile-20".to_owned(),
        max_gain(&mut sim, 8 * S, |sim, t| {
            if t == 30 {
                for car in 0..2 {
                    for i in 1..PARTS {
                        sim.set_part_health(CarId(car), i as u8, 0.0);
                    }
                }
            }
        }),
    ));
    assert_eq!(sim.prop_kinds().len(), 20, "twenty parts in the pile");
    rows
}

#[test]
fn springs_kicks_and_a_debris_pile_never_inject_energy() {
    let normal = energy_rows(1);
    let stressed = energy_rows(2);
    let table: Vec<Value> = normal
        .iter()
        .zip(&stressed)
        .map(|((name, a), (_, b))| json!({ "scenario": name, "energyGainJ": a, "energyGainJAtDoubledIterations": b }))
        .collect();
    if std::env::var_os("JJ_DEBRIS_EVIDENCE").is_some() {
        let dir = repo().join("docs/evidence/P1-S04b");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("energy.json"),
            serde_json::to_string_pretty(&json!({ "toleranceJ": TOLERANCE_J, "rows": table }))
                .unwrap()
                + "\n",
        )
        .unwrap();
    }
    for (name, g) in normal.iter().chain(&stressed) {
        assert!(
            *g <= TOLERANCE_J,
            "{name}: energy rose {g:.1} J above its start (tolerance {TOLERANCE_J}); {table:?}"
        );
    }
}

/// The fixture-runner scenarios: the §7.3a `loose-wheel-drive` row, and the detach-energy run asserting the shared
/// `energyGainJ` metric. Each holds its envelopes, beats its baselines and replays to the same hash (with the journaled
/// part-health commands in it).
#[test]
fn loose_wheel_drive_and_the_energy_fixture_hold() {
    let registry = Registry::generic();
    for file in [
        "scenarios/affordances/loose-wheel-drive.json",
        "scenarios/damage/fixtures/detach-energy.json",
    ] {
        let fx: jj_fixture::Fixture =
            serde_json::from_slice(&std::fs::read(repo().join(file)).expect("fixture"))
                .expect("parses");
        let map = load_json(
            &std::fs::read(repo().join(&fx.map)).expect("map"),
            &registry,
        )
        .expect("map");
        let out =
            jj_fixture::run(&fx, &map, &registry, &VehicleProfile::cruz(), false).expect("runs");
        assert!(out.replay_matches(), "{file} replays");
        let bad: Vec<String> = out
            .recorded
            .checks
            .iter()
            .filter(|c| !c.ok)
            .map(|c| {
                format!(
                    "car {} {:?} = {:?} not in [{}, {}]",
                    c.car, c.metric, c.actual, c.min, c.max
                )
            })
            .chain(
                out.baselines
                    .iter()
                    .filter(|b| !b.ok)
                    .map(|b| format!("{:?} baseline", b.kind)),
            )
            .collect();
        assert!(bad.is_empty(), "{file}: {bad:?}");
    }
}
