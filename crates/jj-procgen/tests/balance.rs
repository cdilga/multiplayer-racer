//! br-bwju.6 (R123) roster balance bench: every roster vehicle runs solo time trials over generated maps of every map
//! class (each biome × each course family: twisty, flowing, speedway) and a fixed set of seeds, and the table says which
//! vehicle is fastest where and by how much.
//!
//! The race autopilot can't measure this: its speed plan is the same for every car (one assumed lateral grip, one speed
//! cap), so top speed and cornering, the strengths R123 balances, never show. The trial driver here is pure pursuit on
//! the same route line (`autopilot::Path::probe`) with a speed plan `√(a_lat / κ)` over the braking horizon and no speed
//! cap; each vehicle's lap is the best over a sweep of `a_lat` and the planned braking, so every car is driven at its own
//! limits (what a good player gets out of it), measured, not assumed.
//!
//! `cargo test -p jj-procgen --release --test balance -- --ignored --nocapture` (heavy: run it on eris); set
//! `JJ_EVIDENCE_DIR` for `balance.json` and `balance.md`, `JJ_BALANCE_SEEDS` (default 2) for seeds per class, and
//! `JJ_TUNE` (`field=value,…`, as the handling bank) to try profile values without a rebuild, `JJ_BALANCE_ONLY`
//! (a substring of `Biome/family`) to run some classes, and `JJ_BALANCE_VEHICLES` (`id,id`) some vehicles.
#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;

use jj_map::{Biome, LoadedMap, canonical_bytes, load_canonical};
use jj_procgen::seed::Streams;
use jj_procgen::tuning::{GeneratorData, PresetName};
use jj_sim::autopilot::{Path, Pose2};
use jj_sim::{DriveInput, Sim, TICK_HZ, VehicleProfile};
use jj_types::axis::quantise_axis;

const S: u64 = TICK_HZ as u64;
/// A lap that takes longer than this didn't happen (stuck, off the map).
const MAX_LAP_S: u64 = 300;
/// The driver's pure-pursuit look-ahead (s, minimum m), as the race autopilot's.
const LOOK: (f32, f32) = (0.8, 6.0);
/// Stuck: under this much progress (m) in this long (s).
const STUCK_M: f32 = 3.0;
const STUCK_S: u64 = 3;
/// The speed plan's sweep: assumed lateral grip (m/s²) and planned braking (m/s²).
const A_LAT: [f32; 6] = [10.0, 16.0, 22.0, 28.0, 36.0, 46.0];
const BRAKE: [f32; 4] = [8.0, 12.0, 18.0, 26.0];
const BIOMES: [Biome; 4] = [
    Biome::Town,
    Biome::Rocks,
    Biome::OutbackDirt,
    Biome::OutbackBitumen,
];
const PRESETS: [PresetName; 3] = [
    PresetName::Twisty,
    PresetName::Flowing,
    PresetName::Speedway,
];

fn profiles() -> Vec<(String, VehicleProfile)> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    VehicleProfile::roster(&root)
        .expect("the roster loads")
        .into_iter()
        .filter(|(id, _)| {
            std::env::var("JJ_BALANCE_VEHICLES")
                .map_or(true, |only| only.split(',').any(|v| v == id))
        })
        .map(|(id, p)| (id, tuned(p)))
        .collect()
}

fn tuned(base: VehicleProfile) -> VehicleProfile {
    let Ok(tune) = std::env::var("JJ_TUNE") else {
        return base;
    };
    let mut v = serde_json::to_value(base).unwrap();
    for kv in tune.split(',').filter(|s| !s.is_empty()) {
        let (k, val) = kv.split_once('=').expect("JJ_TUNE is field=value,…");
        let mut at = &mut v["tuning"];
        for part in k.split('.') {
            at = &mut at[part];
        }
        *at = serde_json::from_str(val).unwrap_or(serde_json::Value::String(val.into()));
    }
    serde_json::from_value(v).expect("JJ_TUNE keeps the profile valid")
}

/// The map of class (`biome`, `preset`) for `seed`, or none when the generator can't make that family in that biome.
fn class_map(biome: Biome, preset: PresetName, seed: u64) -> Option<LoadedMap> {
    let mut data = GeneratorData::shipped().clone();
    for n in PresetName::ALL {
        data.course.presets.set_weight(n, f64::from(n == preset));
    }
    let (map, report) =
        jj_procgen::generate_tuned_from(Streams::new(seed), &[biome], &data).ok()?;
    (report.preset == preset).then_some(())?;
    Some(
        load_canonical(&canonical_bytes(&map), &jj_procgen::registry())
            .expect("generated maps load"),
    )
}

