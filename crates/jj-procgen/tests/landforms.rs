//! P1-FL15a (br-bbki.15.1, R132): terrain-first landscapes. Every real biome's generated courses span at least 25 m of
//! road height, and the road runs through landforms: corridors where the ground rises at least 6 m above the road on
//! BOTH sides within 8-40 m of the centerline (cuttings, gorges), on the validated map the game prepares; and the autopilot
//! laps every biome unaided on them. Set
//! `JJ_EVIDENCE_DIR` (an absolute path) to write the table.
#![cfg(not(target_arch = "wasm32"))]

use jj_map::{Biome, Map};
use jj_procgen::terrain::{CORRIDOR_WALL_M, corridor_depth_m};

/// The bank: a sample, not a limit (`JJ_SEEDS` widens it). 20 seeds per biome in release (the acceptance run); a debug
/// build is ~20x slower, so it samples 2.
const DEFAULT_SEEDS: u64 = if cfg!(debug_assertions) { 2 } else { 20 };
fn seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_SEEDS)
}

const BIOMES: [Biome; 4] = [
    Biome::Rocks,
    Biome::OutbackDirt,
    Biome::OutbackBitumen,
    Biome::Town,
];
pub const MIN_RELIEF_M: f64 = 25.0;

pub struct Metrics {
    pub relief_m: f64,
    /// Route length in corridors, m, and the longest single corridor, m.
    pub corridor_m: f64,
    pub longest_m: f64,
    pub deepest_m: f64,
}

pub fn metrics(map: &Map) -> Metrics {
    let p = &map.route.points;
    let n = p.len();
    let y: Vec<f64> = p.iter().map(|q| f64::from(q.y) / 1000.0).collect();
    let lo = y.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = y.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let step = |i: usize| {
        let (a, b) = (&p[i], &p[(i + 1) % n]);
        f64::from(b.x - a.x).hypot(f64::from(b.z - a.z)) / 1000.0
    };
    let depth = corridor_depth_m(map);
    let (mut corridor, mut longest, mut run) = (0.0, 0.0f64, 0.0);
    // Walk twice round so a corridor across the seam counts once, whole.
    for k in 0..2 * n {
        let i = k % n;
        if depth[i] >= CORRIDOR_WALL_M {
            run += step(i);
            if k < n {
                corridor += step(i);
            }
            longest = longest.max(run);
        } else {
            run = 0.0;
        }
    }
    Metrics {
        relief_m: hi - lo,
        corridor_m: corridor,
        longest_m: longest.min(corridor),
        deepest_m: depth.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    }
}

#[test]
fn every_biome_spans_25_m_and_runs_through_landforms() {
    let mut rows =
        String::from("biome seed draws lengthM reliefM corridorM longestCorridorM deepestM\n");
    let mut bad = Vec::new();
    for biome in BIOMES {
        for seed in 0..seeds() {
            // The map the game uses: validated, through the fallback ladder.
            let prepared = jj_procgen::prepare(seed, &[biome]);
            assert!(
                prepared.valid,
                "{biome:?} seed {seed}: {:?}",
                prepared.attempts
            );
            let draws = prepared.attempts.len();
            let map = prepared.map;
            let m = metrics(&map);
            let length = map.route.points.len() as f64 * 2.5;
            rows += &format!(
                "{biome:?} {seed} {draws} {length:.0} {:.1} {:.0} {:.0} {:.1}\n",
                m.relief_m, m.corridor_m, m.longest_m, m.deepest_m
            );
            if m.relief_m < MIN_RELIEF_M {
                bad.push(format!("{biome:?} seed {seed}: relief {:.1} m", m.relief_m));
            }
            // At least one corridor long enough to read as one (a car at 20 m/s spends over a second in it).
            if m.longest_m < 25.0 {
                bad.push(format!(
                    "{biome:?} seed {seed}: longest corridor {:.0} m",
                    m.longest_m
                ));
            }
        }
    }
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("landforms.txt"), &rows).unwrap();
    }
    assert!(bad.is_empty(), "{}\n{rows}", bad.join("\n"));
}

/// Seeds per biome the autopilot laps: 10 in release (the acceptance run), 1 in a debug build (~20x slower).
const LAP_SEEDS: u64 = if cfg!(debug_assertions) { 1 } else { 10 };

#[test]
fn the_autopilot_laps_every_biome_unaided() {
    let registry = jj_procgen::registry();
    let n = std::env::var("JJ_LAP_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(LAP_SEEDS);
    let mut bad = Vec::new();
    for biome in BIOMES {
        for seed in 0..n {
            // The game's path: the validated map with its set pieces.
            let p = jj_procgen::prepare(seed, &[biome]);
            let map = jj_map::load_canonical(&jj_map::canonical_bytes(&p.map), &registry).unwrap();
            let mut sim = jj_sim::Sim::new(&map, &registry, seed, jj_sim::VehicleProfile::cruz());
            let car = sim.spawn_grid(1)[0];
            sim.start_race(1);
            sim.set_autopilot(car, true);
            while !sim.race().is_finished(car.0) && sim.tick() < 400 * u64::from(jj_sim::TICK_HZ) {
                sim.step();
            }
            let race = sim.race().car(car.0).unwrap();
            if race.finished_at.is_none() || race.recoveries > 0 || race.wrecks > 0 {
                bad.push(format!(
                    "{biome:?} seed {seed}: finished {} recoveries {} wrecks {}",
                    race.finished_at.is_some(),
                    race.recoveries,
                    race.wrecks
                ));
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

/// One prepared lap's plan, crossings and relief (`JJ_SEEDS`, default 7; OutbackBitumen).
#[test]
#[ignore]
fn diag_relief() {
    let seed: u64 = std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(7);
    let p = jj_procgen::prepare(seed, &[Biome::OutbackBitumen]);
    let kinds: Vec<_> = p
        .map
        .features
        .iter()
        .map(|f| format!("{:?}", f.kind))
        .collect();
    eprintln!(
        "plan {:?} features {kinds:?} loopOvers {:?} relief {:.1} attempts {:?}",
        p.plan,
        jj_procgen::rhythm::loop_overs(&p.map),
        metrics(&p.map).relief_m,
        p.attempts.iter().map(|a| &a.rejected).collect::<Vec<_>>()
    );
}
