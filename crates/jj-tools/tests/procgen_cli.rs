//! `jj procgen --seed N --json` (P1-M03a): generates, validates and dumps the map, its canonical bytes and the
//! validator report, and the report it prints matches what it wrote.

use std::path::Path;
use std::process::Command;

#[test]
fn jj_procgen_generates_validates_and_dumps() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let out = Path::new(env!("CARGO_TARGET_TMPDIR")).join("procgen-42");
    let run = Command::new(env!("CARGO_BIN_EXE_jj"))
        .args(["procgen", "--seed", "42", "--json", "--out"])
        .arg(&out)
        .current_dir(&repo)
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&run.stdout);
    assert!(
        run.status.success(),
        "{stdout}\n{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let report: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(report["ok"], true);
    assert_eq!(report["seed"], 42);
    assert!(report["violations"].as_array().unwrap().is_empty());

    // The dump is the evidence: the canonical bytes hash to the printed gameplay hash, and the JSON map validates
    // through the same path as an authored map.
    let bin = std::fs::read(out.join("map.bin")).unwrap();
    let json = std::fs::read(out.join("map.json")).unwrap();
    let loaded =
        jj_map::load_json(&json, &jj_procgen::registry()).unwrap_or_else(|r| panic!("{r:?}"));
    assert_eq!(loaded.canonical, bin);
    assert_eq!(report["gameplayHash"], jj_map::hex(&loaded.hash));
    let written: serde_json::Value =
        serde_json::from_slice(&std::fs::read(out.join("report.json")).unwrap()).unwrap();
    assert_eq!(written, report);

    // The course design is in the report.
    assert!(report["course"]["lengthM"].as_f64().unwrap() >= 700.0);
    assert!(report["course"]["corners"]["hairpin"].as_u64().unwrap() >= 1);

    // The seed bank: every seed valid, with the corner mix.
    let bank = Command::new(env!("CARGO_BIN_EXE_jj"))
        .args(["procgen", "--seeds", "0..20", "--json"])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert!(
        bank.status.success(),
        "{}",
        String::from_utf8_lossy(&bank.stdout)
    );
    let b: serde_json::Value = serde_json::from_slice(&bank.stdout).unwrap();
    assert_eq!(
        (b["valid"].as_u64(), b["rows"].as_array().unwrap().len()),
        (Some(20), 20)
    );
    assert!(b["cornerMix"]["sweeper"].as_u64().unwrap() >= 1);

    let usage = Command::new(env!("CARGO_BIN_EXE_jj"))
        .arg("procgen")
        .output()
        .unwrap();
    assert_eq!(usage.status.code(), Some(2));
}
