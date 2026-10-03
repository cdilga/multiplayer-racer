//! `jj sim` through the real binary (P1-F05a): the acceptance flow with no browser, a failing fixture's printout, and
//! trace → compare.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn jj(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_jj"))
        .args(args)
        .current_dir(repo())
        .output()
        .unwrap()
}

fn tmp(name: &str) -> String {
    Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join(name)
        .display()
        .to_string()
}

#[test]
fn an_agent_sets_up_three_cars_and_seats_steps_600_ticks_reads_json_and_replays() {
    let out = tmp("sim-three-seats");
    let run = jj(&[
        "sim",
        "--json",
        "--out",
        &out,
        "crates/jj-tools/tests/fixtures/sim/three-seats.json",
    ]);
    let stdout = String::from_utf8_lossy(&run.stdout);
    assert!(
        run.status.success(),
        "{stdout}\n{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let o = &serde_json::from_str::<Value>(&stdout).unwrap()[0];
    assert_eq!(o["ok"], true);
    assert_eq!(o["ticks"], 600);
    assert_eq!(o["replayMatches"], true);
    assert_eq!(o["stateHash"], o["replayHash"]);

    let obs = o["observations"].as_array().unwrap();
    let ticks: Vec<u64> = obs.iter().map(|s| s["tick"].as_u64().unwrap()).collect();
    assert_eq!(ticks, vec![0, 300, 600]);
    let end = &obs[2];
    let cars = end["cars"].as_array().unwrap();
    assert_eq!(cars.len(), 3);
    for c in cars {
        for key in [
            "position",
            "rotation",
            "linvel",
            "speed",
            "forwardSpeed",
            "progress",
            "input",
            "wheels",
        ] {
            assert!(!c[key].is_null(), "car {} has no {key}", c["car"]);
        }
        assert!(c["progress"]["distanceM"].is_f64());
        assert_eq!(c["wheels"].as_array().unwrap().len(), 4);
    }
    // Throttle 1.0 outpaces 0.5 outpaces idle.
    let progress = |i: usize| cars[i]["progress"]["distanceM"].as_f64().unwrap();
    assert!(progress(0) > progress(1) && progress(1) > progress(2));

    let session = &end["session"];
    assert_eq!(session["phase"], "Running");
    assert_eq!(session["driving"], "Racing");
    let seats = session["seats"].as_array().unwrap();
    assert_eq!(seats.len(), 3);
    for (i, (s, name)) in seats.iter().zip(["Ava", "Bo", "Cy"]).enumerate() {
        assert_eq!(s["name"], name);
        assert_eq!(s["number"], i + 1);
        assert_eq!(s["car"], i);
        assert_eq!(s["presence"], "Active");
        assert_eq!(s["hasCar"], true);
        assert_eq!(s["connected"], true);
    }

    // The evidence folder: the journal replays from its bytes, and outcome.json is what was printed.
    assert!(Path::new(&out).join("journal.bin").is_file());
    let written: Value =
        serde_json::from_slice(&std::fs::read(Path::new(&out).join("outcome.json")).unwrap())
            .unwrap();
    assert_eq!(&written, o);
}

#[test]
fn a_failing_fixture_prints_what_it_observed_against_its_signature_and_exits_1() {
    let run = jj(&[
        "sim",
        "--out",
        &tmp("sim-failing"),
        "crates/jj-tools/tests/fixtures/sim/failing-envelope.json",
    ]);
    let stdout = String::from_utf8_lossy(&run.stdout);
    assert_eq!(run.status.code(), Some(1), "{stdout}");
    assert!(stdout.starts_with("FAIL failing-envelope"), "{stdout}");
    assert!(stdout.contains("BAD car 0 @   end maxSpeed = "), "{stdout}");
    assert!(stdout.contains("NOT in [100, 200]"), "{stdout}");
    assert!(stdout.contains("outcome signature at the end:"), "{stdout}");
    for metric in [
        "maxSpeed",
        "travel",
        "progressM",
        "airtimeS",
        "maxYawRateDegS",
        "maxSlipDeg",
    ] {
        assert!(
            stdout.contains(metric),
            "the signature printout lacks {metric}: {stdout}"
        );
    }
    // The same in JSON: the failed check carries what it observed.
    let run = jj(&[
        "sim",
        "--json",
        "--out",
        &tmp("sim-failing-json"),
        "crates/jj-tools/tests/fixtures/sim/failing-envelope.json",
    ]);
    assert_eq!(run.status.code(), Some(1));
    let o = &serde_json::from_slice::<Value>(&run.stdout).unwrap()[0];
    let bad = o["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["ok"] == false)
        .unwrap();
    assert_eq!(bad["metric"], "maxSpeed");
    assert!(bad["actual"].as_f64().unwrap() < 100.0);
}

#[test]
fn trace_feeds_compare_which_shows_the_differing_keys() {
    let (a, b) = (tmp("trace-current"), tmp("trace-tuned"));
    let traced = jj(&[
        "sim",
        "--trace",
        "--out",
        &a,
        "scenarios/straight-throttle.json",
    ]);
    assert!(
        traced.status.success(),
        "{}",
        String::from_utf8_lossy(&traced.stdout)
    );
    let tuned = jj(&[
        "sim",
        "--trace",
        "--out",
        &b,
        "--set",
        "max_engine_force=3000",
        "scenarios/straight-throttle.json",
    ]);
    assert!(tuned.status.success() || tuned.status.code() == Some(1));

    // One JSON row per tick (0..=720) and a summary row.
    let text = std::fs::read_to_string(Path::new(&a).join("trace.jsonl")).unwrap();
    let rows: Vec<Value> = text
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(rows.len(), 722);
    assert_eq!(rows[720]["tick"], 720);
    let car = &rows[360]["cars"][0];
    for key in ["position", "linvel", "angvel", "input", "wheels"] {
        assert!(!car[key].is_null(), "trace rows lack {key}");
    }
    assert!(car["wheels"][0]["slipDeg"].is_f64() && car["wheels"][0]["contact"].is_boolean());
    assert!(rows[721]["summary"]["stateHash"].is_string());
    // Events: what changed the sim since the previous row (the spawn at row 0, the throttle input applied at tick 0).
    assert!(
        rows[0]["events"][0]["setup"]["SpawnCar"].is_object(),
        "{}",
        rows[0]["events"]
    );
    assert_eq!(rows[1]["events"][0]["input"]["throttle"], 1.0);
    assert_eq!(rows[1]["events"][0]["at"], 0);
    assert!(rows[360]["events"].as_array().unwrap().is_empty());

    // ACCEPTED | CURRENT | TUNED: the same run twice is identical; the tuned one differs, key by key.
    let cmp = jj(&["sim", "--json", "--compare", &a, &a, &b]);
    assert!(cmp.status.success());
    let c: Value = serde_json::from_slice(&cmp.stdout).unwrap();
    assert_eq!(c["identical"], false);
    let summary = c["summary"].as_array().unwrap();
    let keys: Vec<&str> = summary.iter().map(|r| r["key"].as_str().unwrap()).collect();
    for k in [
        "stateHash",
        "signature[0].maxSpeed",
        "signature[0].progressM",
    ] {
        assert!(keys.contains(&k), "{k} should differ: {keys:?}");
    }
    for r in summary {
        assert_eq!(
            r["accepted"], r["current"],
            "CURRENT is the ACCEPTED run itself"
        );
    }
    let div = c["divergence"].as_array().unwrap();
    let impulse = div
        .iter()
        .find(|k| k["key"] == "cars[0].wheels[2].forwardImpulse")
        .expect("the driven wheel's impulse differs");
    assert!(
        impulse["tick"].as_u64().unwrap() <= 2,
        "the tuned engine diverges at once: {impulse}"
    );
    assert!(
        div.iter().all(|k| k["accepted"] == k["current"]),
        "CURRENT is ACCEPTED"
    );

    let same = jj(&["sim", "--json", "--compare", &a, &a]);
    assert_eq!(
        serde_json::from_slice::<Value>(&same.stdout).unwrap()["identical"],
        true
    );

    // The human table.
    let table = jj(&["sim", "--compare", &a, &b]);
    let t = String::from_utf8_lossy(&table.stdout);
    assert!(
        t.contains("ACCEPTED") && t.contains("CURRENT") && t.contains("TUNED"),
        "{t}"
    );
    assert!(t.contains("signature[0].maxSpeed"), "{t}");
}

#[test]
fn help_has_worked_examples_and_bad_usage_exits_2() {
    let help = jj(&["sim", "--help"]);
    let h = String::from_utf8_lossy(&help.stdout);
    assert!(help.status.success() && h.contains("examples:") && h.contains("--compare"));
    assert_eq!(jj(&["sim"]).status.code(), Some(2));
    assert_eq!(
        jj(&[
            "sim",
            "--set",
            "no_such_field=1",
            "scenarios/feel/idle-settle.json"
        ])
        .status
        .code(),
        Some(2)
    );
}
