//! P1-FL06 AC2 (R128): skill still shows on every assist level. Round a Feel Lab scene (`maps/lab/canyon-leap.json`,
//! P1-FL09), two drivers who drive well lap the same car, one with assists Off and one with Lots. Driving well is
//! scripted: pure pursuit on the route line, flat out, braking late and hard only for the corner speed the car's own
//! turn (`arcade.turn_g`) allows, and taking the scene's features at their design speeds: the canyon leap inside its
//! speed window, the crest at the speed it keeps a car grounded. (The autopilot is no yardstick here: it is a cautious
//! bot that Lots' auto-throttle speeds up.) The Off driver is faster: Lots' brake assist and slide catch hold a good
//! driver back.
#![cfg(not(target_arch = "wasm32"))]

mod common;

use common::good_driver::lap_time;
use jj_map::load_json;
use jj_sim::VehicleProfile;
use jj_sim::assist::AssistLevel;

const LAPS: u32 = 2;

fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn an_off_driver_beats_a_lots_driver_round_a_lab_scene_when_both_drive_well() {
    let bytes = std::fs::read(root().join("maps/lab/canyon-leap.json")).unwrap();
    let map = load_json(&bytes, &jj_procgen::registry()).expect("the lab scene loads");
    for (id, profile) in VehicleProfile::roster(&root()).unwrap() {
        if profile.tuning.arcade.is_none() {
            continue; // the bikes keep Rapier's tyres (no arcade controller to assist)
        }
        let off = lap_time(&map, &profile, AssistLevel::Off, LAPS);
        let lots = lap_time(&map, &profile, AssistLevel::Lots, LAPS);
        eprintln!("{id}: Off {off:.2} s, Lots {lots:.2} s over {LAPS} laps");
        assert!(
            off < lots,
            "{id}: Off {off:.2} s must beat Lots {lots:.2} s"
        );
    }
}
