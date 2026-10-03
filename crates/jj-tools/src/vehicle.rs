//! `jj vehicle sync` and profile validation (P1-S03a): a vehicle profile's geometry (`assets/profiles/<car>.json`) is
//! derived from the baked sidecar it names (P1-V02), never typed in. Sync rewrites the geometry and the source hashes;
//! validate re-derives them and fails when the bake has moved on.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use jj_contracts::vehicle::{PhysicsGeometry, parse_sidecar, physics_geometry};
use jj_sim::profile::{PROFILE, ProfileFile, Source, VehicleGeometry};
use sha2::{Digest, Sha256};

fn sha256(bytes: &[u8]) -> String {
    jj_map::hex(&Sha256::digest(bytes))
}

/// The repo-relative `rel`, from the profile's directory upwards.
fn find(profile: &Path, rel: &str) -> PathBuf {
    profile
        .ancestors()
        .map(|a| a.join(rel))
        .find(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from(rel))
}

fn to_sim(g: &PhysicsGeometry) -> VehicleGeometry {
    let f = |p: [f64; 3]| p.map(|v| v as f32);
    VehicleGeometry {
        hull: g.hull.iter().map(|&p| f(p)).collect(),
        wheels: g.wheels.map(f),
        wheel_radius: g.wheel_radius as f32,
        com: f(g.com),
    }
}

/// What the profile's sidecar derives to now: its source record and geometry.
fn derive(profile: &Path, sidecar_rel: &str) -> Result<(Source, VehicleGeometry), String> {
    let path = find(profile, sidecar_rel);
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let sidecar =
        parse_sidecar(&bytes).map_err(|r| format!("{}: {:?}", path.display(), r.violations))?;
    let lod0_file = &sidecar.lods.first().ok_or("the sidecar has no LODs")?.file;
    let lod0_path = path.parent().unwrap_or(Path::new(".")).join(lod0_file);
    let lod0 = std::fs::read(&lod0_path).map_err(|e| format!("{}: {e}", lod0_path.display()))?;
    let geometry = physics_geometry(&sidecar, &lod0)?;
    Ok((
        Source {
            sidecar: sidecar_rel.to_owned(),
            sidecar_sha256: sha256(&bytes),
            lod0_sha256: sha256(&lod0),
        },
        to_sim(&geometry),
    ))
}

fn read(profile: &Path) -> Result<ProfileFile, String> {
    let text =
        std::fs::read_to_string(profile).map_err(|e| format!("{}: {e}", profile.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", profile.display()))
}

/// Problems with a profile: its contract, its geometry against its sidecar, its tuning's signs.
pub fn check(profile: &Path) -> Result<Vec<String>, String> {
    let f = read(profile)?;
    let mut problems = Vec::new();
    if f.profile != PROFILE {
        problems.push(format!("profile {:?}, expected {PROFILE:?}", f.profile));
    }
    let (source, geometry) = derive(profile, &f.source.sidecar)?;
    if source != f.source {
        problems.push(format!(
            "the sidecar or its LOD0 changed since the last sync: run `jj vehicle sync {}`",
            profile.display()
        ));
    }
    if geometry != f.geometry {
        problems.push(format!(
            "the geometry doesn't match {}: run `jj vehicle sync {}`",
            f.source.sidecar,
            profile.display()
        ));
    }
    let t = &f.tuning;
    for (name, v) in [
        ("mass", t.mass),
        ("inertia_scale", t.inertia_scale),
        ("suspension_rest", t.suspension_rest),
        ("suspension_stiffness", t.suspension_stiffness),
        ("max_engine_force", t.max_engine_force),
        ("max_brake_force", t.max_brake_force),
        ("max_steer_rad", t.max_steer_rad),
        ("steer_falloff_mps", t.steer_falloff_mps),
    ] {
        if !(v > 0.0 && v.is_finite()) {
            problems.push(format!("tuning.{name} = {v}: must be positive"));
        }
    }
    Ok(problems)
}

/// `jj vehicle sync <profile.json>…`: rewrites each profile's geometry and source from its sidecar.
pub fn command(args: &[String]) -> ExitCode {
    let usage = "usage: jj vehicle sync <assets/profiles/<car>.json>…";
    let (Some("sync"), files) = (args.first().map(String::as_str), &args[1.min(args.len())..])
    else {
        eprintln!("{usage}");
        return ExitCode::from(2);
    };
    if files.is_empty() {
        eprintln!("{usage}");
        return ExitCode::from(2);
    }
    for file in files {
        let path = Path::new(file);
        let result = read(path).and_then(|mut f| {
            let (source, geometry) = derive(path, &f.source.sidecar)?;
            let changed = source != f.source || geometry != f.geometry;
            (f.source, f.geometry) = (source, geometry);
            let text = serde_json::to_string_pretty(&f).map_err(|e| e.to_string())?;
            std::fs::write(path, format!("{text}\n")).map_err(|e| format!("{file}: {e}"))?;
            Ok(changed)
        });
        match result {
            Ok(changed) => println!(
                "{file}: {}",
                if changed {
                    "geometry synced from its sidecar"
                } else {
                    "already in sync"
                }
            ),
            Err(e) => {
                eprintln!("jj vehicle sync: {e}");
                return ExitCode::from(2);
            }
        }
    }
    ExitCode::SUCCESS
}
