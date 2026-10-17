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
    // The ACTION use throws the front boomerang (P1-W02a): the sanga moves up, nothing is refused, one flight is out.
    let end = rows.last().unwrap();
    assert_eq!(front(end), "sanga");
    assert!(back(end).is_null());
    assert!(end["items"]["refusals"].as_array().unwrap().is_empty());
    assert_eq!(end["items"]["effects"].as_array().unwrap().len(), 1);
    assert_eq!(end["items"]["boomerangs"].as_array().unwrap().len(), 1);
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

/// The boomerang flights at the end of a run (P1-W02a): one object per throw, `hits`, `ended` as `[tick, "caught"|...]`.
fn flights(output: &jj_fixture::RunOutput) -> Vec<Value> {
    let end = output.recorded.observations.last().unwrap();
    eprintln!("flights: {}", end["items"]["boomerangs"]);
    end["items"]["boomerangs"].as_array().unwrap().clone()
}
fn hits_on(flight: &Value, car: u64) -> Vec<&Value> {
    flight["hits"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|h| h["car"] == car)
        .collect()
}
fn ended(flight: &Value) -> &str {
    flight["ended"][1].as_str().unwrap_or("")
}

#[test]
fn boomerang_hit_crossing_miss_and_self_catch() {
    let f = flights(&scenario(include_bytes!(
        "../../../scenarios/items/boomerang-crossing.json"
    )));
    assert_eq!(f.len(), 1);
    assert!(!hits_on(&f[0], 1).is_empty(), "the crossing car is hit");
    let f = flights(&scenario(include_bytes!(
        "../../../scenarios/items/boomerang-miss.json"
    )));
    assert_eq!(f.len(), 1);
    assert!(f[0]["hits"].as_array().unwrap().is_empty());
    let f = flights(&scenario(include_bytes!(
        "../../../scenarios/items/boomerang-self-catch.json"
    )));
    assert_eq!(f.len(), 1);
    assert!(f[0]["hits"].as_array().unwrap().is_empty());
    assert_eq!(ended(&f[0]), "caught");
}

#[test]
fn boomerang_vs_sanga_takes_a_fifth_of_the_push() {
    let f = flights(&scenario(include_bytes!(
        "../../../scenarios/items/boomerang-vs-sanga.json"
    )));
    let hits = hits_on(&f[0], 1);
    assert!(!hits.is_empty());
    let want = jj_sim::items::boomerang::HIT_DV_MPS * jj_sim::items::boomerang::SANGA_SCALE;
    assert!((hits[0]["dvMps"].as_f64().unwrap() as f32 - want).abs() < 1e-4);
}

#[test]
fn boomerang_stopped_by_debris_and_wall_leaves_the_target_untouched() {
    for bytes in [
        &include_bytes!("../../../scenarios/items/boomerang-vs-debris.json")[..],
        &include_bytes!("../../../scenarios/items/boomerang-into-wall-behind-target.json")[..],
    ] {
        let f = flights(&scenario(bytes));
        assert_eq!(f.len(), 1);
        assert_eq!(ended(&f[0]), "stopped");
        assert!(hits_on(&f[0], 1).is_empty());
    }
}

#[test]
fn boomerang_respawn_during_flight_drops_it() {
    let f = flights(&scenario(include_bytes!(
        "../../../scenarios/items/boomerang-respawn-during-flight.json"
    )));
    assert_eq!(ended(&f[0]), "dropped");
}

#[test]
fn boomerang_24_car_crowd_hits_each_car_at_most_once_a_leg() {
    let f = flights(&scenario(include_bytes!(
        "../../../scenarios/items/boomerang-24-car-crowd.json"
    )));
    assert!(!f[0]["hits"].as_array().unwrap().is_empty());
    for c in 1..24u64 {
        for leg in ["out", "back"] {
            let n = hits_on(&f[0], c).iter().filter(|h| h["leg"] == leg).count();
            assert!(n <= 1, "car {c} hit {n} times on {leg}");
        }
    }
}

#[test]
fn boomerang_cleanup_round_end_drops_the_flight_and_debris_keeps_moving() {
    let output = scenario(include_bytes!(
        "../../../scenarios/items/boomerang-cleanup.json"
    ));
    let f = flights(&output);
    assert_eq!(f.len(), 1);
    assert_eq!(ended(&f[0]), "dropped");
    let rows = &output.recorded.observations;
    // The map's own props plus the fixture's two crates: none deleted, merged or frozen between the two observations.
    let (before, after) = (
        rows[0]["debris"].as_array().unwrap(),
        rows.last().unwrap()["debris"].as_array().unwrap(),
    );
    assert_eq!(before.len(), after.len(), "no debris was deleted");
    assert!(after.len() >= 2 && after.iter().all(|d| d["dynamic"] == true));
    for (b, a) in before.iter().zip(after).rev().take(2) {
        assert_ne!(b["x"], a["x"], "the crate is still moving after round end");
    }
}
