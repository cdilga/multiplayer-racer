//! P1-M03g seed bank and bot playtests. Every seed in the bank prepares a valid track for the Playtest-1 four-biome
//! recipe (the ladder's fallbacks counted, never silent), and the autopilot plays each one through the real sim:
//! stuck windows, lap-time spread, recoveries, out-of-bounds ticks, `refLapMs` against the autopilot's lap, with any
//! softlock flagged. (`scenarios/procgen/` isn't a scenario-runner fixture yet: the sim's runner takes one fixed map, so
//! generated seeds run here against the same `Sim`, and S07's `autopilot-three-laps` scenario stays the flat one.)
//! `JJ_EVIDENCE_DIR` writes `seed-bank.txt` and `bot-playtest.txt` (`docs/evidence/P1-M03g/`).
#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;

use jj_map::{Biome, LoadedMap, canonical_bytes, load_canonical};
use jj_procgen::{Plan, Prepared, prepare};
use jj_sim::race::Event;
use jj_sim::{Sim, TICK_HZ, VehicleProfile};

const S: u64 = TICK_HZ as u64;
/// The bank: a sample, not a limit (`JJ_SEEDS=N` widens it). A debug build is slow, so it samples fewer.
const DEFAULT_SEEDS: u64 = if cfg!(debug_assertions) { 12 } else { 100 };
/// The M08b shape: four biomes in a lap (it ends back in the first).
const RECIPE: [Biome; 4] = [
    Biome::Town,
    Biome::Rocks,
    Biome::OutbackDirt,
    Biome::OutbackBitumen,
];

fn seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_SEEDS)
}

fn plan_name(p: &Plan) -> String {
    match p {
        Plan::Requested => "requested".into(),
        Plan::Redrawn(d) => format!("redrawn-{d}"),
        Plan::Shorter(k) => format!("shorter-{k}"),
        Plan::Conservative => "conservative".into(),
    }
}

#[test]
fn every_seed_prepares_a_valid_track_and_every_fallback_is_counted() {
    let mut plans: BTreeMap<String, u32> = BTreeMap::new();
    let mut rows = String::from("seed plan            attempts  rejected-on-the-way\n");
    let mut total_attempts = 0;
    for seed in 0..seeds() {
        let p = prepare(seed, &RECIPE);
        assert!(p.valid, "seed {seed}: {:?}", p.attempts.last());
        // The accepted attempt is the last one and has no rejections; every earlier one has a reason.
        let (last, earlier) = p.attempts.split_last().unwrap();
        assert!(last.rejected.is_empty(), "seed {seed}");
        assert!(
            earlier.iter().all(|a| !a.rejected.is_empty()),
            "seed {seed}"
        );
        assert!(
            jj_procgen::validate::check(&p.map, &jj_procgen::registry()).is_empty(),
            "seed {seed}"
        );
        assert_eq!(
            p.map.header.seed, seed,
            "the header names the requested seed"
        );
        // Deterministic: the same seed and recipe give the same bytes.
        assert_eq!(
            canonical_bytes(&p.map),
            canonical_bytes(&prepare(seed, &RECIPE).map),
            "seed {seed}"
        );
        // Bounded: the ladder is a handful of generations, not an open-ended reroll.
        assert!(
            p.attempts.len() <= (jj_procgen::validate::MAX_DRAWS as usize) * 2 + RECIPE.len() + 1
        );
        total_attempts += p.attempts.len();
        *plans.entry(plan_name(&p.plan)).or_default() += 1;
        if seed < 30 || !matches!(p.plan, Plan::Requested) {
            rows += &format!(
                "{seed:>4} {:<15} {:>8}  {}\n",
                plan_name(&p.plan),
                p.attempts.len(),
                p.attempts
                    .iter()
                    .filter(|a| !a.rejected.is_empty())
                    .map(|a| format!(
                        "[{} biomes, draw {}: {}]",
                        a.recipe.len(),
                        a.draw,
                        a.rejected[0]
                    ))
                    .collect::<Vec<_>>()
                    .join(" ")
            );
        }
    }
    let n = seeds();
    let summary = format!(
        "{n} seeds, recipe town-rocks-outback-dirt-outback-bitumen (the lap ends back in town):\nplans {plans:?}\nmean attempts {:.2}\n\n{rows}",
        total_attempts as f64 / n as f64
    );
    println!("{summary}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("seed-bank.txt"), summary).unwrap();
    }
}

#[test]
fn the_conservative_recipe_is_always_available() {
    for seed in 0..seeds().min(30) {
        let p = prepare(seed, &[Biome::Town]);
        assert!(p.valid && p.plan == Plan::Requested, "seed {seed}");
        assert_eq!(p.map.route.segments.len(), 1);
    }
    // An empty recipe falls to the placeholder; a repeated biome is one biome.
    assert!(prepare(1, &[]).valid);
    assert_eq!(
        canonical_bytes(&prepare(2, &[Biome::Rocks, Biome::Rocks]).map),
        canonical_bytes(&prepare(2, &[Biome::Rocks]).map)
    );
}

fn loaded(p: &Prepared) -> LoadedMap {
    load_canonical(&canonical_bytes(&p.map), &jj_procgen::registry()).expect("a valid map loads")
}

/// What the autopilot did on a map: per-lap seconds and the §13b.1 numbers.
struct Bot {
    lap_s: Vec<f64>,
    finished: bool,
    stuck_windows: u32,
    recoveries: u32,
    wrecks: u32,
    oob_ticks: u64,
    sim_s: f64,
}