/// One solo lap (s, and the Recovers it took) with the trial driver at `a_lat` and `brake`, or none if it was wrecked or
/// didn't finish inside `bound_s` (a lap slower than the best so far can stop). A car stuck off the line (under
/// `STUCK_M` of progress in `STUCK_S`) presses Recover, as a player would, and pays its time.
fn lap(
    map: &LoadedMap,
    path: &Path,
    profile: &VehicleProfile,
    a_lat: f32,
    brake: f32,
    bound_s: f32,
) -> Option<(f32, u32)> {
    let mut sim = Sim::new(map, &jj_procgen::registry(), 3, profile.clone());
    let car = sim.spawn_grid(1)[0];
    sim.start_race(1);
    let mut hint = None;
    let (mut top, mut min_up, mut low_ticks) = (0.0f32, 1.0f32, 0u64);
    let mut last_progress = f32::MIN;
    let bound = ((bound_s * TICK_HZ as f32) as u64).min(MAX_LAP_S * S);
    while !sim.race().is_finished(car.0) && sim.tick() < bound {
        if sim.race().car(car.0).is_some_and(|rc| rc.wrecks > 0) {
            break;
        }
        if sim.tick() % (STUCK_S * S) == 0 {
            let at = sim.race().progress_m(car.0);
            if sim.tick() > 0 && at - last_progress < STUCK_M {
                sim.recover(car);
            }
            last_progress = at;
        }
        let st = sim.car_state(car).unwrap();
        let speed = st.forward_speed;
        top = top.max(speed);
        min_up = min_up.min(st.up_y);
        low_ticks += u64::from(st.up_y < 0.7);
        let probe = path.probe(
            hint,
            Pose2 {
                x: st.position[0],
                y: st.position[1],
                z: st.position[2],
                heading: st.heading,
                forward_speed: speed,
            },
            profile.steer_lock(speed),
            profile.wheelbase(),
            [LOOK.0, LOOK.1, brake],
        );
        hint = Some(probe.idx);
        let target = if probe.max_curvature > 1e-4 {
            libm::sqrtf(a_lat / probe.max_curvature).max(4.0)
        } else {
            f32::INFINITY
        };
        let (throttle, brakes) = if speed < target {
            (1.0, 0.0)
        } else {
            (0.0, ((speed - target) / 3.0).clamp(0.0, 1.0))
        };
        sim.set_input(
            car,
            DriveInput {
                throttle: quantise_axis(throttle),
                steer: quantise_axis(probe.steer),
                brake: quantise_axis(brakes),
                no_reverse: true,
                ..DriveInput::default()
            },
        );
        sim.step();
    }
    let rc = sim.race().car(car.0)?;
    if std::env::var_os("JJ_BALANCE_TRACE").is_some() {
        let st = sim.car_state(car).unwrap();
        eprintln!(
            "lap a_lat {a_lat} brake {brake}: tick {} finished {:?} wrecks {} recoveries {} progress {:.0} m top {top:.1} m/s minUpY {min_up:.2} tipped {:.1} s at {:?}",
            sim.tick(),
            rc.finished_at,
            rc.wrecks,
            rc.recoveries,
            sim.race().progress_m(car.0),
            low_ticks as f32 / TICK_HZ as f32,
            st.position
        );
    }
    (rc.wrecks == 0).then_some((rc.finished_at? as f32 / TICK_HZ as f32, rc.recoveries))
}

/// The vehicle's best lap on `map` over the driver sweep: its time, the setting that drove it, and its Recovers.
fn best_lap(map: &LoadedMap, profile: &VehicleProfile) -> Option<Best> {
    let path = Path::new(map);
    let mut best: Option<Best> = None;
    for a_lat in A_LAT {
        for brake in BRAKE {
            let bound = best.map_or(MAX_LAP_S as f32, |b| b.lap_s);
            if let Some((lap_s, recovers)) = lap(map, &path, profile, a_lat, brake, bound)
                && best.is_none_or(|b| lap_s < b.lap_s)
            {
                best = Some(Best {
                    lap_s,
                    a_lat,
                    brake,
                    recovers,
                });
            }
        }
    }
    best
}

#[derive(Clone, Copy, Debug)]
struct Best {
    lap_s: f32,
    a_lat: f32,
    brake: f32,
    recovers: u32,
}

