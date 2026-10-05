//! P1-M09: the sign kit's data and grammar. Every shipped sign passes the grammar, the invented "BLOODY BIG JUMPS
//! AHEAD" is a warning sign by the same rules as a real one, and malformed signs (a wrong colour family, a new
//! shape, over-long text, a pictogram outside the set) are refused. Registry entries and data files stay paired.

use std::collections::BTreeSet;
use std::path::Path;

use jj_map::Registry;
use jj_procgen::signs::{self, Family, Shape, SignDef};

fn bloody() -> SignDef {
    signs::all()
        .into_iter()
        .find(|s| s.id == "signs/bloody-big-jumps")
        .expect("the invented sign ships")
}

fn json(s: &SignDef) -> serde_json::Value {
    serde_json::to_value(s).unwrap()
}

fn from(v: serde_json::Value) -> Result<SignDef, serde_json::Error> {
    serde_json::from_value(v)
}

#[test]
fn every_shipped_sign_passes_its_grammar() {
    let all = signs::all();
    assert!(all.iter().any(|s| s.family == Family::Warning));
    assert!(all.iter().any(|s| s.family == Family::Direction));
    assert!(all.iter().any(|s| s.family == Family::Tourist));
    for s in &all {
        assert_eq!(signs::validate(s), Vec::<String>::new(), "{}", s.id);
    }
}

#[test]
fn the_invented_sign_follows_the_warning_grammar() {
    let s = bloody();
    assert_eq!(s.family, Family::Warning);
    assert_eq!(s.shape, Shape::Diamond);
    assert_eq!(s.lines, ["BLOODY BIG", "JUMPS", "AHEAD"]);
    assert_eq!(s.sidecar.source, "original");
    assert!(signs::validate(&s).is_empty());
}

#[test]
fn a_wrong_colour_family_fails() {
    let mut s = bloody();
    s.background = "#00693c".into(); // a warning sign on direction green
    let p = signs::validate(&s);
    assert!(p.iter().any(|m| m.contains("colour family")), "{p:?}");
    let mut s = bloody();
    s.legend = "#ffffff".into();
    assert!(!signs::validate(&s).is_empty());
}

#[test]
fn a_new_shape_fails() {
    let mut s = bloody();
    s.shape = Shape::Rectangle; // a rectangular warning sign
    let p = signs::validate(&s);
    assert!(p.iter().any(|m| m.contains("no new shapes")), "{p:?}");
    // And a shape outside the set can't even be loaded.
    let mut v = json(&bloody());
    v["shape"] = "octagon".into();
    assert!(from(v).is_err());
}

#[test]
fn text_too_long_or_not_upper_case_fails() {
    let mut s = bloody();
    s.lines = vec!["BLOODY BIG JUMPS AHEAD".into()];
    assert!(signs::validate(&s).iter().any(|m| m.contains("won't fit")));
    let f = signs::legend_cap_fraction(&bloody()).unwrap();
    assert!(
        (signs::MIN_CAP_FRACTION..0.2).contains(&f),
        "the invented sign fits legibly: {f}"
    );
    let mut s = bloody();
    s.lines = vec!["Bloody Big".into()];
    assert!(signs::validate(&s).iter().any(|m| m.contains("upper case")));
    let mut s = bloody();
    s.lines = vec!["A".into(), "B".into(), "C".into(), "D".into()];
    assert!(!signs::validate(&s).is_empty());
    let mut s = bloody();
    s.lines = vec![];
    assert!(
        !signs::validate(&s).is_empty(),
        "no legend and no pictogram"
    );
}

#[test]
fn a_pictogram_outside_the_known_set_fails() {
    let mut v = json(&bloody());
    v["pictogram"] = "dragon".into();
    assert!(from(v).is_err());
}

#[test]
fn direction_and_tourist_grammar_hold() {
    let all = signs::all();
    let dir = all.iter().find(|s| s.family == Family::Direction).unwrap();
    let mut s = dir.clone();
    s.shield = Some("87A".into());
    assert!(
        !signs::validate(&s).is_empty(),
        "a route shield is a letter then digits"
    );
    let mut s = dir.clone();
    s.rows.clear();
    assert!(!signs::validate(&s).is_empty());
    let mut s = dir.clone();
    s.background = "#6b3410".into(); // a direction sign in tourist brown
    assert!(!signs::validate(&s).is_empty());
    let tourist = all.iter().find(|s| s.family == Family::Tourist).unwrap();
    let mut s = tourist.clone();
    s.pictogram = Some(signs::Pictogram::Kangaroo);
    assert!(!signs::validate(&s).is_empty());
}

#[test]
fn sidecars_record_family_and_a_real_copy_needs_its_commons_source_and_licence() {
    for s in signs::all() {
        assert_eq!(s.sidecar.family, s.family, "{}", s.id);
    }
    let mut s = bloody();
    s.sidecar.source =
        "https://commons.wikimedia.org/wiki/File:Australian_road_sign_W5-1.svg".into();
    s.sidecar.licence = "original".into();
    assert!(
        !signs::validate(&s).is_empty(),
        "a copied sign needs a real licence"
    );
    s.sidecar.licence = "CC BY-SA 4.0".into();
    assert!(signs::validate(&s).is_empty());
    s.sidecar.source = "https://example.com/sign.png".into();
    assert!(
        !signs::validate(&s).is_empty(),
        "the source must be a Commons file page"
    );
    let mut s = bloody();
    s.sidecar.family = Family::Tourist;
    assert!(!signs::validate(&s).is_empty());
}

#[test]
fn data_files_registry_entries_and_the_compiled_lists_stay_paired() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets/kit/signs");
    let names = |d: &Path| -> BTreeSet<String> {
        std::fs::read_dir(d)
            .unwrap()
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter_map(|f| f.strip_suffix(".json").map(|n| format!("signs/{n}")))
            .collect()
    };
    let entries = names(&dir);
    let data = names(&dir.join("data"));
    let compiled: BTreeSet<String> = signs::SIGN_DATA
        .iter()
        .map(|(id, _)| id.to_string())
        .collect();
    let pieces: BTreeSet<String> = signs::SIGN_PIECES
        .iter()
        .map(|(id, _)| id.to_string())
        .collect();
    assert_eq!(
        entries, data,
        "every registry entry has a data file and back"
    );
    assert_eq!(data, compiled, "SIGN_DATA lists every data file");
    assert_eq!(entries, pieces, "SIGN_PIECES lists every registry entry");
    for s in signs::all() {
        assert!(data.contains(&s.id));
    }
}

#[test]
fn registry_entries_load_in_jj_map_beside_the_generic_kit() {
    let reg = Registry::from_json(
        signs::SIGN_PIECES
            .iter()
            .map(|(id, json)| (*id, json.as_bytes())),
    );
    assert!(reg.problems().is_empty(), "{:?}", reg.problems());
    for (id, _) in signs::SIGN_PIECES {
        assert!(reg.get(id).is_some(), "{id}");
    }
}
