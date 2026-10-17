//! The lap's beat rhythm (R132, R136, P1-FL15c; docs/research/fun-tracks.md R20/R21). Every route point of a finished
//! map is one beat:
//!
//! - **set piece**: `crossingBeatM` either side of a crossing point (over and under the deck), and from `setPieceLeadS` before a set piece's kicker (the commitment) to its landing's end (a loop's: its entry to its exit);
//! - **recovery**: the first `recoveryS` after the landing (the run-out, a stretch to settle);
//! - **technical**: a corner tight enough that the speed it allows (lateral grip over its radius) is under
//!   `technicalBelowMps`: hairpins, medium corners, chicanes;
//! - **flow**: everything else (straights and sweepers at speed).
//!
//! Each stretch is timed at the design speed (capped by the corner speed), runs shorter than `mergeBelowS` join their
//! neighbour, and [`problems`] holds the lap to the bands in `assets/profiles/rhythm.json`. Introspectable (R90): the
//! `jj procgen` report carries the spans and the shares.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use jj_map::Map;
use jj_map::setpiece::GapLeap;
use serde::{Deserialize, Serialize};

const SHIPPED: &str = include_str!("../../../../assets/profiles/rhythm.json");

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Data {
    pub schema: String,
    pub note: String,
    /// The speed a stretch is timed at where no corner holds the car slower, m/s.
    pub design_speed_mps: f64,
    /// Lateral grip the corner speed assumes, m/s² (v = √(grip · radius)).
    pub lateral_grip_mps2: f64,
    /// A point's radius is measured over this much road either side, m.
    pub radius_window_m: f64,
    pub technical_below_mps: f64,
    /// Runs shorter than this join their neighbour, s.
    pub merge_below_s: f64,
    pub recovery_s: f64,
    /// A crossing's set-piece beat reaches this far either side of the crossing point, m (over and under the deck).
    pub crossing_beat_m: f64,
    /// A set piece's beat starts this long (at the design speed) before its kicker: the commitment.
    pub set_piece_lead_s: f64,
    pub min_distinct_beats: usize,
    /// No single unbroken stretch of one beat is more than this share of the lap (FL15c: "a course that repeats one
    /// beat for > 40% of a lap"). The total share per beat is reported, not gated (R20 proposes it; see the note).
    pub max_run_share: f64,
    /// R20's beat length: an unbroken flow stretch longer than this, s, is reported as a long run.
    pub max_flow_run_s: f64,
    pub min_set_piece_spacing_s: f64,
    /// Variety between seeds (R28, `crate::variety`): no two seeds of a set more similar than this.
    pub max_seed_similarity: f64,
    /// R28's proposed bound, reported against until the couch calibrates the metric.
    pub target_seed_similarity: f64,
}

/// The shipped data, parsed once.
pub fn shipped() -> &'static Data {
    static DATA: OnceLock<Data> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(SHIPPED).expect("assets/profiles/rhythm.json parses"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Beat {
    Flow,
    SetPiece,
    Technical,
    Recovery,
}

impl Beat {
    pub const ALL: [Beat; 4] = [Beat::Flow, Beat::SetPiece, Beat::Technical, Beat::Recovery];

    pub fn name(self) -> &'static str {
        match self {
            Beat::Flow => "flow",
            Beat::SetPiece => "set-piece",
            Beat::Technical => "technical",
            Beat::Recovery => "recovery",
        }
    }
}

/// One stretch of a beat: route points `from..=to` (wrapping), its time at the design speed.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub beat: Beat,
    pub from: usize,
    pub to: usize,
    pub seconds: f64,
}

/// A lap's rhythm: its beat per route point, the stretches in route order from the start, and each beat's share of
/// the lap time.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rhythm {
    #[serde(skip)]
    pub beats: Vec<Beat>,
    pub spans: Vec<Span>,
    pub lap_s: f64,
    pub lap_m: f64,
    #[serde(skip)]
    pub biomes: Vec<jj_map::Biome>,
    pub shares: BTreeMap<&'static str, f64>,
    pub set_pieces: usize,
    /// The longest unbroken flow stretch, s (R20: beats 6-20 s).
    pub longest_flow_s: f64,
    /// A set piece followed by a technical stretch inside its recovery time (route point of the piece's end).
    #[serde(skip)]
    pub no_recovery: Vec<usize>,
}

/// The lap's rhythm with the shipped data.
pub fn of(map: &Map) -> Rhythm {
    of_with(map, shipped())
}

