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

    // Exercise the actual authored-map command, whose disk registry must also resolve the
    // generated chevrons, guard rails and finish gantry. Use --kit for outputs outside the repo.
    let validate = Command::new(env!("CARGO_BIN_EXE_jj"))
        .args(["validate", "--json", "--kit"])
        .arg(repo.join("assets/kit"))
        .arg(out.join("map.json"))
        .current_dir(&repo)
        .output()
        .unwrap();
    assert!(
        validate.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&validate.stdout),
        String::from_utf8_lossy(&validate.stderr)
    );
    let validated: serde_json::Value = serde_json::from_slice(&validate.stdout).unwrap();
    assert_eq!(validated.as_array().unwrap().len(), 1);
    assert_eq!(validated[0]["ok"], true, "{validated}");

    // The course design is in the report.
    assert!(report["course"]["lengthM"].as_f64().unwrap() >= 600.0);
    assert!(report["course"]["straightsM"].as_array().unwrap().len() >= 2);
    assert!(
        ["twisty", "flowing", "speedway"].contains(&report["course"]["preset"].as_str().unwrap())
    );

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

    // The four-biome recipe: every seed valid through the fallback ladder, with the plans counted.
    let four = Command::new(env!("CARGO_BIN_EXE_jj"))
        .args([
            "procgen",
            "--seeds",
            "0..12",
            "--recipe",
            "town,rocks,outback-dirt,outback-bitumen",
            "--json",
        ])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert!(
        four.status.success(),
        "{}",
        String::from_utf8_lossy(&four.stdout)
    );
    let f: serde_json::Value = serde_json::from_slice(&four.stdout).unwrap();
    assert_eq!(f["valid"].as_u64(), Some(12));
    let counted: u64 = f["plans"]
        .as_object()
        .unwrap()
        .values()
        .map(|n| n.as_u64().unwrap())
        .sum();
    assert_eq!(counted, 12, "every seed's plan is counted: {}", f["plans"]);
    assert!(f["rows"][0]["plan"].is_string());

    for preset in ["twisty", "flowing", "speedway"] {
        let out = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("procgen-preset-{preset}"));
        let run = Command::new(env!("CARGO_BIN_EXE_jj"))
            .args([
                "procgen", "--seeds", "0..2", "--preset", preset, "--json", "--out",
            ])
            .arg(&out)
            .current_dir(&repo)
            .output()
            .unwrap();
        assert!(
            run.status.success(),
            "{}",
            String::from_utf8_lossy(&run.stderr)
        );
        let bank: serde_json::Value = serde_json::from_slice(&run.stdout).unwrap();
        assert_eq!(bank["valid"], 2);
        assert!(
            bank["rows"]
                .as_array()
                .unwrap()
                .iter()
                .all(|r| r["course"]["preset"] == preset)
        );
        let written: serde_json::Value =
            serde_json::from_slice(&std::fs::read(out.join("bank.json")).unwrap()).unwrap();
        assert_eq!(
            written, bank,
            "bank --out must preserve this family's measurements"
        );
    }
    let invalid = Command::new(env!("CARGO_BIN_EXE_jj"))
        .args(["procgen", "--seed", "0", "--preset", "unknown"])
        .current_dir(&repo)
        .output()
        .unwrap();
    assert_eq!(invalid.status.code(), Some(2));

    let usage = Command::new(env!("CARGO_BIN_EXE_jj"))
        .arg("procgen")
        .output()
        .unwrap();
    assert_eq!(usage.status.code(), Some(2));
}
