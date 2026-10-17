//! Feel Lab scenes (R131, P1-FL09): every scene in `assets/lab/scenes.json` builds through the generator, validates and
//! carries the set pieces it asks for; the committed map (`maps/lab/<scene>.json`) and each run's fixture
//! (`scenarios/lab/<run>.json`, run by the scenario bank) are what a fresh build makes. Re-make them after an intended
//! generator change with `JJ_BLESS=1 cargo test -p jj-procgen --test lab`.
use std::path::PathBuf;

use jj_procgen::lab;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn the_scene_data_is_sound() {
    assert_eq!(lab::validate_data(lab::shipped()), Vec::<String>::new());
}

#[test]
fn every_scene_builds_and_matches_its_committed_map_and_fixtures() {
    let bless = std::env::var_os("JJ_BLESS").is_some();
    for id in lab::shipped().scenes.keys() {
        let map_path = format!("maps/lab/{id}.json");
        let built = lab::build(id, &map_path).unwrap_or_else(|bad| panic!("{id}: {bad:#?}"));
        let mut files = vec![(
            map_path.clone(),
            serde_json::to_string_pretty(&built.map).unwrap() + "\n",
        )];
        for (run, fx) in &built.fixtures {
            files.push((
                format!("scenarios/lab/{run}.json"),
                serde_json::to_string_pretty(fx).unwrap() + "\n",
            ));
        }
        for (path, text) in files {
            let at = repo().join(&path);
            if bless {
                std::fs::create_dir_all(at.parent().unwrap()).unwrap();
                std::fs::write(&at, &text).unwrap();
                continue;
            }
            let committed = std::fs::read_to_string(&at)
                .unwrap_or_else(|e| panic!("{path}: {e} (JJ_BLESS=1 makes it)"));
            assert!(
                committed == text,
                "{path} differs from a fresh build of lab scene {id}: re-bless with JJ_BLESS=1"
            );
        }
    }
}

/// R129: the jump is a choice. The detour round the canyon leap's pit is the safe line and costs time: longer than the
/// leap's line, and its tightest bend holds a car to the speed a dirt corner allows (5 m/s² of lateral grip), so taking it
/// costs at least two seconds over flying the gap at the piece's lowest landing speed.
#[test]
fn the_canyon_leaps_detour_is_the_slower_line() {
    let built = lab::build("canyon-leap", "maps/lab/canyon-leap.json").unwrap();
    let f = built
        .map
        .features
        .iter()
        .find(|f| jj_map::setpiece::GapLeap::of(f).is_some())
        .unwrap();
    let d = jj_map::setpiece::GapLeap::of(f).unwrap();
    let path = jj_map::setpiece::detour_path(&built.map, f);
    let len = |a: [f64; 2], b: [f64; 2]| (b[0] - a[0]).hypot(b[1] - a[1]);
    let detour_m: f64 = path.windows(2).map(|w| len(w[0], w[1])).sum();
    let leap_m = len(path[0], path[path.len() - 1]);
    // Circumradius of each run of three points 5 points apart (12.5 m), the tightest bend.
    let tightest = path
        .windows(11)
        .map(|w| {
            let (a, b, c) = (w[0], w[5], w[10]);
            let cross = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).abs();
            len(a, b) * len(b, c) * len(a, c) / (2.0 * cross).max(1e-9)
        })
        .fold(f64::INFINITY, f64::min);
    let detour_v = (5.0 * tightest).sqrt().min(d.max_speed);
    let (leap_s, detour_s) = (leap_m / d.min_speed, detour_m / detour_v);
    assert!(
        detour_m > leap_m && detour_s > leap_s + 2.0,
        "detour {detour_m:.0} m, tightest bend {tightest:.0} m, {detour_v:.1} m/s ({detour_s:.1} s) vs leap {leap_m:.0} m at {:.1} m/s ({leap_s:.1} s)",
        d.min_speed
    );
}

/// P1-FL10 (R134): the hairpin's cut-through is shorter than the road round the hairpin and paved looser (packed dirt off
/// the tarmac), a cut (`forks.cut`), not a meander fork; its runs (scenarios/lab/hairpin-cut-*.json) show it pays and
/// slides.
#[test]
fn the_hairpin_cut_is_shorter_and_looser_than_the_road_it_skips() {
    let built = lab::build("hairpin-cut", "maps/lab/hairpin-cut.json").unwrap();
    let cuts: Vec<_> = built
        .map
        .features
        .iter()
        .filter_map(jj_map::fork::Fork::of)
        .collect();
    assert_eq!(cuts.len(), 1, "one cut, no other fork: {cuts:?}");
    let d = cuts[0];
    assert!(d.cut);
    let road = &built.map.route.points;
    let xz = |i: usize| (f64::from(road[i].x) / 1000.0, f64::from(road[i].z) / 1000.0);
    let road_m: f64 = (d.from as usize..d.to as usize)
        .map(|i| {
            let (a, b) = (xz(i), xz(i + 1));
            (b.0 - a.0).hypot(b.1 - a.1)
        })
        .sum();
    let cut_m = jj_map::fork::length_m(&jj_map::fork::path_of(&built.map, &d));
    assert!(
        cut_m < road_m * 0.6,
        "the cut ({cut_m:.0} m) is much shorter than the road it skips ({road_m:.0} m)"
    );
    assert_eq!(road[d.from as usize].surface, jj_map::Surface::Tarmac);
    assert_eq!(d.surface, jj_map::Surface::PackedDirt);
    assert!(
        jj_map::fork::problems(
            &built.map,
            built
                .map
                .features
                .iter()
                .find(|f| jj_map::fork::Fork::of(f).is_some())
                .unwrap()
        )
        .is_empty()
    );
}
