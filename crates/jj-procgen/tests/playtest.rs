//! P1-M08b: every Playtest-1 track runs through town, rocks, outback dirt and outback bitumen, in that order, and back to
//! town, with validated transitions between them, the dirt to bitumen junction included. A seed bank of 100 seeds, each
//! with all four biomes and every check passing. `JJ_EVIDENCE_DIR` writes the report (`docs/evidence/P1-M08b/`).

use std::collections::BTreeMap;

use jj_map::{Biome, Surface};
use jj_procgen::biome::{check_transitions, segment_name};
use jj_procgen::playtest::{PLAYTEST_DRAWS, RECIPE, has_all_four, prepare};
use jj_procgen::validate::check;
use jj_procgen::{Plan, registry};

const DEFAULT_SEEDS: u64 = 100;

fn seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_SEEDS)
}

#[test]
fn a_hundred_seeds_each_run_through_all_four_biomes_and_validate_including_the_dirt_to_bitumen_junction()
 {
    let mut plans: BTreeMap<String, u32> = BTreeMap::new();
    let mut report = format!(
        "Playtest-1 recipe {:?}, {} seeds, {PLAYTEST_DRAWS} course draws before the ladder drops a biome\n\nseed plan         attempts  segments (start of lap -> back to town)  dirt->bitumen cut (m)  gameplay hash\n",
        RECIPE,
        seeds()
    );
    let mut total_attempts = 0;
    for seed in 0..seeds() {
        let p = prepare(seed);
        assert!(p.valid, "seed {seed}: {:?}", p.attempts.last());
        assert!(
            matches!(p.plan, Plan::Requested | Plan::Redrawn(_)),
            "seed {seed}: the ladder dropped a biome ({:?})",
            p.plan
        );
        assert!(
            has_all_four(&p.map),
            "seed {seed}: {:?}",
            p.map
                .route
                .segments
                .iter()
                .map(|s| &s.name)
                .collect::<Vec<_>>()
        );
        let mut used = p.map.header.biomes.clone();
        used.sort();
        let mut want = RECIPE.to_vec();
        want.sort();
        assert_eq!(used, want, "seed {seed}");
        let problems = check(&p.map, &registry());
        assert!(problems.is_empty(), "seed {seed}: {problems:?}");
        assert!(check_transitions(&p.map).is_empty());
        // The dirt to bitumen junction: the road surface is packed dirt before the cut and tarmac after it, with the
        // transition zone between, and the bitumen stretch opens with its direction sign.
        let segs = &p.map.route.segments;
        let cut = segs[2].span.to as usize;
        assert_eq!(
            p.map.route.points[cut.saturating_sub(40)].surface,
            Surface::PackedDirt,
            "seed {seed}"
        );
        assert_eq!(
            p.map.route.points[(cut + 40).min(p.map.route.points.len() - 1)].surface,
            Surface::Tarmac,
            "seed {seed}"
        );
        assert!(
            p.map
                .dressing
                .iter()
                .any(|d| d.kit_piece == "signs/stuart-hwy"),
            "seed {seed}: no sign at the bitumen entry"
        );
        assert!(
            p.map
                .dressing
                .iter()
                .any(|d| d.kit_piece == "signs/unsealed-road"),
            "seed {seed}: no unsealed-road warning at the dirt entry"
        );
        for b in RECIPE {
            let id = format!("{b:?}");
            assert!(
                segs.iter().any(|s| s.name == segment_name(b)),
                "seed {seed}: no {id}"
            );
        }
        *plans
            .entry(match p.plan {
                Plan::Requested => "requested".into(),
                Plan::Redrawn(d) => format!("redrawn-{d}"),
                _ => unreachable!(),
            })
            .or_default() += 1;
        total_attempts += p.attempts.len();
        let line: Vec<f64> = p
            .map
            .route
            .points
            .iter()
            .scan((0.0, None::<&jj_map::RoutePoint>), |st, q| {
                if let Some(prev) = st.1 {
                    st.0 += f64::from(q.x - prev.x).hypot(f64::from(q.z - prev.z)) / 1000.0;
                }
                st.1 = Some(q);
                Some(st.0)
            })
            .collect();
        report += &format!(
            "{seed:>4} {:<13} {:>8}  {}  {:>8.0}  {}\n",
            format!("{:?}", p.plan),
            p.attempts.len(),
            segs.iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>()
                .join(" > "),
            line[cut],
            &jj_map::hex(&jj_map::gameplay_hash(&p.map))[..16]
        );
    }
    report += &format!(
        "\nplans {plans:?}; mean generations per seed {:.2}\n",
        total_attempts as f64 / seeds() as f64
    );
    println!("{report}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("seed-bank.txt"), report).unwrap();
    }
    let _ = Biome::Town;
}

#[test]
fn the_playtest_track_is_a_pure_function_of_the_seed() {
    for seed in [0u64, 17, 99] {
        assert_eq!(
            jj_map::canonical_bytes(&prepare(seed).map),
            jj_map::canonical_bytes(&prepare(seed).map)
        );
    }
    assert_ne!(
        jj_map::canonical_bytes(&prepare(1).map),
        jj_map::canonical_bytes(&prepare(2).map)
    );
}
