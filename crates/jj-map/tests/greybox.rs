//! The authored greybox loop (plan §8.2): validates, loads, hashes to the committed golden (the WASM parity test
//! asserts the same golden), round-trips its canonical bytes, and carries the duel segments (§7.3b).

use jj_map::*;

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
const GOLDEN: &str = include_str!("../../../maps/greybox-loop.hash");

fn load() -> LoadedMap {
    load_json(GREYBOX.as_bytes(), &Registry::generic())
        .unwrap_or_else(|r| panic!("the greybox must validate: {r:#?}"))
}

#[test]
fn greybox_validates_and_hashes_to_its_golden() {
    let loaded = load();
    let hash = hex(&loaded.hash);
    if std::env::var_os("JJ_BLESS").is_some() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../maps/greybox-loop.hash");
        std::fs::write(path, format!("{hash}\n")).unwrap();
        return;
    }
    assert_eq!(
        hash,
        GOLDEN.trim(),
        "the greybox's canonical bytes changed: rerun tools/maps/greybox.mjs and JJ_BLESS=1 if deliberate"
    );
}

#[test]
fn canonical_bytes_round_trip_and_only_canonical_bytes_load() {
    let loaded = load();
    let again = load_canonical(&loaded.canonical, &Registry::generic())
        .unwrap_or_else(|r| panic!("{r:#?}"));
    assert_eq!(again, loaded);
    // The same map with its dressing unsorted is valid data but not canonical bytes.
    let mut shuffled = loaded.map.clone();
    shuffled.dressing.reverse();
    let raw = postcard::to_allocvec(&shuffled).unwrap();
    let err = load_canonical(&raw, &Registry::generic()).unwrap_err();
    assert!(err.has(Rule::Schema), "{err:#?}");
}

fn span_length(map: &Map, name: &str) -> f64 {
    let seg = map
        .route
        .segments
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("no segment {name:?}"));
    let p = &map.route.points;
    (seg.span.from as usize..=seg.span.to as usize)
        .map(|i| {
            let (a, b) = (p[i], p[(i + 1) % p.len()]);
            (f64::from(b.x - a.x)).hypot(f64::from(b.z - a.z))
        })
        .sum::<f64>()
}

fn turn_degrees(map: &Map, name: &str) -> f64 {
    let seg = map.route.segments.iter().find(|s| s.name == name).unwrap();
    let p = &map.route.points;
    let heading = |i: usize| {
        let (a, b) = (p[i], p[(i + 1) % p.len()]);
        f64::from(b.z - a.z).atan2(f64::from(b.x - a.x))
    };
    let mut total = 0.0;
    for i in seg.span.from as usize..seg.span.to as usize {
        let mut d = heading(i + 1) - heading(i);
        d = (d + std::f64::consts::PI).rem_euclid(2.0 * std::f64::consts::PI)
            - std::f64::consts::PI;
        total += d;
    }
    total.to_degrees()
}

#[test]
fn greybox_carries_the_duel_segments() {
    let map = load().map;
    let length = |name| span_length(&map, name);
    assert!(
        length("main-straight") >= 150_000.0,
        "a straight of at least 150 m: {:.0} mm",
        length("main-straight")
    );
    assert!(
        turn_degrees(&map, "hairpin").abs() >= 170.0,
        "a hairpin turns ~180°: {:.0}",
        turn_degrees(&map, "hairpin")
    );
    // The S-bend turns one way then the other and ends heading where it started.
    let sb = map
        .route
        .segments
        .iter()
        .find(|s| s.name == "s-bend")
        .expect("an s-bend");
    let mid = (sb.span.from + sb.span.to) / 2;
    let half = |a: u32, b: u32| {
        let m = Map {
            route: Route {
                segments: vec![Segment {
                    name: "x".into(),
                    span: Span { from: a, to: b },
                }],
                ..map.route.clone()
            },
            ..map.clone()
        };
        turn_degrees(&m, "x")
    };
    let (first, second) = (half(sb.span.from, mid), half(mid, sb.span.to));
    assert!(
        first * second < 0.0 && first.abs() > 30.0 && second.abs() > 30.0,
        "an S-bend: {first:.0}° then {second:.0}°"
    );
    assert!(
        map.features.iter().any(|f| f.kind == FeatureKind::Kerb),
        "a kerb across the road"
    );
    assert!(
        map.features.iter().any(|f| f.kind == FeatureKind::Jump),
        "a jump (its bypass lane is the validator's jump-bypass rule)"
    );
    let total: f64 = (0..map.route.points.len())
        .map(|i| {
            let p = &map.route.points;
            let (a, b) = (p[i], p[(i + 1) % p.len()]);
            f64::from(b.x - a.x).hypot(f64::from(b.z - a.z))
        })
        .sum();
    assert!(
        (550_000.0..=700_000.0).contains(&total),
        "about 600 m: {:.0} m",
        total / 1000.0
    );
    let surfaces: std::collections::BTreeSet<Surface> =
        map.route.points.iter().map(|p| p.surface).collect();
    assert!(
        surfaces.contains(&Surface::Tarmac) && surfaces.contains(&Surface::PackedDirt),
        "tarmac and dirt sections"
    );
    assert!(
        map.dressing
            .iter()
            .any(|d| d.kit_piece == "generic/barrier" && d.collides),
        "barriers"
    );
}