#[test]
#[ignore = "heavy: the full roster × map-class time-trial bench; run on eris"]
fn every_vehicle_against_every_map_class() {
    let seeds: u64 = std::env::var("JJ_BALANCE_SEEDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2);
    let roster = profiles();
    // class → vehicle → per-seed best laps
    let mut laps: BTreeMap<String, BTreeMap<String, Vec<Option<f32>>>> = BTreeMap::new();
    let mut rows = Vec::new();
    let only = std::env::var("JJ_BALANCE_ONLY").unwrap_or_default();
    let classes: Vec<(Biome, PresetName)> = BIOMES
        .iter()
        .flat_map(|&b| PRESETS.iter().map(move |&p| (b, p)))
        .filter(|(b, p)| format!("{b:?}/{}", p.name()).contains(&only))
        .collect();
    let results: Vec<_> = std::thread::scope(|scope| {
        let handles: Vec<_> = classes
            .iter()
            .flat_map(|&(biome, preset)| (0..seeds).map(move |seed| (biome, preset, seed)))
            .map(|(biome, preset, seed)| {
                let roster = &roster;
                scope.spawn(move || {
                    let Some(map) = class_map(biome, preset, seed) else {
                        return (biome, preset, seed, None);
                    };
                    let per: Vec<_> = roster
                        .iter()
                        .map(|(id, p)| (id.clone(), best_lap(&map, p)))
                        .collect();
                    (biome, preset, seed, Some(per))
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    for (biome, preset, seed, per) in results {
        let class = format!("{biome:?}/{}", preset.name());
        let Some(per) = per else {
            eprintln!("{class} seed {seed}: the generator made no such map");
            continue;
        };
        for (id, best) in per {
            laps.entry(class.clone())
                .or_default()
                .entry(id.clone())
                .or_default()
                .push(best.map(|b| b.lap_s));
            rows.push(serde_json::json!({"class":class,"seed":seed,"vehicle":id,"lapS":best.map(|b| b.lap_s),"aLat":best.map(|b| b.a_lat),"brake":best.map(|b| b.brake),"recovers":best.map(|b| b.recovers)}));
        }
    }
    // Per class: each vehicle's mean gap to the fastest finisher of each seed (over the seeds it finished), its DNFs, and
    // the class winner (the smallest mean gap among the vehicles that finished every seed).
    let mut md = String::from("| class | fastest | ");
    let ids: Vec<String> = roster.iter().map(|(id, _)| id.clone()).collect();
    md += &ids.join(" | ");
    md += " |\n|---|---|";
    md += &"---|".repeat(ids.len());
    md += "\n";
    let mut wins: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut worst_gap: BTreeMap<String, f32> = BTreeMap::new();
    let mut summary = Vec::new();
    for (class, per) in &laps {
        let n = per.values().map(Vec::len).max().unwrap_or(0);
        let fastest_of = |k: usize| {
            per.values()
                .filter_map(|v| v.get(k).copied().flatten())
                .min_by(f32::total_cmp)
        };
        let stats: Vec<(String, Option<f32>, usize)> = ids
            .iter()
            .map(|id| {
                let gaps: Vec<f32> = (0..n)
                    .filter_map(|k| Some((per[id].get(k).copied().flatten()?, fastest_of(k)?)))
                    .map(|(t, f)| (t / f - 1.0) * 100.0)
                    .collect();
                let dnf = n - gaps.len();
                let mean = (!gaps.is_empty()).then(|| gaps.iter().sum::<f32>() / gaps.len() as f32);
                (id.clone(), mean, dnf)
            })
            .collect();
        let winner = stats
            .iter()
            .filter(|(_, m, dnf)| m.is_some() && *dnf == 0)
            .min_by(|a, b| a.1.unwrap().total_cmp(&b.1.unwrap()))
            .map(|(id, ..)| id.clone());
        md += &format!("| {class} | {} |", winner.clone().unwrap_or("-".into()));
        for (id, mean, dnf) in &stats {
            match mean {
                Some(g) => {
                    if *dnf == 0 {
                        let e = worst_gap.entry(id.clone()).or_insert(0.0);
                        *e = e.max(*g);
                    }
                    md += &format!(
                        " +{g:.1}%{} |",
                        if *dnf > 0 {
                            format!(" ({dnf} DNF)")
                        } else {
                            String::new()
                        }
                    );
                }
                None => md += " DNF |",
            }
            summary
                .push(serde_json::json!({"class":class,"vehicle":id,"meanGapPct":mean,"dnf":dnf}));
        }
        md += "\n";
        if let Some(id) = winner {
            wins.entry(id).or_default().push(class.clone());
        }
    }
    md += "\nWins: ";
    md += &ids
        .iter()
        .map(|id| format!("{id} {}", wins.get(id).map_or(0, Vec::len)))
        .collect::<Vec<_>>()
        .join(", ");
    md += "\nWorst gap to the fastest: ";
    md += &ids
        .iter()
        .map(|id| format!("{id} +{:.1}%", worst_gap.get(id).copied().unwrap_or(0.0)))
        .collect::<Vec<_>>()
        .join(", ");
    md += "\n";
    println!("{md}");
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            format!("{dir}/balance.json"),
            serde_json::to_string_pretty(&rows).unwrap() + "\n",
        )
        .unwrap();
        std::fs::write(format!("{dir}/balance.md"), md).unwrap();
        std::fs::write(
            format!("{dir}/balance-summary.json"),
            serde_json::to_string_pretty(&summary).unwrap() + "\n",
        )
        .unwrap();
    }
}
