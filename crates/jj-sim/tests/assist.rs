//! R125 learner assists and gentle catch-up (br-2mxa), on the greybox loop with scripted drivers (fixtures in
//! `scenarios/assist/`). Every run also replays from its journal to the same full-state hash.

use std::path::{Path, PathBuf};

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::assist::{AssistLevel, CatchUp};
use jj_sim::autopilot::{Path as Route, Pose2};
use jj_sim::{CarId, DriveInput, Sim, TICK_HZ, VehicleProfile};
use jj_types::axis::{dequantise_axis, quantise_axis};
use serde_json::Value;

const S: u64 = TICK_HZ as u64;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn fixture(name: &str) -> Value {
    serde_json::from_slice(&std::fs::read(repo().join("scenarios/assist").join(name)).unwrap())
        .unwrap()
}

fn map_of(fx: &Value) -> LoadedMap {
    let bytes = std::fs::read(repo().join(fx["map"].as_str().unwrap())).unwrap();
    load_json(&bytes, &Registry::generic()).expect("map validates")
}

fn pose(sim: &Sim, car: CarId) -> Pose2 {
    let s = sim.car_state(car).unwrap();
    Pose2 {
        x: s.position[0],
        y: s.position[1],
        z: s.position[2],
        heading: s.heading,
        forward_speed: s.forward_speed,
    }
}

fn profile() -> VehicleProfile {
    VehicleProfile::cruz()
}

#[test]
fn the_state_hash_distinguishes_which_car_has_assist_before_it_steps() {
    let map = map_of(&fixture("catch-up.json"));
    let mut a = Sim::new(&map, &Registry::generic(), 7, profile());
    let mut b = Sim::new(&map, &Registry::generic(), 7, profile());
    let ca = a.spawn_grid(2);
    let cb = b.spawn_grid(2);
    assert_eq!(a.state_hash(), b.state_hash());
    a.set_assist(ca[0], AssistLevel::Some);
    b.set_assist(cb[1], AssistLevel::Some);
    assert_ne!(
        a.state_hash(),
        b.state_hash(),
        "the car association is future gameplay state"
    );
}

fn line_steer(route: &Route, p: Pose2) -> f32 {
    // The lock the car has at this speed, as the sim hands the assists (P1-FL04.2).
    let lock = profile().steer_lock(p.forward_speed);
    route
        .probe(None, p, lock, profile().wheelbase(), [0.8, 6.0, 6.0])
        .steer
}

struct Novice {
    noise: jj_sim::rng::Rng,
    now: f32,
    target: f32,
    follow: f32,
    amp: f32,
    every: u64,
    smooth: f32,
}

impl Novice {
    fn new(fx: &Value, seed: u64) -> Self {
        let n = &fx["novice"];
        Self {
            noise: jj_sim::rng::Rng::stream(seed, "novice"),
            now: 0.0,
            target: 0.0,
            follow: n["follow"].as_f64().unwrap() as f32,
            amp: n["noiseAmp"].as_f64().unwrap() as f32,
            every: (n["noiseEveryS"].as_f64().unwrap() * f64::from(TICK_HZ)) as u64,
            smooth: n["noiseSmooth"].as_f64().unwrap() as f32,
        }
    }

    /// Throttle pinned, steering toward the line at `follow` of what is needed, plus seeded noise.
    fn input(&mut self, tick: u64, line: f32) -> DriveInput {
        if tick.is_multiple_of(self.every) {
            self.target = (self.noise.next_f32() * 2.0 - 1.0) * self.amp;
        }
        self.now += (self.target - self.now) * self.smooth;
        DriveInput {
            throttle: quantise_axis(1.0),
            steer: quantise_axis((line * self.follow + self.now).clamp(-1.0, 1.0)),
            ..Default::default()
        }
    }
}

#[derive(Debug)]
struct Outcome {
    finished: bool,
    crashes: u32,
    seconds: f32,
    progress: f32,
}

