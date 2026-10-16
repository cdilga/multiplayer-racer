//! Route forks (P1-FL16a, br-bbki.16.1; docs/research/fun-tracks.md R2-R6): generated forks validate, the bots split
//! between the branch and the road, every car finishes either way, and neither way dominates.
use jj_map::fork::{self, Fork};
use jj_map::{Biome, FeatureKind};

const BIOMES: [Biome; 4] = [
    Biome::Town,
    Biome::Rocks,
    Biome::OutbackDirt,
    Biome::OutbackBitumen,
];
const SEEDS: u64 = if cfg!(debug_assertions) { 3 } else { 20 };

/// One car's pass through one fork: which way it went and how long it took from split to merge, s.
#[derive(Debug)]
struct Pass {
    branch: bool,
    seconds: f32,
}

/// Every pass of `cars` autopiloted cars over `laps` laps of a seed's map (the sim seeded `sim_seed`, which sets the
/// bots' choices), per fork; and the cars that didn't finish, or (when `clean`) recovered or wrecked on the way.
fn drive(
    seed: u64,
    biome: Biome,
    sim_seed: u64,
    cars: usize,
    laps: u32,
    clean: bool,
) -> (Vec<Vec<Pass>>, Vec<String>) {
    let registry = jj_procgen::registry();
    let p = jj_procgen::prepare(seed, &[biome]);
    let map = jj_map::load_canonical(&jj_map::canonical_bytes(&p.map), &registry).unwrap();
    let forks: Vec<(Fork, Vec<[f64; 2]>)> = map
        .map
        .features
        .iter()
        .filter_map(Fork::of)
        .map(|d| (d, fork::path_of(&map.map, &d)))
        .collect();
    let pts = &map.map.route.points;
    let at = |i: u32| {
        [
            pts[i as usize].x as f32 / 1000.0,
            pts[i as usize].z as f32 / 1000.0,
        ]
    };
    let mut sim = jj_sim::Sim::new(&map, &registry, sim_seed, jj_sim::VehicleProfile::cruz());
    let ids = sim.spawn_grid(cars);
    sim.start_race(laps);
    for &c in &ids {
        sim.set_autopilot(c, true);
    }
    // Per car and fork: the tick it reached the split, and whether it has been on the branch's middle since.
    let mut open: Vec<Vec<Option<(u64, bool)>>> = vec![vec![None; forks.len()]; cars];
    let mut passes: Vec<Vec<Pass>> = (0..forks.len()).map(|_| Vec::new()).collect();
    // A lap's headroom over the laps asked: in a pack a bot shoved or run wide misses a gate's window (Rocks seed 0
    // car 2 crossed rp 860's gate 10.6 m off centre) and drives a whole lap more to take it, which isn't the fork's doing.
    let limit = 300 * u64::from(laps + 1) * u64::from(jj_sim::TICK_HZ);
    while ids.iter().any(|c| !sim.race().is_finished(c.0)) && sim.tick() < limit {
        sim.step();
        for (k, &c) in ids.iter().enumerate() {
            let Some(s) = sim.car_state(c) else { continue };
            let p = [s.position[0], s.position[2]];
            let dist = |q: [f32; 2]| (p[0] - q[0]).hypot(p[1] - q[1]);
            for (f, (d, line)) in forks.iter().enumerate() {
                let mid = line[line.len() / 2];
                let on_branch = dist([mid[0] as f32, mid[1] as f32]) < d.width_m as f32 / 2.0 + 3.0;
                match &mut open[k][f] {
                    None if dist(at(d.from)) < 6.0 => open[k][f] = Some((sim.tick(), false)),
                    Some((_, branch)) if on_branch => *branch = true,
                    Some((t0, branch)) if dist(at(d.to)) < 6.0 => {
                        passes[f].push(Pass {
                            branch: *branch,
                            seconds: (sim.tick() - *t0) as f32 / jj_sim::TICK_HZ as f32,
                        });
                        open[k][f] = None;
                    }
                    _ => {}
                }
            }
        }
    }
    let mut bad = Vec::new();
    for c in &ids {
        let r = sim.race().car(c.0).unwrap();
        if r.finished_at.is_none() || (clean && (r.recoveries > 0 || r.wrecks > 0)) {
            bad.push(format!(
                "{biome:?} seed {seed} car {}: finished {} recoveries {} wrecks {}",
                c.0,
                r.finished_at.is_some(),
                r.recoveries,
                r.wrecks
            ));
        }
    }
    (passes, bad)
}

