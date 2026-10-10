//! `jj vehicle sync` and profile validation (P1-S03a): a vehicle profile's geometry (`assets/profiles/<car>.json`) is
//! derived from the baked sidecar it names (P1-V02), never typed in. Sync rewrites the geometry and the source hashes;
//! validate re-derives them and fails when the bake has moved on.
//! `jj vehicle tune <patch.json>` applies the host's tuning export (`jj.tuning-patch.v1`) to a profile's `tuning`.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use jj_contracts::vehicle::{PhysicsGeometry, parse_sidecar, physics_geometry};
use jj_fixture::profile_from;
use jj_sim::profile::{
    PROFILE, PartGeometry, ProfileFile, Source, Tuning, VehicleGeometry, VehicleProfile,
};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const TUNING_PATCH: &str = "jj.tuning-patch.v1";
const USAGE: &str = "usage: jj vehicle sync <assets/profiles/<car>.json>…\n       jj vehicle tune <patch.json> [--check]";

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
        parts: g
            .parts
            .iter()
            .map(|p| PartGeometry {
                name: p.name.clone(),
                pivot: f(p.pivot),
                hinge: p.hinge.map(|(a, lo, hi)| (f(a), lo as f32, hi as f32)),
                mass_fraction: p.mass_fraction as f32,
                points: p.points.iter().map(|&q| f(q)).collect(),
            })
            .collect(),
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
    if args.first().map(String::as_str) == Some("tune") {
        return tune_command(&args[1..]);
    }
    let usage = USAGE;
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

fn read_text(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The byte span of the top-level `"key"`'s object value, and the byte where the key starts. Only ASCII
/// delimiters are matched, so every span lands on a character boundary.
fn top_level_object(text: &str, key: &str) -> Option<(usize, usize, usize)> {
    let b = text.as_bytes();
    let string_end = |mut j: usize| {
        j += 1;
        while j < b.len() && b[j] != b'"' {
            j += if b[j] == b'\\' { 2 } else { 1 };
        }
        (j + 1).min(b.len())
    };
    let (mut depth, mut i) = (0usize, 0usize);
    while i < b.len() {
        match b[i] {
            b'"' => {
                let end = string_end(i);
                if depth == 1 && text.get(i + 1..end - 1) == Some(key) {
                    let colon = text[end..].find(|c: char| !c.is_whitespace())? + end;
                    if b[colon] != b':' {
                        i = end;
                        continue;
                    }
                    let start = text[colon + 1..].find(|c: char| !c.is_whitespace())? + colon + 1;
                    if b[start] != b'{' {
                        return None;
                    }
                    let (mut inner, mut j) = (0usize, start);
                    while j < b.len() {
                        match b[j] {
                            b'"' => {
                                j = string_end(j);
                                continue;
                            }
                            b'{' | b'[' => inner += 1,
                            b'}' | b']' => inner -= 1,
                            _ => {}
                        }
                        j += 1;
                        if inner == 0 {
                            return Some((i, start, j));
                        }
                    }
                    return None;
                }
                i = end;
            }
            b'{' | b'[' => {
                depth += 1;
                i += 1;
            }
            b'}' | b']' => {
                depth = depth.saturating_sub(1);
                i += 1;
            }
            _ => i += 1,
        }
    }
    None
}

/// `text` with its top-level `tuning` object replaced by `tuning_json`, indented to the key's depth. Every other byte
/// (keys, their order, formatting) stays as it was.
fn splice_tuning(text: &str, tuning_json: &str) -> Result<String, String> {
    let (key_at, start, end) =
        top_level_object(text, "tuning").ok_or("the profile has no top-level tuning object")?;
    let line = text[..key_at].rfind('\n').map_or(0, |i| i + 1);
    let indent: String = text[line..key_at]
        .chars()
        .take_while(|c| *c == ' ')
        .collect();
    let indented = tuning_json.replace('\n', &format!("\n{indent}"));
    Ok(format!("{}{indented}{}", &text[..start], &text[end..]))
}

/// `(field, old, new)` for every tuning field whose value differs.
fn changed_fields(old: &Tuning, new: &Tuning) -> Result<Vec<String>, String> {
    let to_map = |t: &Tuning| match serde_json::to_value(t) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err("tuning is not an object".to_owned()),
        Err(e) => Err(e.to_string()),
    };
    let (old, new) = (to_map(old)?, to_map(new)?);
    Ok(new
        .iter()
        .filter(|(k, v)| old.get(*k) != Some(v))
        .map(|(k, v)| format!("{k}: {} -> {v}", old.get(k).unwrap_or(&Value::Null)))
        .collect())
}

