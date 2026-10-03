//! The static determinism scan (re-expressed from 0.1's `static/js/engine/determinism.js` and
//! `tests/unit/determinism-static-scan.test.js`): sim code may not read a wall clock, draw unseeded randomness or iterate
//! hash-ordered collections. Time enters only as ticks, randomness only through `jj_sim::rng` streams.

use std::path::Path;

/// (pattern, why) pairs forbidden anywhere in `crates/jj-sim/src`.
const FORBIDDEN: [(&str, &str); 9] = [
    ("SystemTime", "wall clock"),
    ("Instant::now", "wall clock"),
    ("std::time", "wall clock"),
    ("thread_rng", "unseeded random"),
    ("rand::random", "unseeded random"),
    ("OsRng", "unseeded random"),
    ("getrandom", "unseeded random"),
    ("HashMap", "hash-ordered iteration (use BTreeMap or Vec)"),
    ("HashSet", "hash-ordered iteration (use BTreeSet or Vec)"),
];

/// Every forbidden pattern in `source` outside comments, as `(line, pattern, why)`.
fn scan(source: &str) -> Vec<(usize, &'static str, &'static str)> {
    let mut hits = Vec::new();
    for (i, line) in source.lines().enumerate() {
        let code = line.split("//").next().unwrap_or("");
        for (pat, why) in FORBIDDEN {
            if code.contains(pat) {
                hits.push((i + 1, pat, why));
            }
        }
    }
    hits
}

fn rust_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn sim_code_reads_no_clock_and_draws_no_unseeded_randomness() {
    let mut files = Vec::new();
    rust_files(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    assert!(!files.is_empty());
    let mut problems = Vec::new();
    for f in &files {
        for (line, pat, why) in scan(&std::fs::read_to_string(f).unwrap()) {
            problems.push(format!("{}:{line}: {pat} ({why})", f.display()));
        }
    }
    assert!(
        problems.is_empty(),
        "determinism scan:\n{}",
        problems.join("\n")
    );
}

#[test]
fn the_scan_catches_injected_cases() {
    let injected = "fn tick() {\n    let now = std::time::SystemTime::now();\n    let r: f32 = rand::thread_rng().gen();\n    let m: HashMap<u32, u32> = HashMap::new();\n    // a SystemTime mention in a comment is fine\n}\n";
    let hits = scan(injected);
    let lines: Vec<usize> = hits.iter().map(|h| h.0).collect();
    assert!(
        lines.contains(&2) && lines.contains(&3) && lines.contains(&4),
        "{hits:?}"
    );
    assert!(!lines.contains(&5), "comments aren't code");
}
