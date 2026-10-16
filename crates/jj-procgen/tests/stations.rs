//! P1-W04: item stations on generated race tracks. On 100 seeds every map validates with its stations (never in the start
//! corridor, never on a jump's ramp or landing), most tracks get several rows, and the validator rejects a station moved
//! into the corridor or onto a jump (negative fixtures).

use jj_map::{FeatureKind, Rule, kit::ITEM_STATION, validate};

fn stations(map: &jj_map::Map) -> Vec<usize> {
    map.dressing
        .iter()
        .enumerate()
        .filter(|(_, d)| d.kit_piece == ITEM_STATION)
        .map(|(i, _)| i)
        .collect()
}

#[test]
fn a_hundred_race_seeds_get_stations_that_validate() {
    let registry = jj_procgen::registry();
    let (mut with, mut total) = (0, 0);
    for seed in 0..100 {
        let p = jj_procgen::playtest::prepare(seed);
        let r = validate(&p.map, &registry);
        assert!(r.ok, "seed {seed}: {:?}", r.violations);
        let n = stations(&p.map).len();
        total += n;
        with += usize::from(n > 0);
    }
    println!("{with}/100 tracks have stations, {total} boxes in all");
    assert!(with >= 95, "only {with} of 100 tracks got stations");
}

/// A jump on the road (a rooftop lot's kicker stands off it, where a station isn't on the racing line).
fn on_road_jump(f: &jj_map::Feature) -> bool {
    f.kind == FeatureKind::Jump && !f.params.contains_key("roofTarget")
}

#[test]
fn the_validator_rejects_a_station_in_the_start_corridor_or_on_a_jump() {
    let registry = jj_procgen::registry();
    let seed = (0..200)
        .find(|&s| {
            let p = jj_procgen::playtest::prepare(s);
            !stations(&p.map).is_empty() && p.map.features.iter().any(on_road_jump)
        })
        .expect("a seed with stations and a jump");
    let p = jj_procgen::playtest::prepare(seed);
    let i = stations(&p.map)[0];

    let mut corridor = p.map.clone();
    let start = &corridor.route.points[corridor.route.start.at as usize];
    let (x, z) = (start.x, start.z);
    corridor.dressing[i].pose.x = x;
    corridor.dressing[i].pose.z = z;
    let r = validate(&corridor, &registry);
    assert!(
        r.violations
            .iter()
            .any(|v| v.rule == Rule::ItemStation && v.at == format!("dressing[{i}]")),
        "a station at the start line is refused: {:?}",
        r.violations
    );

    let mut on_jump = p.map.clone();
    let jump = on_jump
        .features
        .iter()
        .find(|f| on_road_jump(f))
        .unwrap()
        .pose;
    on_jump.dressing[i].pose.x = jump.x;
    on_jump.dressing[i].pose.z = jump.z;
    let r = validate(&on_jump, &registry);
    assert!(
        r.violations
            .iter()
            .any(|v| v.rule == Rule::ItemStation && v.at == format!("dressing[{i}]")),
        "a station on a jump is refused: {:?}",
        r.violations
    );
}
