//! `jj lab <scene> [--out <dir>]` (P1-FL09, R131): builds a Feel Lab scene from `assets/lab/scenes.json` through the
//! generator and writes its map (`map.json`) and each run's fixture (`<run>.json`, for `jj sim`) to
//! `target/jj-runs/lab-<scene>/` (or `--out`). `jj lab --list` names the scenes. The committed copies are
//! `maps/lab/<scene>.json` and `scenarios/lab/<run>.json`.
//!
//! Exit 0 built, 1 the scene doesn't build or validate, 2 usage or I/O.

use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "usage: jj lab <scene> [--out <dir>]\n       jj lab --list";

pub fn command(args: &[String]) -> ExitCode {
    let mut it = args.iter();
    let (mut scene, mut out) = (None, None);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--list" => {
                for (id, s) in &jj_procgen::lab::shipped().scenes {
                    println!("{id}: {}", s.what);
                }
                return ExitCode::SUCCESS;
            }
            "--out" => match it.next() {
                Some(d) => out = Some(PathBuf::from(d)),
                None => {
                    eprintln!("{USAGE}");
                    return ExitCode::from(2);
                }
            },
            s if scene.is_none() && !s.starts_with('-') => scene = Some(s.to_owned()),
            _ => {
                eprintln!("{USAGE}");
                return ExitCode::from(2);
            }
        }
    }
    let Some(scene) = scene else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let out = out.unwrap_or_else(|| PathBuf::from(format!("target/jj-runs/lab-{scene}")));
    let built = match jj_procgen::lab::build(&scene, "map.json") {
        Ok(b) => b,
        Err(bad) => {
            for b in bad {
                eprintln!("{b}");
            }
            return ExitCode::from(1);
        }
    };
    let mut files = vec![(
        out.join("map.json"),
        serde_json::to_vec_pretty(&built.map).unwrap_or_default(),
    )];
    for (run, fx) in &built.fixtures {
        files.push((
            out.join(format!("{run}.json")),
            serde_json::to_vec_pretty(fx).unwrap_or_default(),
        ));
    }
    if let Err(e) = std::fs::create_dir_all(&out)
        .and_then(|()| files.iter().try_for_each(|(p, b)| std::fs::write(p, b)))
    {
        eprintln!("{}: {e}", out.display());
        return ExitCode::from(2);
    }
    for (p, _) in &files {
        println!("{}", p.display());
    }
    ExitCode::SUCCESS
}
