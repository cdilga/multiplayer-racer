//! `jj sim --replay` through the real binary (P1-F07, P1-F12): a clip kept in pieces replays to its end-state hash and the
//! marked moment, a clip from another build is refused, a flipped checkpoint is found, and a session replays round by round.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

use jj_fixture::clip::{Bundle, ClipTap, FORMAT_CLIP, FORMAT_SESSION, Mark, World};
use jj_map::{Registry, hex, load_json};
use jj_sim::journal::DriveInput;
use jj_sim::{CarId, Sim, VehicleProfile, route_spawn};

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

fn tmp(name: &str) -> PathBuf {
    let p = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    std::fs::create_dir_all(&p).unwrap();
    p
}

/// A world a host would have kept: a car driven for `ticks`, polled every 12, with the live end hash returned.
fn world(seed: u64, ticks: u64, tap: &mut ClipTap) -> (World, String) {
    let text = std::fs::read(repo().join("maps/greybox-loop.json")).unwrap();
    let map = load_json(&text, &Registry::generic()).unwrap();
    let mut sim = Sim::new(&map, &Registry::generic(), seed, VehicleProfile::cruz());
    sim.spawn_car(route_spawn(&map, 12, 0.0, 0.0));
    let first = tap.poll(&sim, &map, true);
    let mut w = World::from_start(first.world, first.start.as_ref().unwrap());
    w.push(&first);
    for i in 0..ticks {
        if i % 40 == 5 {
            sim.set_input(
                CarId(0),
                DriveInput {
                    throttle: 24000,
                    steer: if i % 80 < 40 { 6000 } else { -6000 },
                    ..DriveInput::default()
                },
            );
        }
        sim.step();
        if sim.tick().is_multiple_of(12) {
            w.push(&tap.poll(&sim, &map, sim.tick().is_multiple_of(120)));
        }
    }
    (w, hex(&sim.state_hash()))
}

fn bundle(format: &str, worlds: Vec<World>, mark: Option<Mark>) -> Bundle {
    Bundle {
        format: format.into(),
        build: "abcdef123456".into(),
        mark,
        worlds,
        ..Bundle::default()
    }
}

fn save(name: &str, b: &Bundle) -> String {
    let path = tmp(name).join("x.jjclip");
    std::fs::write(&path, serde_json::to_vec(b).unwrap()).unwrap();
    path.display().to_string()
}

#[test]
fn a_clip_replays_to_its_end_hash_and_the_marked_moment_with_a_trace() {
    let (w, live) = world(7, 480, &mut ClipTap::default());
    let file = save(
        "replay-ok",
        &bundle(
            FORMAT_CLIP,
            vec![w],
            Some(Mark {
                world: 0,
                tick: 240,
                note: "the bump".into(),
            }),
        ),
    );
    let out = tmp("replay-ok-out");
    let run = jj(&[
        "sim",
        "--replay",
        "--json",
        "--trace",
        "--build",
        "abcdef1234567890",
        "--out",
        &out.display().to_string(),
        &file,
    ]);
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let v: Value = serde_json::from_slice(&run.stdout).unwrap();
    let r = &v[0]["report"];
    assert_eq!(r["ok"], true, "{r}");
    assert_eq!(r["worlds"][0]["endHash"], live.as_str());
    assert_eq!(r["worlds"][0]["ticks"], 480);
    assert_eq!(r["mark"]["tick"], 240);
    assert_eq!(r["mark"]["note"], "the bump");
    assert_eq!(r["mark"]["cars"].as_array().unwrap().len(), 1);
    let trace = std::fs::read_to_string(out.join("trace.jsonl")).unwrap();
    assert_eq!(
        trace.lines().count(),
        481 + 1,
        "a row per tick plus a summary"
    );
    assert!(trace.lines().last().unwrap().contains(&live));
    // The same trace feeds `jj sim --compare` (§13.3).
    let cmp = jj(&[
        "sim",
        "--compare",
        &out.join("trace.jsonl").display().to_string(),
        &out.join("trace.jsonl").display().to_string(),
    ]);
    assert!(
        cmp.status.success(),
        "{}",
        String::from_utf8_lossy(&cmp.stderr)
    );
}

#[test]
fn a_clip_from_a_different_build_is_refused_with_a_clear_message() {
    let (w, _) = world(7, 120, &mut ClipTap::default());
    let file = save("replay-build", &bundle(FORMAT_CLIP, vec![w], None));
    let run = jj(&["sim", "--replay", "--build", "999999999999", &file]);
    assert_eq!(run.status.code(), Some(2));
    let err = String::from_utf8_lossy(&run.stderr);
    assert!(
        err.contains("saved by build abcdef123456")
            && err.contains("999999999999")
            && err.contains("--any-build"),
        "{err}"
    );
    let any = jj(&["sim", "--replay", "--any-build", &file]);
    assert!(any.status.success());
}

#[test]
fn a_diverging_checkpoint_fails_the_replay_and_names_the_tick() {
    let (mut w, _) = world(7, 360, &mut ClipTap::default());
    let bad = w.checkpoints.len() - 2;
    w.checkpoints[bad].hash = "ab".repeat(32);
    let tick = w.checkpoints[bad].tick;
    let file = save("replay-bad", &bundle(FORMAT_CLIP, vec![w], None));
    let run = jj(&["sim", "--replay", "--any-build", &file]);
    assert_eq!(run.status.code(), Some(1));
    let out = String::from_utf8_lossy(&run.stdout);
    assert!(
        out.contains(&format!("first divergence at tick {tick}")),
        "{out}"
    );
}

#[test]
fn a_session_replays_round_by_round() {
    let mut tap = ClipTap::default();
    let (w0, h0) = world(3, 240, &mut tap);
    let (w1, h1) = world(4, 360, &mut tap);
    assert_eq!((w0.index, w1.index), (0, 1));
    let file = save(
        "replay-session",
        &bundle(FORMAT_SESSION, vec![w0, w1], None),
    );
    let run = jj(&["sim", "--replay", "--json", "--any-build", &file]);
    assert!(run.status.success());
    let v: Value = serde_json::from_slice(&run.stdout).unwrap();
    let worlds = v[0]["report"]["worlds"].as_array().unwrap();
    assert_eq!(worlds.len(), 2);
    assert_eq!(worlds[0]["endHash"], h0.as_str());
    assert_eq!(worlds[1]["endHash"], h1.as_str());
}
