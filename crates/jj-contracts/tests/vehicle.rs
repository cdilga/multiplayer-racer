//! The vehicle contract against its fixtures (`tests/fixtures/vehicle/<case>/`, written by
//! `tools/vehicles/contract-fixtures.mjs`): the hand-made toy car passes; every broken case fails with the rule in its
//! EXPECT file.

use std::path::{Path, PathBuf};

use jj_contracts::vehicle::{self, ANCHORS, PARTS, Report, Rule};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/vehicle")
}

fn run(dir: &Path) -> Report {
    let json = std::fs::read(dir.join("toy.asset.json")).unwrap();
    match vehicle::parse_sidecar(&json) {
        Err(report) => report,
        Ok(sidecar) => vehicle::validate(&sidecar, |file| std::fs::read(dir.join(file)).ok()),
    }
}

#[test]
fn the_hand_made_vehicle_passes() {
    let report = run(&fixtures().join("valid"));
    assert!(report.ok, "{report:#?}");
    assert_eq!(report.tris.len(), 3, "triangles measured at every LOD");
    assert!(report.tris.iter().all(|&t| t > 0));
}

#[test]
fn every_broken_vehicle_fails_with_the_rule_it_names() {
    let mut broken = Vec::new();
    let mut problems = Vec::new();
    for entry in std::fs::read_dir(fixtures()).unwrap() {
        let dir = entry.unwrap().path();
        let expect = std::fs::read_to_string(dir.join("EXPECT"))
            .unwrap()
            .trim()
            .to_owned();
        if expect == "ok" {
            continue;
        }
        let report = run(&dir);
        let rules: Vec<&str> = report.violations.iter().map(|v| v.rule.name()).collect();
        if report.ok || !rules.contains(&expect.as_str()) {
            problems.push(format!(
                "{}: expected {expect}, got {rules:?}",
                dir.file_name().unwrap().to_string_lossy()
            ));
        }
        broken.push(expect);
    }
    assert!(problems.is_empty(), "{problems:#?}");
    assert!(
        broken.len() >= 10,
        "at least ten broken fixtures, have {}",
        broken.len()
    );
    for must in [
        "mass-sum",
        "origin-ground",
        "cabin-proxy-cuboid",
        "part-missing-at-lod",
        "anchor-missing",
        "tri-budget",
    ] {
        assert!(
            broken.iter().any(|b| b == must),
            "no broken fixture for {must}"
        );
    }
}

#[test]
fn the_json_schema_names_the_same_parts_and_anchors() {
    let schema: serde_json::Value =
        serde_json::from_str(include_str!("../../../art/contracts/vehicle.schema.json")).unwrap();
    let list = |ptr: &str| -> Vec<String> {
        schema
            .pointer(ptr)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(list("/properties/parts/required"), PARTS.to_vec());
    assert_eq!(list("/properties/anchors/required"), ANCHORS.to_vec());
    assert_eq!(
        schema.pointer("/properties/contract/const").unwrap(),
        vehicle::CONTRACT
    );
    let _ = Rule::Schema;
}