fn novice_run(fx: &Value, map: &LoadedMap, seed: u64, level: AssistLevel) -> (Outcome, [u8; 32]) {
    let route = Route::new(map);
    let laps = fx["laps"].as_u64().unwrap() as u32;
    let max = fx["maxSeconds"].as_u64().unwrap() * S;
    let mut sim = Sim::new(map, &Registry::generic(), seed, profile());
    let car = sim.spawn_grid(1)[0];
    sim.set_assist(car, level);
    sim.start_race(laps);
    let mut novice = Novice::new(fx, seed);
    // A player who sits stuck for 3 s presses Recover (counted as a crash, like a wreck).
    let (mut slow_ticks, mut recoveries) = (0u64, 0u32);
    while !sim.race().is_finished(car.0) && sim.tick() < max {
        let line = line_steer(&route, pose(&sim, car));
        sim.set_input(car, novice.input(sim.tick(), line));
        sim.step();
        slow_ticks = if sim.car_state(car).unwrap().forward_speed.abs() < 1.0 {
            slow_ticks + 1
        } else {
            0
        };
        if slow_ticks >= 3 * S && sim.recover(car) {
            recoveries += 1;
            slow_ticks = 0;
        }
    }
    let rc = sim.race().car(car.0).unwrap();
    let out = Outcome {
        finished: rc.finished_at.is_some(),
        crashes: rc.wrecks + rc.recoveries + recoveries,
        seconds: sim.tick() as f32 / TICK_HZ as f32,
        progress: sim.race().progress_m(car.0),
    };
    let hash = sim.state_hash();
    let replay = Sim::replay(
        map,
        &Registry::generic(),
        profile(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(
        replay.state_hash(),
        hash,
        "seed {seed} {level:?} replays bit for bit"
    );
    (out, hash)
}

#[test]
fn a_scripted_novice_laps_with_lots_and_some_and_crashes_more_with_off() {
    let fx = fixture("novice-laps.json");
    let map = map_of(&fx);
    let seeds: Vec<u64> = fx["seeds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_u64().unwrap())
        .collect();
    let mut rows = Vec::new();
    for level in [AssistLevel::Off, AssistLevel::Some, AssistLevel::Lots] {
        let outs: Vec<Outcome> = seeds
            .iter()
            .map(|&s| novice_run(&fx, &map, s, level).0)
            .collect();
        let finished = outs.iter().filter(|o| o.finished).count();
        let crashes: u32 = outs.iter().map(|o| o.crashes).sum();
        let secs: f32 = outs.iter().map(|o| o.seconds).sum::<f32>() / outs.len() as f32;
        for (s, o) in seeds.iter().zip(&outs) {
            eprintln!("  seed {s} {level:?}: {o:?} (progress {:.0} m)", o.progress);
        }
        eprintln!(
            "NOVICE {level:?}: finished {finished}/{} crashes {crashes} mean {secs:.1}s",
            outs.len()
        );
        rows.push((finished, crashes));
    }
    let (off, some, lots) = (rows[0], rows[1], rows[2]);
    let e = &fx["expect"];
    assert!(
        some.0 >= e["someMinFinished"].as_u64().unwrap() as usize,
        "Some laps: {rows:?}"
    );
    assert!(
        lots.0 >= e["lotsMinFinished"].as_u64().unwrap() as usize,
        "Lots laps: {rows:?}"
    );
    assert!(
        off.1 >= some.1 + e["offMinCrashesOverSome"].as_u64().unwrap() as u32,
        "Off crashes more than Some: {rows:?}"
    );
    assert!(off.1 > lots.1, "Off crashes more than Lots: {rows:?}");
}

/// The line pull never fights a full-lock input. The slide catch (P1-FL06, R128) is the stated exception: while the car
/// is sliding past `slide.startDeg` it takes its share of the steering, always against the slide.
#[test]
fn assists_never_fight_a_full_lock_input() {
    let fx = fixture("novice-laps.json");
    let map = map_of(&fx);
    for level in [AssistLevel::Some, AssistLevel::Lots] {
        for lock in [1.0f32, -1.0, 0.92, -0.92] {
            let mut sim = Sim::new(&map, &Registry::generic(), 3, profile());
            let car = sim.spawn_grid(1)[0];
            sim.set_assist(car, level);
            sim.start_race(2);
            let want = quantise_axis(lock);
            for _ in 0..(8 * S) {
                // Full lock with the throttle held: the assist may brake, but never touches the steering.
                sim.set_input(
                    car,
                    DriveInput {
                        throttle: quantise_axis(1.0),
                        steer: want,
                        ..Default::default()
                    },
                );
                sim.step();
                // A respawn hold applies no input by design (the fun-pass car plows wide at full lock and leaves the
                // greybox's bounds inside 8 s); everywhere else the steering must be the player's.
                // The input is applied at the tick before the step; a hold zeroes it there.
                if sim.race().is_held(car.0, sim.tick() - 1) {
                    continue;
                }
                let got = sim.applied_input(car).unwrap().steer;
                let report = sim.assist_report(car).unwrap();
                if report.slide_catch > 0.0 {
                    // Caught: the steer moved from the player's toward the counter-steer, never further into the slide.
                    let (got, drift) = (dequantise_axis(got), report.drift_deg);
                    assert!(
                        got * drift.signum() < lock * drift.signum() + 1e-3,
                        "{level:?} lock {lock}: steer {got} against drift {drift}"
                    );
                    continue;
                }
                assert_eq!(got, want, "{level:?} lock {lock}");
            }
        }
    }
    // Near centre it does help: a centred stick on a bend is pulled toward the line by the level's `steerToLine` share.
    let route = Route::new(&map);
    let tuned = jj_sim::assist::AssistProfile::standard();
    for (level, share) in [
        (AssistLevel::Some, tuned.some.steer_to_line),
        (AssistLevel::Lots, tuned.lots.steer_to_line),
    ] {
        let mut sim = Sim::new(&map, &Registry::generic(), 3, profile());
        let car = sim.spawn_grid(1)[0];
        sim.set_assist(car, level);
        sim.start_race(2);
        let mut seen = false;
        for _ in 0..(30 * S) {
            sim.set_input(
                car,
                DriveInput {
                    throttle: quantise_axis(0.4),
                    ..Default::default()
                },
            );
            let line = line_steer(&route, pose(&sim, car));
            sim.step();
            let got = dequantise_axis(sim.applied_input(car).unwrap().steer);
            if line.abs() > 0.2 {
                seen = true;
                assert!(
                    (got - share * line).abs() < 0.06,
                    "{level:?}: {got} vs {share} x {line}"
                );
            }
        }
        assert!(seen, "the loop has a bend");
    }
}

#[test]
fn lots_turns_the_wheelie_off() {
    let fx = fixture("novice-laps.json");
    let map = map_of(&fx);
    // Wheelie: refused for Lots only (the setup command is journaled either way).
    for (level, ok) in [
        (AssistLevel::Off, true),
        (AssistLevel::Some, true),
        (AssistLevel::Lots, false),
    ] {
        let mut sim = Sim::new(&map, &Registry::generic(), 4, profile());
        let car = sim.spawn_grid(1)[0];
        sim.set_assist(car, level);
        sim.start_race(2);
        for _ in 0..S {
            sim.step();
        }
        assert_eq!(sim.wheelie(car, 400), ok, "{level:?}");
    }
}

#[test]
fn lots_auto_throttles_and_brakes_before_bends_and_the_brake_still_works() {
    let fx = fixture("novice-laps.json");
    let map = map_of(&fx);
    let route = Route::new(&map);
    let mut sim = Sim::new(&map, &Registry::generic(), 5, profile());
    let car = sim.spawn_grid(1)[0];
    sim.set_assist(car, AssistLevel::Lots);
    sim.start_race(2);
    let (mut max_auto, mut max_brake) = (0.0f32, 0.0f32);
    for _ in 0..(20 * S) {
        let line = line_steer(&route, pose(&sim, car));
        sim.set_input(
            car,
            DriveInput {
                steer: quantise_axis(line),
                ..Default::default()
            },
        );
        sim.step();
        let r = sim.assist_report(car).unwrap();
        max_auto = max_auto.max(r.auto_throttle);
        max_brake = max_brake.max(r.brake_assist);
    }
    assert!(sim.car_state(car).unwrap().position[2].is_finite());
    assert!(
        max_auto > 0.5,
        "no input but steering: it drives itself ({max_auto})"
    );
    assert!(max_brake > 0.0, "and brakes for a bend ({max_brake})");
    // A held brake wins: the car stops with the throttle assist on.
    for _ in 0..(12 * S) {
        sim.set_input(
            car,
            DriveInput {
                brake: quantise_axis(1.0),
                ..Default::default()
            },
        );
        sim.step();
    }
    assert!(
        sim.car_state(car).unwrap().forward_speed < 1.0,
        "the player's brake still works"
    );
}

#[test]
fn lots_rights_a_flipped_car_at_once() {
    let fx = fixture("novice-laps.json");
    let map = map_of(&fx);
    let upright_after = |level: AssistLevel| {
        let mut sim = Sim::new(&map, &Registry::generic(), 6, profile());
        let car = sim.spawn_grid(1)[0];
        sim.set_assist(car, level);
        sim.start_race(2);
        for _ in 0..S {
            sim.step();
        }
        let p = sim.car_state(car).unwrap();
        sim.place_car(
            car,
            jj_sim::SpawnPose {
                x: p.position[0],
                y: p.position[1] + 1.0,
                z: p.position[2],
                heading: p.heading,
            },
            std::f32::consts::PI,
            [0.0; 3],
        );
        for t in 0..(6 * S) {
            sim.step();
            if sim.car_state(car).unwrap().up_y > 0.7 {
                return Some(t);
            }
        }
        None
    };
    let lots = upright_after(AssistLevel::Lots).expect("Lots rights it");
    let off = upright_after(AssistLevel::Off);
    eprintln!("FLIP lots {lots} ticks, off {off:?}");
    // The plain flip assist waits 1 s (up·Y < 0.2 and nearly still); the instant one starts at once, so it is upright about a second sooner.
    assert!(
        off.is_none_or(|o| o >= lots + S * 3 / 4),
        "the instant assist saves most of the wait: lots {lots}, off {off:?}"
    );
}

/// The follower is released when it is `gap_s` behind the leader (at the reference speed); both are Lots cars following the
/// line, so only catch-up differs between the runs.
struct Chase {
    leader_hash: [u8; 32],
    gap_start_m: f32,
    gap_end_m: f32,
    follower_lap_s: f32,
    leader_scale_max: f32,
    follower_scale_max: f32,
    follower_top: f32,
    replay_ok: bool,
}

fn leader_fingerprint(sim: &Sim, lead: CarId) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    let s = sim.car_state(lead).unwrap();
    for f in s.position.iter().chain(&s.linvel).chain(&s.rotation) {
        h.update(f.to_bits().to_le_bytes());
    }
    h.finalize().into()
}

fn chase(fx: &Value, map: &LoadedMap, mode: CatchUp) -> Chase {
    let route = Route::new(map);
    let mut sim = Sim::new(map, &Registry::generic(), 21, profile());
    let cars = sim.spawn_grid(2);
    let (lead, fol) = (cars[0], cars[1]);
    sim.set_catch_up(mode);
    for c in &cars {
        sim.set_assist(*c, AssistLevel::Lots);
    }
    sim.start_race(3);
    let want_m = fx["gapSeconds"].as_f64().unwrap() as f32
        * sim.assist_profile().catch_up.reference_speed_mps;
    let max = fx["maxSeconds"].as_u64().unwrap() * S;
    let (mut released, mut gap_start, mut lap_t0) = (false, 0.0f32, 0u64);
    let (mut lscale, mut fscale, mut ftop) = (1.0f32, 1.0f32, 0.0f32);
    let (mut gap_end, mut lap_s) = (0.0f32, 0.0f32);
    let mut leader_hash = [0u8; 32];
    while sim.tick() < max {
        let drive = |sim: &mut Sim, c: CarId| {
            let line = line_steer(&route, pose(sim, c));
            sim.set_input(
                c,
                DriveInput {
                    steer: quantise_axis(line),
                    ..Default::default()
                },
            );
        };
        drive(&mut sim, lead);
        if released {
            drive(&mut sim, fol);
        } else {
            // Held on the brake (the player's brake beats the auto-throttle) until the gap is 10 s.
            sim.set_input(
                fol,
                DriveInput {
                    brake: quantise_axis(1.0),
                    ..Default::default()
                },
            );
        }
        sim.step();
        if sim.tick() == 45 * S {
            leader_hash = leader_fingerprint(&sim, lead);
        }
        let gap = sim.race().progress_m(lead.0) - sim.race().progress_m(fol.0);
        if !released && gap >= want_m {
            released = true;
            gap_start = gap;
            lap_t0 = sim.tick();
        }
        if released {
            lscale = lscale.max(sim.assist_report(lead).unwrap().catch_scale);
            fscale = fscale.max(sim.assist_report(fol).unwrap().catch_scale);
            ftop = ftop.max(sim.car_state(fol).unwrap().forward_speed);
            if sim.race().progress_m(fol.0) >= sim.race().course.length_m() {
                gap_end = gap;
                lap_s = (sim.tick() - lap_t0) as f32 / TICK_HZ as f32;
                break;
            }
        }
    }
    assert!(
        released && lap_s > 0.0,
        "the follower was released and lapped"
    );
    let replay = Sim::replay(
        map,
        &Registry::generic(),
        profile(),
        sim.journal(),
        sim.tick(),
    );
    Chase {
        leader_hash,
        gap_start_m: gap_start,
        gap_end_m: gap_end,
        follower_lap_s: lap_s,
        leader_scale_max: lscale,
        follower_scale_max: fscale,
        follower_top: ftop,
        replay_ok: replay.state_hash() == sim.state_hash(),
    }
}

#[test]
fn catch_up_closes_a_10_s_gap_by_a_stated_amount_and_never_touches_the_leader() {
    let fx = fixture("catch-up.json");
    let map = map_of(&fx);
    let off = chase(&fx, &map, CatchUp::Off);
    let on = chase(&fx, &map, CatchUp::Light);
    let reference = jj_sim::assist::AssistProfile::standard()
        .catch_up
        .reference_speed_mps;
    let closed_m = off.gap_end_m - on.gap_end_m;
    eprintln!(
        "CATCHUP off: gap {:.0}->{:.0} m lap {:.2}s top {:.1} | light: gap {:.0}->{:.0} m lap {:.2}s top {:.1} scale {:.4} | closed {:.1} m = {:.2} s",
        off.gap_start_m,
        off.gap_end_m,
        off.follower_lap_s,
        off.follower_top,
        on.gap_start_m,
        on.gap_end_m,
        on.follower_lap_s,
        on.follower_top,
        on.follower_scale_max,
        closed_m,
        closed_m / reference
    );
    assert!(off.replay_ok && on.replay_ok, "both replay bit for bit");
    // The leader gets exactly 1.0 and drives exactly the same run with catch-up on.
    assert_eq!(on.leader_scale_max, 1.0);
    assert_eq!(off.leader_scale_max, 1.0);
    assert_eq!(on.leader_hash, off.leader_hash, "the leader is untouched");
    assert_eq!(off.follower_scale_max, 1.0, "catch-up off: nobody");
    // The follower, 10 s back (share 0.78 of full), gets between 1 % and the full 6 % more drive.
    assert!(
        on.follower_scale_max > 1.01 && on.follower_scale_max <= 1.06 + 1e-6,
        "{}",
        on.follower_scale_max
    );
    // And it gains ground: at least 0.3 s of the gap, the stated amount from the fixture's measured numbers.
    assert!(closed_m / reference >= 0.3, "closed {closed_m} m");
    assert!(on.follower_lap_s < off.follower_lap_s);
}

fn roster_profile(id: &str) -> VehicleProfile {
    let json = std::fs::read_to_string(repo().join(format!("assets/profiles/{id}.json"))).unwrap();
    VehicleProfile::from_json(&json).unwrap()
}

/// The car's slip: the angle between its nose and its travel (deg, 0..180), or `None` at a crawl.
fn slip_deg(sim: &Sim, car: CarId, crawl: f32) -> Option<f32> {
    let s = sim.car_state(car).unwrap();
    let (sh, ch) = (s.heading.sin(), s.heading.cos());
    let (vf, vs) = (
        s.linvel[0] * sh + s.linvel[2] * ch,
        s.linvel[0] * ch - s.linvel[2] * sh,
    );
    (vf.hypot(vs) > crawl).then(|| vs.abs().atan2(vf).to_degrees())
}

fn replays(map: &LoadedMap, profile: VehicleProfile, sim: &Sim, what: &str) {
    let replay = Sim::replay(
        map,
        &Registry::generic(),
        profile,
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(
        replay.state_hash(),
        sim.state_hash(),
        "{what} replays bit for bit"
    );
}

const LEVELS: [AssistLevel; 3] = [AssistLevel::Off, AssistLevel::Some, AssistLevel::Lots];

/// P1-FL06 AC1 (R128): the same over-driven hairpin at each level. Flat out, a lift and a stab with full lock toward the
/// line at the bend: Off spins off the road, Some and Lots get round it on the road (the brake assist and the slide
/// catch), Lots with the least slip.
#[test]
fn an_over_driven_corner_spins_off_and_stays_on_the_road_with_lots() {
    let fx = fixture("over-driven.json");
    let map = map_of(&fx);
    let route = Route::new(&map);
    let c = &fx["corner"];
    let e = &c["expect"];
    let f = |v: &Value| v.as_f64().unwrap() as f32;
    let half = f(&fx["roadHalfWidthM"]);
    let pts: Vec<(f32, f32)> = map
        .map
        .route
        .points
        .iter()
        .map(|q| (q.x as f32 / 1000.0, q.z as f32 / 1000.0))
        .collect();
    for id in c["vehicles"].as_array().unwrap() {
        let id = id.as_str().unwrap();
        let prof = roster_profile(id);
        for level in LEVELS {
            let mut sim = Sim::new(&map, &Registry::generic(), 3, prof.clone());
            let car = sim.spawn_grid(1)[0];
            sim.set_assist(car, level);
            sim.start_race(3);
            let (mut slip_max, mut off_max, mut lift, mut in_bend) = (0.0f32, 0.0f32, 0u64, false);
            for _ in 0..(c["seconds"].as_u64().unwrap() * S) {
                let p = pose(&sim, car);
                let lock = prof.steer_lock(p.forward_speed);
                let line = route
                    .probe(None, p, lock, prof.wheelbase(), [0.8, 6.0, 6.0])
                    .steer;
                if line.abs() > f(&c["bendAbove"]) && !in_bend {
                    in_bend = true;
                    lift = (f(&c["liftS"]) * TICK_HZ as f32) as u64;
                } else if line.abs() < f(&c["bendBelow"]) {
                    in_bend = false;
                }
                let throttle = if lift > 0 {
                    lift -= 1;
                    0.0
                } else {
                    1.0
                };
                sim.set_input(
                    car,
                    DriveInput {
                        throttle: quantise_axis(throttle),
                        steer: quantise_axis(if in_bend { line.signum() } else { line }),
                        ..Default::default()
                    },
                );
                sim.step();
                slip_max = slip_max.max(slip_deg(&sim, car, 3.0).unwrap_or(0.0));
                let at = sim.car_state(car).unwrap().position;
                off_max = off_max.max(
                    pts.iter()
                        .map(|(x, z)| (x - at[0]).hypot(z - at[2]))
                        .fold(f32::MAX, f32::min),
                );
            }
            let progress = sim.race().progress_m(car.0);
            eprintln!(
                "{id} {level:?}: slip max {slip_max:.0} deg, off the line by up to {off_max:.1} m, progress {progress:.0} m"
            );
            let what = format!("{id} {level:?}");
            match level {
                AssistLevel::Off => assert!(
                    slip_max >= f(&e["offMinSlipDeg"]) && off_max >= f(&e["offMinOffRoadM"]),
                    "{what}: the raw car spins off ({slip_max:.0} deg, {off_max:.1} m)"
                ),
                AssistLevel::Some => assert!(
                    slip_max <= f(&e["someMaxSlipDeg"]) && off_max < half,
                    "{what}: on the road ({slip_max:.0} deg, {off_max:.1} m)"
                ),
                AssistLevel::Lots => assert!(
                    slip_max <= f(&e["lotsMaxSlipDeg"])
                        && off_max < half
                        && progress >= f(&e["lotsMinProgressM"]),
                    "{what}: caught, on the road and round the bend ({slip_max:.0} deg, {off_max:.1} m, {progress:.0} m)"
                ),
            }
            replays(&map, prof.clone(), &sim, &what);
        }
    }
}

/// P1-FL06 AC1 (R128): the Ute's power slide, a throttle punch at full lock from a crawl, held. Off holds the slide
/// (the arcade car's RWD tail, R138), Some damps it, Lots catches it before it starts.
#[test]
fn a_power_slide_is_held_off_damped_with_some_and_caught_with_lots() {
    let fx = fixture("over-driven.json");
    let map = map_of(&fx);
    let ps = &fx["powerSlide"];
    let e = &ps["expect"];
    let f = |v: &Value| v.as_f64().unwrap() as f32;
    let prof = roster_profile(ps["vehicle"].as_str().unwrap());
    let mut off_slip = 0.0f32;
    for level in LEVELS {
        let mut sim = Sim::new(&map, &Registry::generic(), 3, prof.clone());
        let car = sim.spawn_grid(1)[0];
        sim.set_assist(car, level);
        sim.start_race(3);
        while sim.car_state(car).unwrap().forward_speed < f(&ps["entryMps"]) {
            sim.set_input(
                car,
                DriveInput {
                    throttle: quantise_axis(0.5),
                    ..Default::default()
                },
            );
            sim.step();
            assert!(sim.tick() < 10 * S, "reaches the entry speed");
        }
        // Off the throttle, then the punch.
        for _ in 0..3 {
            sim.set_input(car, DriveInput::default());
            sim.step();
        }
        let (mut slip_max, mut sliding) = (0.0f32, 0u64);
        for _ in 0..((f(&ps["seconds"]) * TICK_HZ as f32) as u64) {
            sim.set_input(
                car,
                DriveInput {
                    throttle: quantise_axis(1.0),
                    steer: quantise_axis(f(&ps["steer"])),
                    ..Default::default()
                },
            );
            sim.step();
            let slip = slip_deg(&sim, car, 2.0).unwrap_or(0.0);
            slip_max = slip_max.max(slip);
            sliding += u64::from(slip > f(&ps["slidingAboveDeg"]));
        }
        let sliding_s = sliding as f32 / TICK_HZ as f32;
        eprintln!("power slide {level:?}: slip max {slip_max:.0} deg, sliding {sliding_s:.2} s");
        match level {
            AssistLevel::Off => {
                off_slip = slip_max;
                assert!(
                    slip_max >= f(&e["offMinSlipDeg"]) && sliding_s >= f(&e["offMinSlidingS"]),
                    "Off holds the slide ({slip_max:.0} deg, {sliding_s:.2} s)"
                );
            }
            AssistLevel::Some => assert!(
                slip_max <= f(&e["someMaxSlipShareOfOff"]) * off_slip,
                "Some damps it ({slip_max:.0} deg against Off's {off_slip:.0})"
            ),
            AssistLevel::Lots => assert!(
                slip_max <= f(&e["lotsMaxSlipDeg"]) && sliding_s <= f(&e["lotsMaxSlidingS"]),
                "Lots catches it ({slip_max:.0} deg, {sliding_s:.2} s)"
            ),
        }
        replays(&map, prof.clone(), &sim, &format!("power slide {level:?}"));
    }
}
