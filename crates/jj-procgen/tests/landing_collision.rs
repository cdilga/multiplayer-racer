//! br-bbki.25 (owner playtest 2026-10-17: "there were some issues when landing and colliding which kinda re launched the
//! car into the air in a strange way"). The Feel Lab's canyon leap (`maps/lab/canyon-leap.json`), flown as
//! `scenarios/lab/air-pitch-neutral.json` flies it, first alone (where it touches down), then into a second car parked
//! on that spot. After the first touchdown the car must stay on the ground: no climb faster than `RELAUNCH_MPS`, no
//! second flight. Prints what it saw (`--nocapture`). A guard, not yet the reproduction: the relaunch the owner saw
//! isn't reproduced here (see the bead).
#![cfg(not(target_arch = "wasm32"))]

use jj_map::load_json;
use jj_sim::journal::SpawnPose;
use jj_sim::{CarId, DriveInput, Sim, TICK_HZ, VehicleProfile};

/// After touchdown the car may rise this fast at most (m/s): suspension rebound, not a launch.
const RELAUNCH_MPS: f32 = 3.0;

fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

struct Flight {
    touchdown: Option<([f32; 3], u64)>,
    max_up_after: f32,
    air_after_ticks: u32,
    longest_air_after: u32,
    /// How the landing was judged (R16), if it was.
    tier: Option<jj_sim::air::LandingTier>,
    /// Highest the centre went above where it touched down (m).
    rise_after: f32,
}

/// Flies the neutral run: full throttle to the lip (tick 66), then nothing; `parked` puts a second car at a spot.
fn fly(parked: Option<[f32; 3]>) -> Flight {
    fly_with(parked, (0, 0))
}

/// As [`fly`], holding `air` (throttle, brake) from the lip on: throttle raises the nose, brake lowers it (br-bbki.24).
fn fly_with(parked: Option<[f32; 3]>, air: (i16, i16)) -> Flight {
    let bytes = std::fs::read(root().join("maps/lab/canyon-leap.json")).unwrap();
    let map = load_json(&bytes, &jj_procgen::registry()).expect("the lab scene loads");
    let mut sim = Sim::new(&map, &jj_procgen::registry(), 1, VehicleProfile::cruz());
    let cars = sim.spawn_grid(2);
    let (car, other) = (cars[0], cars[1]);
    sim.start_race(1);
    // Past the countdown (a held grid ignores DRIVE, R127) and out of spawn protection.
    for _ in 0..(6 * TICK_HZ) {
        sim.step();
    }
    sim.set_autopilot(car, false); // a player's car (a bot flies neutral)
    let h = (-90.0f32).to_radians();
    sim.place_car(
        car,
        SpawnPose {
            x: -43.796,
            y: 20.42,
            z: 45.0,
            heading: h,
        },
        0.0,
        [-22.0, 0.0, 0.0],
    );
    match parked {
        Some([x, y, z]) => sim.place_car(
            other,
            SpawnPose {
                x,
                y: y + 0.3,
                z,
                heading: h,
            },
            0.0,
            [0.0; 3],
        ),
        None => sim.place_car(
            other,
            SpawnPose {
                x: 200.0,
                y: 40.0,
                z: 200.0,
                heading: h,
            },
            0.0,
            [0.0; 3],
        ),
    }
    let mut out = Flight {
        touchdown: None,
        max_up_after: 0.0,
        air_after_ticks: 0,
        longest_air_after: 0,
        tier: None,
        rise_after: 0.0,
    };
    let seen = sim.race().events().len();
    let (mut flying, mut was_air, mut run) = (false, false, 0u32);
    for t in 0..(5 * TICK_HZ as u64) {
        let (throttle, brake) = if t < 66 { (i16::MAX, 0) } else { air };
        sim.set_input(
            car,
            DriveInput {
                throttle,
                brake,
                ..Default::default()
            },
        );
        sim.step();
        let st = sim.car_state(car).unwrap();
        if std::env::var_os("JJ_TRACE").is_some() && (200..420).contains(&t) {
            eprintln!(
                "  t {t} y {:.2} vy {:.2} upY {:.2} w [{:.1} {:.1} {:.1}] wheels {} fwd {:.1}",
                st.position[1],
                st.linvel[1],
                st.up_y,
                st.angvel[0],
                st.angvel[1],
                st.angvel[2],
                st.wheels_in_contact,
                st.forward_speed
            );
        }
        let air = st.wheels_in_contact == 0;
        if t > 40 && air {
            flying = true;
        }
        if flying && !air && out.touchdown.is_none() {
            out.touchdown = Some((st.position, t));
        }
        if let Some((at_pos, at)) = out.touchdown
            && t > at
            && t <= at + u64::from(TICK_HZ) * 3 / 2
        {
            out.max_up_after = out.max_up_after.max(st.linvel[1]);
            out.rise_after = out.rise_after.max(st.position[1] - at_pos[1]);
            if air {
                out.air_after_ticks += 1;
                run += 1;
                out.longest_air_after = out.longest_air_after.max(run);
            } else {
                run = 0;
            }
        }
        was_air = air;
    }
    let _ = (was_air, CarId(0));
    out.tier = sim.race().events()[seen..]
        .iter()
        .find_map(|(_, e)| match e {
            jj_sim::race::Event::Landed { car: c, tier, .. } if *c == car.0 => Some(*tier),
            _ => None,
        });
    out
}

/// The crash path (R16): braking through the flight noses the car past `crashDeg`, so it lands nose first and is righted
/// by the crash torque. Righting must put it back on its wheels, not throw it: the owner's "re launched the car into the
/// air in a strange way" (br-bbki.25).
#[test]
fn a_crash_landing_is_righted_without_relaunching_the_car() {
    for air in [
        (0, i16::MAX / 2),
        (0, i16::MAX),
        (i16::MAX, 0),
        (i16::MAX / 2, 0),
    ] {
        let f = fly_with(None, air);
        eprintln!(
            "air (throttle, brake) {air:?}: tier {:?}, touchdown {:?}, rise after {:.2} m, max up after {:.2} m/s, air after {} ticks (longest {})",
            f.tier,
            f.touchdown,
            f.rise_after,
            f.max_up_after,
            f.air_after_ticks,
            f.longest_air_after
        );
        assert!(
            f.max_up_after < RELAUNCH_MPS && f.longest_air_after < TICK_HZ / 4,
            "{air:?}: {:?} landing rose at {:.2} m/s and flew {} ticks after touchdown",
            f.tier,
            f.max_up_after,
            f.longest_air_after
        );
    }
}

#[test]
fn landing_into_a_parked_car_does_not_relaunch_the_lander() {
    let alone = fly(None);
    let (spot, at) = alone.touchdown.expect("the neutral run lands");
    let into = fly(Some(spot));
    eprintln!(
        "alone: touchdown {spot:?} at tick {at}, max up after {:.2} m/s, air after {} ticks (longest {}); into a parked car: touchdown {:?}, max up after {:.2} m/s, air after {} ticks (longest {})",
        alone.max_up_after,
        alone.air_after_ticks,
        alone.longest_air_after,
        into.touchdown,
        into.max_up_after,
        into.air_after_ticks,
        into.longest_air_after
    );
    assert!(
        alone.max_up_after < RELAUNCH_MPS,
        "alone: rose at {:.2} m/s after touchdown",
        alone.max_up_after
    );
    assert!(
        into.max_up_after < RELAUNCH_MPS && into.longest_air_after < TICK_HZ / 4,
        "into a parked car: rose at {:.2} m/s and flew {} ticks after touchdown",
        into.max_up_after,
        into.longest_air_after
    );
}
