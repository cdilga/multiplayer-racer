//! The vehicle feel bank (P1-S03a, plan §7.3, §7.3a): every §7.3 feel scenario (`scenarios/feel/`) and every S03-owned
//! affordance row (`scenarios/affordances/`) runs natively through the shared fixture runner (`jj-fixture`, the same
//! code as `jj sim`), on the Cruz Missile built from its baked sidecar (`assets/profiles/cruz-missile.json`). Each must
//! hold its envelopes, replay to the same full-state hash, and come out different from its baselines (no input,
//! mashing, and for affordance rows holding the first input). The WASM half of the parity rule (§7.2) runs the same
//! files through the host's worker build in Node: `web/host/tests/feel-wasm.test.mjs`.

use std::path::{Path, PathBuf};

use jj_fixture::{BaselineKind, Fixture, run};
use jj_map::{Registry, load_json};
use jj_sim::VehicleProfile;

/// The S03-owned affordance rows (the shared ones, `slalom`, `air-level` and `jump-land`, live in `scenarios/feel/`).
const S03_ROWS: [&str; 6] = [
    "fwd-back-rest",
    "brake-stop",
    "turn-around",
    "unstick-wall",
    "authority",
    "rejoin-route",
];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn bank() -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(repo().join("scenarios/feel"))
        .expect("scenarios/feel")
        .map(|e| e.expect("entry").path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    files.extend(
        S03_ROWS
            .iter()
            .map(|r| repo().join(format!("scenarios/affordances/{r}.json"))),
    );
    files
}

#[test]
fn every_feel_scenario_and_s03_affordance_row_holds_its_envelopes_and_beats_its_baselines() {
    let profile = VehicleProfile::cruz();
    let registry = Registry::generic();
    let mut failures = Vec::new();
    let files = bank();
    assert!(files.len() >= 12, "the bank: {files:?}");
    for file in &files {
        let fx: Fixture =
            serde_json::from_slice(&std::fs::read(file).expect("read")).expect("parse");
        let map = load_json(
            &std::fs::read(repo().join(&fx.map)).expect("map"),
            &registry,
        )
        .expect("map validates");
        let affordance = file.to_string_lossy().contains("affordances");
        let b = fx
            .baselines
            .as_ref()
            .unwrap_or_else(|| panic!("{} declares no baselines", fx.scenario));
        assert!(
            b.kinds.contains(&BaselineKind::NoInput) && b.kinds.contains(&BaselineKind::Mash),
            "{}: no-input and mash baselines",
            fx.scenario
        );
        assert!(
            !affordance || b.kinds.contains(&BaselineKind::Hold),
            "{}: affordance rows add hold",
            fx.scenario
        );
        assert!(
            fx.cars.len() >= 2,
            "{}: several starting states",
            fx.scenario
        );
        assert!(!fx.expect.is_empty(), "{}: envelopes", fx.scenario);
        let out = run(&fx, &map, &registry, &profile, false).expect("runs");
        if !out.ok() {
            let bad: Vec<String> =
                out.recorded
                    .checks
                    .iter()
                    .filter(|c| !c.ok)
                    .map(|c| {
                        format!(
                            "car {} {:?}@{:?} = {:?} not in [{}, {}]",
                            c.car, c.metric, c.at_tick, c.actual, c.min, c.max
                        )
                    })
                    .chain(
                        out.baselines.iter().filter(|b| !b.ok).map(|b| {
                            format!("{:?} baseline didn't differ: {:?}", b.kind, b.differ)
                        }),
                    )
                    .chain((!out.replay_matches()).then(|| "replay differs".to_owned()))
                    .collect();
            failures.push(format!("{}: {}", fx.scenario, bad.join("; ")));
        }
    }
    assert!(
        failures.is_empty(),
        "feel bank:\n  {}",
        failures.join("\n  ")
    );
}
