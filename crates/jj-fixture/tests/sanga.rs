//! W03b: real simulation contact/timer fixtures, journal replay and counterfactual controls.
use jj_fixture::{Fixture, RunOutput, run};
use jj_map::{Registry, load_json};
use jj_sim::VehicleProfile;
use serde_json::Value;

fn run_fixture(fx: &Fixture) -> RunOutput {
    let registry = Registry::generic();
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(&fx.map),
    )
    .unwrap();
    let map = load_json(&bytes, &registry).unwrap();
    let out = run(fx, &map, &registry, &VehicleProfile::cruz(), true).unwrap();
    assert!(out.ok(), "{}: {:?}", fx.scenario, out.recorded.checks);
    out
}
fn fixture(bytes: &[u8]) -> Fixture {
    serde_json::from_slice(bytes).unwrap()
}
fn car(row: &Value, id: usize) -> &Value {
    &row["cars"][id]
}
fn health(row: &Value, id: usize) -> Vec<f64> {
    car(row, id)["parts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["health"].as_f64().unwrap())
        .collect()
}

#[test]
fn tank_push_and_ram_immunity_are_physical_and_replay() {
    for bytes in [
        include_bytes!("../../../scenarios/items/sanga-tank-push.json").as_slice(),
        include_bytes!("../../../scenarios/items/sanga-ram-immunity.json").as_slice(),
        include_bytes!("../../../scenarios/items/sanga-solid-terrain.json").as_slice(),
    ] {
        let mut fx = fixture(bytes);
        let shield = run_fixture(&fx);
        let rows = &shield.recorded.observations;
        assert_eq!(
            health(&rows[0], 0),
            health(rows.last().unwrap(), 0),
            "shielded car has no contact damage"
        );
        assert!(car(rows.last().unwrap(), 0)["sanga"].is_object());
        let end = rows.last().unwrap();
        println!(
            "{}: speed={} target_speed={} heading={} buff={}",
            fx.scenario,
            car(end, 0)["forwardSpeed"],
            end["cars"]
                .get(1)
                .map_or(Value::Null, |c| c["forwardSpeed"].clone()),
            car(end, 0)["headingDeg"],
            car(end, 0)["sanga"]
        );
        // Same physical collision without the pickup must exercise ordinary damage/response.
        fx.pickups.clear();
        fx.expect.clear();
        let control = run_fixture(&fx);
        assert_ne!(
            health(&control.recorded.observations[0], 0),
            health(control.recorded.observations.last().unwrap(), 0),
            "control confirms the collision actually damages an ordinary car"
        );
        if fx.scenario == "sanga-solid-terrain" {
            assert!(
                car(end, 0)["position"][0].as_f64().unwrap() < 37.0,
                "fixed wall blocks the buffed body"
            );
        }
        if fx.scenario == "sanga-tank-push" {
            let end = rows.last().unwrap();
            let gap = car(end, 1)["position"][0].as_f64().unwrap()
                - car(end, 0)["position"][0].as_f64().unwrap();
            assert!(gap > 0.0, "target stays ahead, no pass through: {gap}");
            let registry = Registry::generic();
            let map = load_json(
                include_bytes!("../../../scenarios/damage/yard.json"),
                &registry,
            )
            .unwrap();
            let replay = jj_sim::Sim::replay(
                &map,
                &registry,
                VehicleProfile::cruz(),
                &shield.journal,
                shield.ticks,
            );
            let depth = replay
                .car_overlap_depth_m(jj_sim::CarId(0), jj_sim::CarId(1))
                .unwrap();
            assert!(
                depth < 0.025,
                "actual attached collider penetration: {depth} m"
            );
            println!("tank push: centre gap={gap} m, actual collider penetration={depth} m");
            assert!(
                car(end, 1)["linvel"][0].as_f64().unwrap() > 10.0,
                "target is genuinely pushed"
            );
        }
    }
}

#[test]
fn six_seconds_refresh_without_stacking_and_no_mass_change() {
    let mut fx = fixture(include_bytes!(
        "../../../scenarios/items/sanga-refresh.json"
    ));
    let out = run_fixture(&fx);
    let rows = &out.recorded.observations;
    let used = rows.last().unwrap()["items"]["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"].get("Used").is_some())
        .collect::<Vec<_>>();
    assert_eq!(used.len(), 2);
    let first = &rows[0]["items"]["effects"][0];
    let second = &rows[1]["items"]["effects"][1];
    assert_eq!(
        first["expires_at"].as_u64().unwrap() - first["started"].as_u64().unwrap(),
        720
    );
    assert_eq!(
        second["expires_at"].as_u64().unwrap() - second["started"].as_u64().unwrap(),
        720
    );
    assert!(
        car(&rows[2], 0)["sanga"].is_object(),
        "first expiry does not cancel the refreshed buff"
    );
    assert!(car(rows.last().unwrap(), 0)["sanga"].is_null());
    assert!(
        rows.last().unwrap()["items"]["effects"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(rows.last().unwrap()["items"]["queues"][0]["queue"]["front"].is_null());
    fx.pickups.clear();
    let control = run_fixture(&fx);
    for (shield, control) in rows.iter().zip(&control.recorded.observations) {
        // Owner 2026-10-31: a sanga now adds drive (items::boost), so position and velocity differ; the car itself does not.
        for field in ["massKg", "maxEngineForce"] {
            assert_eq!(
                car(shield, 0)[field],
                car(control, 0)[field],
                "normal driving unchanged: {field}"
            );
        }
    }
}

#[test]
fn exact_expiry_during_an_overlap_has_no_launch() {
    let out = run_fixture(&fixture(include_bytes!(
        "../../../scenarios/items/sanga-ends-cleanly.json"
    )));
    let rows = &out.recorded.observations;
    for row in rows {
        let tick = row["tick"].as_u64().unwrap();
        if tick == 979 {
            assert!(car(row, 0)["sanga"].is_object());
        }
        if tick == 980 {
            assert!(
                car(row, 0)["sanga"].is_null(),
                "ends at the exact card tick"
            );
        }
    }
    println!("ends cleanly: {:?}", out.recorded.checks);
}

#[test]
fn immune_contacts_still_give_the_driver_causal_ownership_of_pushed_debris() {
    let fx = fixture(include_bytes!(
        "../../../scenarios/items/sanga-debris-attribution.json"
    ));
    let out = run_fixture(&fx);
    let registry = Registry::generic();
    let map = load_json(
        include_bytes!("../../../scenarios/damage/yard.json"),
        &registry,
    )
    .unwrap();
    let replay = jj_sim::Sim::replay(
        &map,
        &registry,
        VehicleProfile::cruz(),
        &out.journal,
        out.ticks,
    );
    let pushed = jj_sim::Sim::replay(&map, &registry, VehicleProfile::cruz(), &out.journal, 350);
    assert_eq!(
        pushed.prop_owner(0).map(|o| o.car),
        Some(0),
        "buffed driver owns the prop it pushes"
    );
    let credited = replay.damage_events().iter().any(|(_, event)| {
        matches!(event, jj_sim::damage::DamageEvent::Episode(r)
            if r.car == 1 && matches!(r.other, jj_sim::damage::OtherBody::Prop { prop: 0 })
                && r.other_owner.map(|o| o.car) == Some(0))
    });
    assert!(
        credited,
        "the prop's hit on the other car credits the buffed driver"
    );
    println!(
        "Sanga debris: first owner={:?}; victim impact credited={credited}; current owner={:?}",
        pushed.prop_owner(0),
        replay.prop_owner(0)
    );
    assert_eq!(
        health(&out.recorded.observations[0], 0),
        health(out.recorded.observations.last().unwrap(), 0)
    );
}