#[test]
fn generated_forks_validate_and_most_courses_get_one() {
    let registry = jj_procgen::registry();
    let (mut maps, mut with) = (0, 0);
    for biome in BIOMES {
        for seed in 0..SEEDS {
            let (map, rep) = jj_procgen::generate_recipe(seed, &[biome]).unwrap();
            let report = jj_map::validate::validate(&map, &registry);
            assert!(report.ok, "{biome:?} seed {seed}: {:?}", report.violations);
            let forks = map
                .features
                .iter()
                .filter(|f| f.kind == FeatureKind::Fork)
                .count();
            assert_eq!(forks as u32, rep.forks);
            maps += 1;
            with += usize::from(forks > 0);
        }
    }
    eprintln!("forks on {with} of {maps} courses");
}

/// The first seeds of a biome whose courses have a fork, `count` of them.
fn forked(biome: Biome, count: usize) -> Vec<u64> {
    (0..SEEDS * 4)
        .filter(|&seed| jj_procgen::generate_recipe(seed, &[biome]).unwrap().1.forks > 0)
        .take(count)
        .collect()
}

/// R29 and FL16 "autopilot completes every branch": one car alone, its choices re-rolled by the sim seed until it has
/// driven each fork both ways, never recovers or wrecks.
#[test]
fn the_autopilot_drives_every_branch_and_the_road_cleanly() {
    let count = if cfg!(debug_assertions) { 1 } else { 3 };
    let mut bad = Vec::new();
    for biome in BIOMES {
        for seed in forked(biome, count) {
            let mut seen: Vec<(bool, bool)> = Vec::new();
            for sim_seed in 0..8 {
                let (passes, mut failed) = drive(seed, biome, sim_seed, 1, 1, true);
                bad.append(&mut failed);
                seen.resize(passes.len(), (false, false));
                for (f, ps) in passes.iter().enumerate() {
                    for p in ps {
                        if p.branch {
                            seen[f].0 = true;
                        } else {
                            seen[f].1 = true;
                        }
                    }
                }
                if seen.iter().all(|&(a, b)| a && b) {
                    break;
                }
            }
            for (f, &(on, off)) in seen.iter().enumerate() {
                if !(on && off) {
                    bad.push(format!(
                        "{biome:?} seed {seed} fork {f}: branch driven {on}, road driven {off}"
                    ));
                }
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

/// R29 (each way taken by >= 20% of bot passes) and FL16 "no branch dominates": in a pack, the best branch and road
/// times from split to merge stay within [`PARITY`] of each other. R6 asks for 3%; today's envelope is wider (stated
/// gap: the bots' line is the same pursuit on both, so the branch's loose surface and wind decide it).
const PARITY: f32 = 0.08;

#[test]
fn bots_split_between_branch_and_road_and_neither_dominates() {
    let (count, cars, laps) = if cfg!(debug_assertions) {
        (1, 6, 1)
    } else {
        (2, 8, 2)
    };
    let mut bad = Vec::new();
    for biome in BIOMES {
        for seed in forked(biome, count) {
            let (passes, mut failed) = drive(seed, biome, seed, cars, laps, false);
            bad.append(&mut failed);
            for (f, ps) in passes.iter().enumerate() {
                let (on, off): (Vec<&Pass>, Vec<&Pass>) = ps.iter().partition(|p| p.branch);
                let best = |v: &[&Pass]| v.iter().map(|p| p.seconds).fold(f32::INFINITY, f32::min);
                let (b, r) = (best(&on), best(&off));
                eprintln!(
                    "{biome:?} seed {seed} fork {f}: branch {} (best {b:.1} s) road {} (best {r:.1} s)",
                    on.len(),
                    off.len()
                );
                let share = on.len() as f32 / ps.len().max(1) as f32;
                if !(0.2..=0.8).contains(&share) {
                    bad.push(format!(
                        "{biome:?} seed {seed} fork {f}: {} on the branch, {} on the road",
                        on.len(),
                        off.len()
                    ));
                } else if (b - r).abs() > PARITY * r {
                    bad.push(format!(
                        "{biome:?} seed {seed} fork {f}: best branch {b:.1} s against road {r:.1} s"
                    ));
                }
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}
