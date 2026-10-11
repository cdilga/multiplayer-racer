//! P1-W01 scenario bank through the same native/host fixture runner, including journal replay.
use jj_fixture::{Fixture, run};
use jj_map::{Registry, load_json};
use jj_sim::VehicleProfile;
use serde_json::Value;

fn scenario(bytes: &[u8]) -> jj_fixture::RunOutput {
    let fx: Fixture = serde_json::from_slice(bytes).unwrap();
    let registry = Registry::generic();
    let map = load_json(include_bytes!("../../../maps/greybox-loop.json"), &registry).unwrap();
    let output = run(&fx, &map, &registry, &VehicleProfile::cruz(), true).unwrap();
    assert!(output.ok(), "{}: {:?}", fx.scenario, output.recorded.checks);
    output
}
fn front(row: &Value) -> &Value {
    &row["items"]["queues"][0]["queue"]["front"]["item"]
}
fn back(row: &Value) -> &Value {
    &row["items"]["queues"][0]["queue"]["back"]["item"]
}

#[test]
fn scheduled_offers_preserve_fifo_full_queue_and_action_refusal_and_replay() {
    let output = scenario(include_bytes!(
        "../../../scenarios/items/queue-refusal.json"
    ));
    let rows = &output.recorded.observations;
    assert_eq!(front(&rows[0]), "boomerang");
    assert_eq!(back(&rows[0]), "sanga");
    assert_eq!(rows[0]["items"]["events"].as_array().unwrap().len(), 2);
    let end = rows.last().unwrap();
    assert_eq!(front(end), "boomerang");
    assert_eq!(back(end), "sanga");
    assert_eq!(end["items"]["refusals"][0][2], "unavailable");
    assert_eq!(end["items"]["effects"].as_array().unwrap().len(), 0);
    assert!(output.recorded.trace.iter().any(|row| {
        row["items"]["refusals"]
            .as_array()
            .is_some_and(|r| !r.is_empty())
    }));
}

#[test]
fn scheduled_recovery_clears_held_items_and_blocks_a_protected_offensive_offer() {
    let output = scenario(include_bytes!(
        "../../../scenarios/items/respawn-queue.json"
    ));
    let rows = &output.recorded.observations;
    assert_eq!(front(&rows[0]), "sanga");
    assert_eq!(back(&rows[0]), "boomerang");
    assert!(front(&rows[1]).is_null());
    assert!(back(&rows[1]).is_null());
    assert_eq!(front(&rows[2]), "sanga");
    assert!(back(&rows[2]).is_null());
    assert_eq!(
        rows.last().unwrap()["items"]["events"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}