pub fn of_with(map: &Map, d: &Data) -> Rhythm {
    let pts: Vec<(f64, f64)> = map
        .route
        .points
        .iter()
        .map(|p| (f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0))
        .collect();
    let n = pts.len();
    if n < 3 {
        return Rhythm {
            beats: Vec::new(),
            spans: Vec::new(),
            lap_s: 0.0,
            lap_m: 0.0,
            biomes: Vec::new(),
            shares: BTreeMap::new(),
            set_pieces: 0,
            longest_flow_s: 0.0,
            no_recovery: Vec::new(),
        };
    }
    let ds: Vec<f64> = (0..n)
        .map(|i| {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            libm::hypot(b.0 - a.0, b.1 - a.1)
        })
        .collect();
    let mean_ds = ds.iter().sum::<f64>() / n as f64;
    let w = (libm::round(d.radius_window_m / mean_ds.max(1e-6)) as usize).max(1);
    let heading = |i: usize| {
        let (a, b) = (pts[i % n], pts[(i + 1) % n]);
        libm::atan2(b.1 - a.1, b.0 - a.0)
    };
    // The speed each point allows: the design speed, or the corner's √(grip · radius) where that is lower. The radius
    // is the reciprocal of the mean |curvature| over the window (absolute first, so an S-bend's halves don't cancel).
    let kappa: Vec<f64> = (0..n)
        .map(|i| {
            let mut turn = (heading(i) - heading(i + n - 1)).abs();
            if turn > core::f64::consts::PI {
                turn = 2.0 * core::f64::consts::PI - turn;
            }
            turn / ((ds[i] + ds[(i + n - 1) % n]) / 2.0).max(1e-6)
        })
        .collect();
    let v: Vec<f64> = (0..n)
        .map(|i| {
            let mean =
                (0..=2 * w).map(|k| kappa[(i + n + k - w) % n]).sum::<f64>() / (2 * w + 1) as f64;
            let radius = if mean < 1e-9 {
                f64::INFINITY
            } else {
                1.0 / mean
            };
            d.design_speed_mps
                .min(libm::sqrt(d.lateral_grip_mps2 * radius))
        })
        .collect();
    let dt: Vec<f64> = (0..n).map(|i| ds[i] / v[i].max(1.0)).collect();
    let mut beats: Vec<Beat> = v
        .iter()
        .map(|&s| {
            if s < d.technical_below_mps {
                Beat::Technical
            } else {
                Beat::Flow
            }
        })
        .collect();
    // Short runs join the run before them (set pieces are kept whole: they're spans, not measurements).
    let mut i = 0;
    while i < n {
        let b = beats[i];
        let mut j = i;
        let mut t = 0.0;
        while j < n && beats[j] == b {
            t += dt[j];
            j += 1;
        }
        if t < d.merge_below_s && i > 0 {
            let prev = beats[i - 1];
            for k in beats.iter_mut().take(j).skip(i) {
                *k = prev;
            }
        }
        i = j;
    }
    // A crossing (a figure eight's bridge over the other road) is a built showpiece too: `crossingBeatM` either side of
    // the crossing point, over the deck's crest and under it, is a set-piece beat, though not one of the lap's set pieces.
    let reach = (libm::round(d.crossing_beat_m / mean_ds) as usize).min(n / 4);
    for f in &map.features {
        let Some(design) = jj_map::bridge::BridgeDesign::of(f) else {
            continue;
        };
        // Either side of where the two roads actually cross (not the spans' middles: a crossing may sit anywhere).
        let (Some(upper), Some(lower)) = (
            jj_map::bridge::indices(map, design.upper),
            jj_map::bridge::indices(map, design.lower),
        ) else {
            continue;
        };
        if let Some((a, b)) = jj_map::bridge::crossing_point(map, &upper, &lower) {
            for at in [a, b] {
                for k in 0..=2 * reach {
                    beats[(at + n + k - reach) % n] = Beat::SetPiece;
                }
            }
        }
    }
    // Set pieces, then the recovery after each. The beat is the commitment (a lead-in before the kicker, or a loop's
    // entry) to the landing's end (a loop's exit); the approach before it is the road it's on, and the run-out after it
    // is the recovery. Loops (br-xlvx.6.4) are set pieces too (R132).
    let lead = (libm::round(d.set_piece_lead_s * d.design_speed_mps / mean_ds) as usize).min(n - 1);
    let gap_leaps = map.features.iter().filter_map(|f| {
        let g = GapLeap::of(f)?;
        let base = jj_map::jump::feature_base(map, f);
        Some((
            base,
            (base + (libm::round(g.end_u() / mean_ds) as usize).min(n - 1)) % n,
        ))
    });
    let loops = map
        .features
        .iter()
        .filter_map(jj_map::looping::LoopDesign::of)
        .map(|l| (l.entry % n, l.exit % n));
    let pieces: Vec<(usize, usize)> = gap_leaps.chain(loops).collect();
    let set_pieces = pieces.len();
    let mut no_recovery = Vec::new();
    for (start, to) in pieces {
        let from = (start + n - lead) % n;
        let mut k = from;
        loop {
            beats[k] = Beat::SetPiece;
            if k == to {
                break;
            }
            k = (k + 1) % n;
        }
        let (mut k, mut t) = ((to + 1) % n, 0.0);
        while t < d.recovery_s && beats[k] != Beat::SetPiece {
            if beats[k] == Beat::Technical {
                no_recovery.push(to);
                break;
            }
            beats[k] = Beat::Recovery;
            t += dt[k];
            k = (k + 1) % n;
        }
    }
    let lap_s: f64 = dt.iter().sum();
    let mut spans: Vec<Span> = Vec::new();
    for i in 0..n {
        match spans.last_mut() {
            Some(s) if s.beat == beats[i] => {
                s.to = i;
                s.seconds += dt[i];
            }
            _ => spans.push(Span {
                beat: beats[i],
                from: i,
                to: i,
                seconds: dt[i],
            }),
        }
    }
    let mut flow_runs: Vec<f64> = spans
        .iter()
        .filter(|s| s.beat == Beat::Flow)
        .map(|s| s.seconds)
        .collect();
    if spans.len() > 1 && spans[0].beat == Beat::Flow && spans[spans.len() - 1].beat == Beat::Flow {
        let last = flow_runs.pop().unwrap_or(0.0);
        flow_runs[0] += last;
    }
    let longest_flow_s = flow_runs.into_iter().fold(0.0, f64::max);
    let mut shares: BTreeMap<&'static str, f64> = BTreeMap::new();
    for (b, t) in beats.iter().zip(&dt) {
        *shares.entry(b.name()).or_default() += t / lap_s;
    }
    Rhythm {
        beats,
        spans,
        lap_s,
        lap_m: ds.iter().sum(),
        biomes: map.header.biomes.clone(),
        shares,
        set_pieces,
        longest_flow_s,
        no_recovery,
    }
}