/// Applies a tuning patch to its profile. Returns one line per changed field; writes the profile unless `check`.
pub fn tune(patch_path: &Path, check: bool) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct Patch {
        profile: String,
        set: Vec<(String, String)>,
    }
    let raw: Value = serde_json::from_str(&read_text(patch_path)?)
        .map_err(|e| format!("{}: {e}", patch_path.display()))?;
    let contract = raw
        .get("contract")
        .and_then(Value::as_str)
        .unwrap_or("<none>");
    if contract != TUNING_PATCH {
        return Err(format!(
            "{}: contract {contract:?}, expected {TUNING_PATCH:?}",
            patch_path.display()
        ));
    }
    let patch: Patch =
        serde_json::from_value(raw).map_err(|e| format!("{}: {e}", patch_path.display()))?;

    let profile_path = Path::new(&patch.profile);
    let original = read_text(profile_path)?;
    let before = VehicleProfile::from_json(&original)
        .map_err(|e| format!("{}: {e}", profile_path.display()))?;
    let after = profile_from(before.clone(), &patch.set)?;
    let tuning = serde_json::to_string_pretty(&after.tuning).map_err(|e| e.to_string())?;
    let text = splice_tuning(&original, &tuning)?;
    VehicleProfile::from_json(&text).map_err(|e| {
        format!(
            "{}: not written, the result is invalid: {e}",
            profile_path.display()
        )
    })?;

    let changes = changed_fields(&before.tuning, &after.tuning)?;
    if !check {
        std::fs::write(profile_path, text)
            .map_err(|e| format!("{}: {e}", profile_path.display()))?;
    }
    Ok(changes)
}

/// `jj vehicle tune <patch.json> [--check]`: applies an owner tuning export to its profile.
fn tune_command(args: &[String]) -> ExitCode {
    let check = args.iter().any(|a| a == "--check");
    let files: Vec<&String> = args.iter().filter(|a| a.as_str() != "--check").collect();
    let [patch] = files.as_slice() else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    match tune(Path::new(patch), check) {
        Ok(changes) if changes.is_empty() => {
            println!("no changes");
            ExitCode::SUCCESS
        }
        Ok(changes) => {
            for line in changes {
                println!("{line}");
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("jj vehicle tune: {e}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const CRUZ: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../assets/profiles/cruz-missile.json"
    );

    /// A fresh temp copy of the Cruz Missile's profile, and a patch file naming it.
    fn fixture(name: &str, contract: &str, set: Value) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("jj-tune-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let profile = dir.join("cruz-missile.json");
        std::fs::copy(CRUZ, &profile).unwrap();
        let patch = dir.join("patch.json");
        let body =
            json!({ "contract": contract, "profile": profile.to_str().unwrap(), "set": set });
        std::fs::write(&patch, body.to_string()).unwrap();
        (profile, patch)
    }

    #[test]
    fn tune_writes_changed_field_and_keeps_the_rest() {
        let (profile, patch) = fixture(
            "writes",
            TUNING_PATCH,
            json!([["max_engine_force", "9000"]]),
        );
        let original = std::fs::read_to_string(CRUZ).unwrap();
        let changes = tune(&patch, false).unwrap();
        assert_eq!(
            changes.len(),
            1,
            "only max_engine_force changed: {changes:?}"
        );
        assert!(changes[0].starts_with("max_engine_force: "), "{changes:?}");

        let written = std::fs::read_to_string(&profile).unwrap();
        let after = VehicleProfile::from_json(&written).expect("written profile parses");
        let before = VehicleProfile::from_json(&original).unwrap();
        assert_eq!(after.tuning.max_engine_force, 9000.0);
        assert_eq!(after.tuning.mass, before.tuning.mass, "untouched field");
        assert_eq!(after.geometry, before.geometry);
        // Everything above `tuning` is byte-identical, so key order and formatting stay as they were.
        assert_eq!(
            original.split("\"tuning\"").next(),
            written.split("\"tuning\"").next()
        );
    }

    #[test]
    fn tune_check_reports_without_writing() {
        let (profile, patch) =
            fixture("check", TUNING_PATCH, json!([["max_engine_force", "9000"]]));
        let changes = tune(&patch, true).unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(
            std::fs::read_to_string(&profile).unwrap(),
            std::fs::read_to_string(CRUZ).unwrap()
        );
    }

    #[test]
    fn tune_unknown_field_errors_and_leaves_file_unchanged() {
        let (profile, patch) = fixture(
            "unknown",
            TUNING_PATCH,
            json!([["max_engine_forse", "9000"]]),
        );
        let err = tune(&patch, false).unwrap_err();
        assert!(err.contains("no tuning field"), "{err}");
        assert_eq!(
            std::fs::read_to_string(&profile).unwrap(),
            std::fs::read_to_string(CRUZ).unwrap()
        );
    }

    #[test]
    fn tune_wrong_contract_errors_and_leaves_file_unchanged() {
        let (profile, patch) = fixture(
            "contract",
            "jj.tuning-patch.v0",
            json!([["max_engine_force", "9000"]]),
        );
        let err = tune(&patch, false).unwrap_err();
        assert!(err.contains(TUNING_PATCH), "{err}");
        assert_eq!(
            std::fs::read_to_string(&profile).unwrap(),
            std::fs::read_to_string(CRUZ).unwrap()
        );
    }
}
