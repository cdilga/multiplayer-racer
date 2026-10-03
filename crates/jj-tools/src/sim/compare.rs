//! `jj sim --compare` (plan §13.3): lines up traces as **ACCEPTED | CURRENT | TUNED** and shows the keys that differ.
//! It shows them twice: in the summary (state hash, outcome signature), and at the first tick where the runs part ways.
//! ACCEPTED is the trace of the last build the owner accepted (a committed `jj sim --trace` output) or any other run;
//! CURRENT is this build's run; TUNED is the same run with `--set` overrides.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde_json::{Value, json};

use super::{HELP, Options, run};

type Flat = BTreeMap<String, Value>;

struct Trace {
    path: String,
    ticks: BTreeMap<u64, Flat>,
    summary: Flat,
}

fn flatten(prefix: &str, v: &Value, out: &mut Flat) {
    match v {
        Value::Object(m) => {
            for (k, v) in m {
                let key = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                flatten(&key, v, out);
            }
        }
        Value::Array(a) => {
            for (i, v) in a.iter().enumerate() {
                flatten(&format!("{prefix}[{i}]"), v, out);
            }
        }
        _ => {
            out.insert(prefix.to_owned(), v.clone());
        }
    }
}

/// A trace file, or a run folder holding `trace.jsonl`.
fn load(path: &Path) -> Result<Trace, String> {
    let file = if path.is_dir() {
        path.join("trace.jsonl")
    } else {
        path.to_path_buf()
    };
    let text = std::fs::read_to_string(&file).map_err(|e| format!("{}: {e}", file.display()))?;
    let mut t = Trace {
        path: file.display().to_string(),
        ticks: BTreeMap::new(),
        summary: Flat::new(),
    };
    for (n, line) in text
        .lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
    {
        let row: Value =
            serde_json::from_str(line).map_err(|e| format!("{}:{}: {e}", file.display(), n + 1))?;
        if let Some(s) = row.get("summary") {
            flatten("", s, &mut t.summary);
        } else if let Some(tick) = row.get("tick").and_then(Value::as_u64) {
            let mut flat = Flat::new();
            flatten("", &row, &mut flat);
            flat.remove("tick");
            t.ticks.insert(tick, flat);
        }
    }
    Ok(t)
}

fn cell(v: Option<&Value>) -> String {
    v.map_or("—".to_owned(), |v| match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    })
}

/// Rows `[key, accepted, current, tuned]` for every key whose value differs from ACCEPTED in CURRENT or TUNED.
fn differing(a: &Flat, c: &Flat, t: Option<&Flat>, skip: &[&str]) -> Vec<[String; 4]> {
    let keys: BTreeSet<&String> = a
        .keys()
        .chain(c.keys())
        .chain(t.into_iter().flat_map(|t| t.keys()))
        .collect();
    keys.into_iter()
        .filter(|k| !skip.contains(&k.as_str()))
        .filter(|k| a.get(*k) != c.get(*k) || t.is_some_and(|t| a.get(*k) != t.get(*k)))
        .map(|k| {
            [
                k.clone(),
                cell(a.get(k)),
                cell(c.get(k)),
                t.map_or("—".to_owned(), |t| cell(t.get(k))),
            ]
        })
        .collect()
}

fn print_table(rows: &[[String; 4]]) {
    let w: Vec<usize> = (0..4)
        .map(|i| {
            rows.iter()
                .map(|r| r[i].chars().count())
                .max()
                .unwrap_or(0)
                .max(["key", "ACCEPTED", "CURRENT", "TUNED"][i].len())
        })
        .collect();
    println!(
        "  {:<w0$}  {:<w1$}  {:<w2$}  TUNED",
        "key",
        "ACCEPTED",
        "CURRENT",
        w0 = w[0],
        w1 = w[1],
        w2 = w[2]
    );
    for r in rows {
        let mark = |v: &str| if v != r[1] && v != "—" { "*" } else { " " };
        println!(
            "  {:<w0$}  {:<w1$}  {:<w2$}{} {}{}",
            r[0],
            r[1],
            r[2],
            mark(&r[2]),
            r[3],
            mark(&r[3]),
            w0 = w[0],
            w1 = w[1],
            w2 = w[2]
        );
    }
}

