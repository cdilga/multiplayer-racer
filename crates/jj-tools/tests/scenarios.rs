//! The scenario bank through the real CLI: `jj sim --json scenarios/**/*.json` passes every envelope, replays and beats
//! its baselines (P1-S01's `idle-settle` and `straight-throttle`, P1-S05's §7.3a `flip-recover` and `oob-recover`, the
//! P1-S03a feel bank, and every scenario added later).

use std::path::Path;
use std::process::Command;

#[test]
fn every_scenario_in_the_bank_passes() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    // The bank: its §7.3a affordance rows (`scenarios/affordances/`), the feel bank (`scenarios/feel/`, P1-S03a) and
    // the introspection fixtures (`scenarios/introspection/`, P1-F05b).
    let mut files: Vec<String> = [
        "scenarios",
        "scenarios/affordances",
        "scenarios/feel",
        "scenarios/introspection",
    ]
    .iter()
    .flat_map(|d| std::fs::read_dir(repo.join(d)).unwrap())
    .map(|e| e.unwrap().path())
    .filter(|p| p.extension().is_some_and(|e| e == "json"))
    .map(|p| p.display().to_string())
    .collect();
    files.sort();
    for name in [
        "idle-settle.json",
        "straight-throttle.json",
        "flip-recover.json",
        "oob-recover.json",
    ] {
        assert!(
            files.iter().any(|f| f.ends_with(name)),
            "{name} is in the bank"
        );
    }
    let out = Command::new(env!("CARGO_BIN_EXE_jj"))
        .arg("sim")
        .arg("--json")
        .args(&files)
        .current_dir(&repo)
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let outcomes: serde_json::Value = serde_json::from_str(&stdout)
        .unwrap_or_else(|e| panic!("{e}: {stdout}\n{}", String::from_utf8_lossy(&out.stderr)));
    let failed: Vec<&serde_json::Value> = outcomes
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["ok"] != true)
        .collect();
    assert!(
        failed.is_empty() && out.status.success(),
        "failing scenarios:\n{}",
        serde_json::to_string_pretty(&failed).unwrap()
    );
}