/// Where the lap breaks the rhythm's gates (FL15c acceptance: beat count, no one beat over `maxRunShare` of the lap,
/// the set-piece minimum); empty when it keeps them. A lap that breaks one is redrawn ([`crate::validate::prepare`]).
pub fn problems(r: &Rhythm, d: &Data) -> Vec<String> {
    let mut out = Vec::new();
    let distinct = r.shares.values().filter(|&&s| s > 0.0).count();
    if distinct < d.min_distinct_beats {
        out.push(format!(
            "rhythm: {distinct} distinct beats (want >= {})",
            d.min_distinct_beats
        ));
    }
    // Unbroken stretches, joining the last span to the first across the start (the lap is a loop).
    let mut runs: Vec<(Beat, f64)> = r.spans.iter().map(|s| (s.beat, s.seconds)).collect();
    if runs.len() > 1 && runs[0].0 == runs[runs.len() - 1].0 {
        let (_, t) = runs.pop().unwrap();
        runs[0].1 += t;
    }
    if let Some((b, t)) = runs
        .iter()
        .copied()
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .filter(|(_, t)| *t > d.max_run_share * r.lap_s)
    {
        out.push(format!(
            "rhythm: one {} stretch is {:.0}% of the lap ({t:.0} s; want <= {:.0}%)",
            b.name(),
            t / r.lap_s * 100.0,
            d.max_run_share * 100.0
        ));
    }
    let min = crate::setpieces::min_for(crate::setpieces::shipped(), r.lap_m, &r.biomes) as usize;
    if r.set_pieces < min {
        out.push(format!(
            "rhythm: {} set pieces (want >= {min})",
            r.set_pieces
        ));
    }
    out
}

/// R20's rhythm targets the report tracks but doesn't gate (proposed values, judged on the couch): set pieces at least
/// `minSetPieceSpacingS` apart, a recovery of `recoveryS` after each, flow stretches no longer than `maxFlowRunS`.
pub fn notes(r: &Rhythm, d: &Data) -> Vec<String> {
    let mut out = Vec::new();
    if r.longest_flow_s > d.max_flow_run_s {
        out.push(format!(
            "rhythm: a {:.0} s flow stretch (target <= {})",
            r.longest_flow_s, d.max_flow_run_s
        ));
    }
    for at in &r.no_recovery {
        out.push(format!(
            "rhythm: a technical stretch within {} s of the set piece ending at route point {at}",
            d.recovery_s
        ));
    }
    // Set pieces apart: the time from one piece's end to the next one's start, round the lap.
    let pieces: Vec<&Span> = r
        .spans
        .iter()
        .filter(|s| s.beat == Beat::SetPiece)
        .collect();
    if pieces.len() > 1 {
        let starts: Vec<usize> = r
            .spans
            .iter()
            .enumerate()
            .filter(|(_, s)| s.beat == Beat::SetPiece)
            .map(|(k, _)| k)
            .collect();
        for (a, &k) in starts.iter().enumerate() {
            let next = starts[(a + 1) % starts.len()];
            let mut t = 0.0;
            let mut j = (k + 1) % r.spans.len();
            while j != next {
                t += r.spans[j].seconds;
                j = (j + 1) % r.spans.len();
            }
            if t < d.min_set_piece_spacing_s {
                out.push(format!(
                    "rhythm: set pieces {:.0} s apart (want >= {})",
                    t, d.min_set_piece_spacing_s
                ));
            }
        }
    }
    out
}