fn report(a: &Trace, c: &Trace, t: Option<&Trace>, json_out: bool) {
    // The scenario name and tuning list describe the runs, not what happened in them.
    let summary = differing(&a.summary, &c.summary, t.map(|t| &t.summary), &["scenario"]);
    let mut divergence: Option<(u64, Vec<[String; 4]>)> = None;
    let ticks: BTreeSet<u64> = a
        .ticks
        .keys()
        .chain(c.ticks.keys())
        .chain(t.into_iter().flat_map(|t| t.ticks.keys()))
        .copied()
        .collect();
    let empty = Flat::new();
    for tick in ticks {
        let rows = differing(
            a.ticks.get(&tick).unwrap_or(&empty),
            c.ticks.get(&tick).unwrap_or(&empty),
            t.map(|t| t.ticks.get(&tick).unwrap_or(&empty)),
            &[],
        );
        if !rows.is_empty() {
            divergence = Some((tick, rows));
            break;
        }
    }
    let identical = summary.iter().all(|r| r[0] == "tuned") && divergence.is_none();
    if json_out {
        let rows = |rs: &[[String; 4]]| -> Vec<Value> {
            rs.iter()
                .map(|r| json!({ "key": r[0], "accepted": r[1], "current": r[2], "tuned": r[3] }))
                .collect()
        };
        let out = json!({
            "accepted": a.path,
            "current": c.path,
            "tuned": t.map(|t| t.path.clone()),
            "identical": identical,
            "ticks": { "accepted": a.ticks.len(), "current": c.ticks.len(), "tuned": t.map(|t| t.ticks.len()) },
            "summary": rows(&summary),
            "divergence": divergence.as_ref().map(|(tick, rs)| json!({ "tick": tick, "keys": rows(rs) })),
        });
        println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
        return;
    }
    println!(
        "ACCEPTED {}\nCURRENT  {}\nTUNED    {}",
        a.path,
        c.path,
        t.map_or("—", |t| t.path.as_str())
    );
    if identical {
        println!("identical: every tick and the summary match ACCEPTED");
        return;
    }
    println!(
        "\nsummary: {} differing key(s) (* differs from ACCEPTED)",
        summary.len()
    );
    print_table(&summary);
    if let Some((tick, rows)) = divergence {
        println!(
            "\nfirst divergence at tick {tick}: {} differing key(s)",
            rows.len()
        );
        print_table(&rows);
    }
}

/// `jj sim <fixture> --compare <accepted>` or `jj sim --compare <accepted> <current> [<tuned>]`.
pub fn command(files: &[PathBuf], compare: &[PathBuf], opts: &Options, json_out: bool) -> ExitCode {
    let usage = |msg: &str| {
        eprintln!("jj sim --compare: {msg}\n\n{HELP}");
        ExitCode::from(2)
    };
    let traces: Result<Vec<Trace>, String> = match (files, compare) {
        ([fixture], [accepted]) => (|| {
            // Read ACCEPTED before running: it may live in the run folder CURRENT is about to rewrite.
            let mut traces = vec![load(accepted)?];
            let current = run(
                fixture,
                &Options {
                    trace: true,
                    set: vec![],
                    ..opts.clone()
                },
            )?;
            traces.push(load(Path::new(&current.trace.unwrap_or_default()))?);
            if !opts.set.is_empty() {
                let tuned = run(
                    fixture,
                    &Options {
                        trace: true,
                        out: None,
                        ..opts.clone()
                    },
                )?;
                traces.push(load(Path::new(&tuned.trace.unwrap_or_default()))?);
            }
            Ok(traces)
        })(),
        ([], [_, _] | [_, _, _]) => compare.iter().map(|p| load(p)).collect(),
        _ => return usage("give one fixture and an ACCEPTED trace, or two or three traces"),
    };
    match traces {
        Err(e) => {
            eprintln!("jj sim --compare: {e}");
            ExitCode::from(2)
        }
        Ok(t) => {
            report(&t[0], &t[1], t.get(2), json_out);
            ExitCode::SUCCESS
        }
    }
}
