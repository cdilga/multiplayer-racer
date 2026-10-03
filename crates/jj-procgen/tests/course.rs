//! P1-M03b seed bank: 100 seeds design closed loops inside the length band, with no self-intersection and a valid start
//! corridor (the map validator), and the corner mix is reported.

use std::collections::BTreeMap;

use jj_map::{Registry, Rule, validate};
use jj_procgen::course::{CLEARANCE_M, LENGTH_BAND_M, self_clear};
use jj_procgen::generate_report;

#[test]
fn a_hundred_seeds_design_valid_closed_loops_and_report_the_corner_mix() {
    let registry = Registry::generic();
    let mut histogram: BTreeMap<&str, u32> = BTreeMap::new();
    let (mut fallbacks, mut attempts) = (0, 0);
    for seed in 0..100u64 {
        let (map, report) = generate_report(seed);
        let pts: Vec<(f64, f64)> = map
            .route
            .points
            .iter()
            .map(|p| (f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0))
            .collect();
        // Closed: the route is a loop and its last point leads straight back to the first.
        assert!(map.route.closed);
        let (a, b) = (pts[pts.len() - 1], pts[0]);
        assert!(
            (a.0 - b.0).hypot(a.1 - b.1) < 3.0,
            "seed {seed}: the loop doesn't close"
        );
        assert!(
            (LENGTH_BAND_M.0..=LENGTH_BAND_M.1).contains(&report.length_m),
            "seed {seed}: length {} m outside the band",
            report.length_m
        );
        assert!(
            self_clear(&pts),
            "seed {seed}: two parts of the road come within {CLEARANCE_M} m"
        );
        let r = validate(&map, &registry);
        assert!(r.ok, "seed {seed}: {:?}", r.violations);
        assert!(!r.has(Rule::StartCorridor));
        for (k, n) in &report.corners {
            *histogram.entry(k).or_default() += n;
        }
        fallbacks += u32::from(report.fallback);
        attempts += report.attempts;
    }
    // The corner mix across the bank (the evidence prints it too: `jj procgen --seeds 0..100 --json`).
    println!(
        "corner mix over 100 seeds: {histogram:?}; mean attempts {}; fallbacks {fallbacks}",
        attempts as f64 / 100.0
    );
    for kind in ["hairpin", "sweeper", "medium"] {
        assert!(
            histogram[kind] >= 100,
            "every course has at least one {kind}: {histogram:?}"
        );
    }
    assert!(histogram["chicane"] > 0, "chicanes appear: {histogram:?}");
    assert!(fallbacks <= 2, "the oval fallback is rare: {fallbacks}");
}
