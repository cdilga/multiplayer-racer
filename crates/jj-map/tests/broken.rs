//! Broken fixtures (`tests/fixtures/broken/<rule>.json`, written by `tools/maps/broken-fixtures.mjs`): each is the
//! greybox plus one mistake as JSON-pointer patch ops (and optional extra registry entries), and must fail with the
//! rule it names.

use jj_map::*;
use serde_json::Value;

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");

fn apply(doc: &mut Value, op: &Value) {
    let path = op["path"].as_str().expect("op path");
    let (parent, last) = path.rsplit_once('/').expect("a JSON pointer");
    let value = op.get("value").cloned().unwrap_or(Value::Null);
    match op["op"].as_str() {
        Some("replace") => *doc.pointer_mut(path).unwrap_or_else(|| panic!("no {path}")) = value,
        Some("add") => match doc
            .pointer_mut(parent)
            .unwrap_or_else(|| panic!("no {parent}"))
        {
            Value::Array(a) if last == "-" => a.push(value),
            Value::Array(a) => a.insert(last.parse().unwrap(), value),
            Value::Object(o) => drop(o.insert(last.to_owned(), value)),
            _ => panic!("can't add at {path}"),
        },
        Some("remove") => match doc
            .pointer_mut(parent)
            .unwrap_or_else(|| panic!("no {parent}"))
        {
            Value::Array(a) => drop(a.remove(last.parse().unwrap())),
            Value::Object(o) => drop(o.remove(last)),
            _ => panic!("can't remove {path}"),
        },
        other => panic!("unknown op {other:?}"),
    }
}

fn run(fixture: &Value) -> Result<LoadedMap, Report> {
    let mut doc: Value = serde_json::from_str(GREYBOX).unwrap();
    for op in fixture["ops"].as_array().unwrap() {
        apply(&mut doc, op);
    }
    let extra: Vec<(String, Vec<u8>)> = fixture["registry"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["id"].as_str().unwrap().to_owned(),
                serde_json::to_vec(&e["json"]).unwrap(),
            )
        })
        .collect();
    let entries = GENERIC_PIECES
        .iter()
        .map(|(id, json)| (*id, json.as_bytes()))
        .chain(extra.iter().map(|(id, b)| (id.as_str(), b.as_slice())));
    let registry = Registry::from_json(entries);
    load_json(&serde_json::to_vec(&doc).unwrap(), &registry)
}

#[test]
fn every_broken_fixture_fails_with_the_rule_it_names() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/broken");
    let mut names = Vec::new();
    let mut problems = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let fixture: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let expect = fixture["expect"].as_str().unwrap().to_owned();
        match run(&fixture) {
            Ok(_) => problems.push(format!("{expect}: the broken map validated")),
            Err(report) if !report.violations.iter().any(|v| v.rule.name() == expect) => problems
                .push(format!(
                    "{expect}: reported {:?}",
                    report
                        .violations
                        .iter()
                        .map(|v| v.rule.name())
                        .collect::<Vec<_>>()
                )),
            Err(_) => {}
        }
        names.push(expect);
    }
    assert!(problems.is_empty(), "{problems:#?}");
    for must in [
        "unknown-kit-piece",
        "registry-collider",
        "drivable-width",
        "wall-thickness",
        "gates",
        "landing-envelope",
        "start-corridor",
    ] {
        assert!(
            names.iter().any(|n| n == must),
            "no broken fixture for {must}"
        );
    }
}

#[test]
fn the_unpatched_greybox_passes_the_same_harness() {
    let clean = serde_json::json!({ "expect": "", "registry": [], "ops": [] });
    run(&clean).unwrap_or_else(|r| panic!("{r:#?}"));
}
