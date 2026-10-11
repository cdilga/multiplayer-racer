//! Roof targets refer to unordered dressing: canonicalisation must preserve the actual house.
use jj_map::{Registry, canonical_bytes, canonicalise, load_canonical, load_json};

fn registry() -> Registry {
    Registry::from_json(
        jj_map::kit::GENERIC_PIECES
            .iter()
            .map(|(id, s)| (*id, s.as_bytes()))
            .chain([(
                "town/house",
                include_bytes!("../../../assets/kit/town/house.json").as_slice(),
            )]),
    )
}

#[test]
fn sorting_and_reordering_dressing_preserve_the_reachable_house() {
    let mut map: jj_map::Map =
        serde_json::from_str(include_str!("../../../scenarios/roofs/kicker-map.json")).unwrap();
    let target = map.dressing[0].clone();
    let mut other = target.clone();
    other.pose.x = 32_000;
    map.dressing.push(other);
    map.header.gameplay_hash = None;
    let loaded = load_json(&serde_json::to_vec(&map).unwrap(), &registry()).unwrap();
    let f = &loaded.map.features[0];
    let index = f.params["roofTarget"] as usize;
    assert_eq!(
        loaded.map.dressing[index], target,
        "canonical target did not move to another house"
    );
    assert!(jj_map::roof::problems(&loaded.map, f).is_empty());
    assert_eq!(
        load_canonical(&loaded.canonical, &registry()).unwrap(),
        loaded
    );

    map.dressing.reverse();
    map.features[0].params.insert("roofTarget".into(), 1);
    assert_eq!(
        canonical_bytes(&map),
        loaded.canonical,
        "authoring order is not gameplay"
    );
    assert_eq!(canonicalise(&loaded.map), loaded.map, "idempotent");
}