fn play(map: &LoadedMap, seed: u64, laps: u32, limit_s: u64) -> Bot {
    let mut sim = Sim::new(map, &jj_procgen::registry(), seed, VehicleProfile::cruz());
    let car = sim.spawn_grid(1)[0];
    sim.start_race(laps);
    sim.set_autopilot(car, true);
    let b = map.map.header.bounds;
    let (mut slow, mut stuck_windows, mut oob_ticks) = (0u64, 0u32, 0u64);
    let mut seen = 0usize;
    let mut lap_ticks = vec![0u64];
    while !sim.race().is_finished(car.0) && sim.tick() < limit_s * S {
        sim.step();
        let st = sim.car_state(car).unwrap();
        // A stuck window: under 1 m/s for a second, after the first 3 s (the grid start) and while not held.
        if sim.tick() > 3 * S
            && !sim.race().is_held(car.0, sim.tick())
            && st.forward_speed.abs() < 1.0
        {
            slow += 1;
            if slow == S {
                stuck_windows += 1;
            }
        } else {
            slow = 0;
        }
        let [x, y, z] = st.position;
        let (mx, mz) = (x * 1000.0, z * 1000.0);
        if mx < b.min_x as f32
            || mx > b.max_x as f32
            || mz < b.min_z as f32
            || mz > b.max_z as f32
            || y * 1000.0 < b.kill_y as f32
        {
            oob_ticks += 1;
        }
        let events = sim.race().events();
        for (tick, e) in &events[seen..] {
            if let Event::LapCompleted { car: c, .. } = e
                && *c == car.0
            {
                lap_ticks.push(*tick);
            }
        }
        seen = events.len();
    }
    let rc = sim.race().car(car.0).unwrap();
    Bot {
        lap_s: lap_ticks
            .windows(2)
            .map(|w| (w[1] - w[0]) as f64 / S as f64)
            .collect(),
        finished: sim.race().is_finished(car.0),
        stuck_windows,
        recoveries: rc.recoveries,
        wrecks: rc.wrecks,
        oob_ticks,
        sim_s: sim.tick() as f64 / S as f64,
    }
}

#[test]
fn the_autopilot_laps_three_seeds_and_the_bot_playtest_flags_any_softlock() {
    let mut table = String::from(
        "seed plan            refLap(s)  laps  lapTimes(s)            spread  autopilot/ref  stuck  recov  wreck  oobTicks  softlock\n",
    );
    let mut softlocks = Vec::new();
    let mut ratios = Vec::new();
    for seed in 0..seeds() {
        let p = prepare(seed, &RECIPE);
        let map = loaded(&p);
        // Three laps on the first three seeds (unaided), one lap on the rest of the bank.
        let laps = if seed < 3 && !cfg!(debug_assertions) {
            3
        } else {
            1
        };
        let ref_s = f64::from(p.map.header.ref_lap_ms) / 1000.0;
        // Generous limit: a lap at a quarter of the reference speed, per lap.
        let bot = play(
            &map,
            seed,
            laps,
            (ref_s * 4.0 * f64::from(laps)) as u64 + 30,
        );
        let spread = bot.lap_s.iter().copied().fold(0.0, f64::max)
            - bot.lap_s.iter().copied().fold(f64::INFINITY, f64::min);
        let mean = bot.lap_s.iter().sum::<f64>() / bot.lap_s.len().max(1) as f64;
        // A softlock: the car never finishes, or it sits stuck for a second at least a few times, or needed recovery.
        let softlock = !bot.finished || bot.stuck_windows > 0 || bot.recoveries > 0;
        if softlock {
            softlocks.push(seed);
        }
        if bot.finished {
            ratios.push(mean / ref_s);
        }
        table += &format!(
            "{seed:>4} {:<15} {ref_s:>9.1}  {:>4}  {:<21} {spread:>6.1}  {:>13.2}  {:>5}  {:>5}  {:>5}  {:>8}  {}\n",
            plan_name(&p.plan),
            bot.lap_s.len(),
            bot.lap_s
                .iter()
                .map(|t| format!("{t:.1}"))
                .collect::<Vec<_>>()
                .join(" "),
            mean / ref_s,
            bot.stuck_windows,
            bot.recoveries,
            bot.wrecks,
            bot.oob_ticks,
            if softlock { "FLAGGED" } else { "-" }
        );
        let _ = bot.sim_s;
        if seed < 3 {
            // The autopilot laps these seeds unaided.
            assert!(
                bot.finished,
                "seed {seed}: the autopilot didn't finish {laps} laps in {:.0} s",
                bot.sim_s
            );
            assert_eq!(bot.lap_s.len(), laps as usize, "seed {seed}");
            assert_eq!((bot.recoveries, bot.wrecks), (0, 0), "seed {seed}: unaided");
        }
    }
    table += &format!(
        "\nsoftlocks flagged: {softlocks:?}\nautopilot lap / refLapMs: mean {:.2}, min {:.2}, max {:.2}\n",
        ratios.iter().sum::<f64>() / ratios.len().max(1) as f64,
        ratios.iter().copied().fold(f64::INFINITY, f64::min),
        ratios.iter().copied().fold(0.0, f64::max)
    );
    println!("{table}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("bot-playtest.txt"), &table).unwrap();
    }
    assert!(softlocks.is_empty(), "softlocks: {softlocks:?}\n{table}");
}
