//! P1-W01.1: real `jj validate` calls for the item cards, including bad data supplied by a tool caller.
use std::{path::PathBuf, process::Command};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn the_cli_validates_shipped_cards_and_rejects_a_missing_field_or_missing_counterplay() {
    let valid = Command::new(env!("CARGO_BIN_EXE_jj"))
        .current_dir(repo())
        .args([
            "validate",
            "--json",
            "assets/items/boomerang.json",
            "assets/items/sanga.json",
        ])
        .output()
        .unwrap();
    assert!(
        valid.status.success(),
        "{}",
        String::from_utf8_lossy(&valid.stderr)
    );
    let reports: serde_json::Value = serde_json::from_slice(&valid.stdout).unwrap();
    assert_eq!(reports.as_array().unwrap().len(), 2);
    assert!(
        reports
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["ok"] == true && r["kind"] == "item")
    );

    let dir = std::env::temp_dir().join(format!("jj-item-cli-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("bad.json");
    let original: serde_json::Value =
        serde_json::from_slice(&std::fs::read(repo().join("assets/items/boomerang.json")).unwrap())
            .unwrap();
    for field in ["activation", "counterplay"] {
        let mut card = original.clone();
        card.as_object_mut().unwrap().remove(field);
        std::fs::write(&path, serde_json::to_vec(&card).unwrap()).unwrap();
        let out = Command::new(env!("CARGO_BIN_EXE_jj"))
            .current_dir(repo())
            .args(["validate", "--json"])
            .arg(&path)
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(1), "missing {field} accepted");
        let reports: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        assert_eq!(reports[0]["kind"], "item");
        assert_eq!(reports[0]["ok"], false);
        assert!(
            reports[0]["problems"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p.as_str().unwrap().contains(field))
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}
