//! Variety between seeds (P1-FL15c, R136; docs/research/fun-tracks.md R28): a fingerprint of what the driver feels on
//! a lap, and a similarity between two of them. "No two seeds feel the same": across a seed set no pair is more similar
//! than `maxSeedSimilarity` (`assets/profiles/rhythm.json`).
//!
//! The fingerprint's parts, each compared as a distance in 0..=1 (the similarity is one minus their mean):
//! - **route shape**: the histogram of |curvature| along the lap (straights, sweepers, tight corners);
//! - **corner sequence**: the lap's corners in order, each as its hand and tightness (`L2`, `R0`...), compared as an
//!   order (what the driver learns: "a tight left, then two sweepers right");
//! - **relief**: the histogram of road grade (flat, rolling, climbing, steep) and the road's height range;
//! - **biome order**: the biomes in lap order;
//! - **set-piece mix**: how many of each kind;
//! - **rhythm**: each beat's share of the lap (`crate::rhythm`);
//! - **length**: the lap's length.

use jj_map::Map;
use jj_map::setpiece::{GapLeap, PieceKind};

use crate::rhythm::{self, Beat};

/// |curvature| bin edges, 1/m: straight, sweeper (r > 60 m), medium (r 25-60 m), tight (r < 25 m).
const CURVATURE_EDGES: [f64; 3] = [1.0 / 400.0, 1.0 / 60.0, 1.0 / 25.0];
/// |grade| bin edges: flat, rolling, climbing, steep.
const GRADE_EDGES: [f64; 3] = [0.02, 0.06, 0.12];
/// A relief difference this large (m) counts as fully different.
const RELIEF_SCALE_M: f64 = 40.0;

/// What a lap feels like, as numbers.
#[derive(Clone, Debug, PartialEq)]
pub struct Fingerprint {
    pub curvature: [f64; 4],
    pub corners: Vec<String>,
    pub grade: [f64; 4],
    pub relief_m: f64,
    pub biomes: Vec<String>,
    pub pieces: [f64; 4],
    pub beats: [f64; 4],
    pub length_m: f64,
}

pub fn fingerprint(map: &Map) -> Fingerprint {
    let pts: Vec<(f64, f64, f64)> = map
        .route
        .points
        .iter()
        .map(|p| {
            (
                f64::from(p.x) / 1000.0,
                f64::from(p.y) / 1000.0,
                f64::from(p.z) / 1000.0,
            )
        })
        .collect();
    let n = pts.len();
    let mut curvature = [0.0; 4];
    let mut grade = [0.0; 4];
    let mut length_m = 0.0;
    let bin = |v: f64, edges: &[f64; 3]| edges.iter().filter(|&&e| v >= e).count();
    // Corners: runs of one hand turning tighter than a straight; each named by hand and its tightest bin.
    let mut corners: Vec<String> = Vec::new();
    let mut run: Option<(bool, usize, f64)> = None;
    for i in 0..n {
        let (a, b, c) = (pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]);
        let ds = libm::hypot(c.0 - b.0, c.2 - b.2);
        let h0 = libm::atan2(b.2 - a.2, b.0 - a.0);
        let h1 = libm::atan2(c.2 - b.2, c.0 - b.0);
        let mut turn = (h1 - h0).abs();
        if turn > core::f64::consts::PI {
            turn = 2.0 * core::f64::consts::PI - turn;
        }
        let k = turn / ds.max(1e-6);
        curvature[bin(k, &CURVATURE_EDGES)] += ds;
        let mut signed = h1 - h0;
        if signed > core::f64::consts::PI {
            signed -= 2.0 * core::f64::consts::PI;
        } else if signed < -core::f64::consts::PI {
            signed += 2.0 * core::f64::consts::PI;
        }
        let left = signed > 0.0;
        if k >= CURVATURE_EDGES[0] {
            run = match run {
                Some((l, b, t)) if l == left => {
                    Some((l, b.max(bin(k, &CURVATURE_EDGES)), t + turn))
                }
                other => {
                    if let Some((l, b, t)) = other
                        && t > 0.2
                    {
                        corners.push(format!("{}{b}", if l { 'L' } else { 'R' }));
                    }
                    Some((left, bin(k, &CURVATURE_EDGES), turn))
                }
            };
        } else if let Some((l, b, t)) = run.take()
            && t > 0.2
        {
            corners.push(format!("{}{b}", if l { 'L' } else { 'R' }));
        }
        grade[bin((c.1 - b.1).abs() / ds.max(1e-6), &GRADE_EDGES)] += ds;
        length_m += ds;
    }
    for v in curvature.iter_mut().chain(grade.iter_mut()) {
        *v /= length_m.max(1e-6);
    }
    let (lo, hi) = pts
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
            (lo.min(p.1), hi.max(p.1))
        });
    // The mix of the landscape's own pieces; any other kind (a crossing leap, br-xlvx.5) counts as a fourth.
    let mut pieces = [0.0; 4];
    for f in &map.features {
        if let Some(g) = GapLeap::of(f) {
            #[allow(unreachable_patterns)]
            let k = match g.kind {
                PieceKind::CanyonLeap => 0,
                PieceKind::MesaDrop => 1,
                PieceKind::CreekWashout => 2,
                _ => 3,
            };
            pieces[k] += 1.0;
        }
    }
    let r = rhythm::of(map);
    let beats = Beat::ALL.map(|b| r.shares.get(b.name()).copied().unwrap_or(0.0));
    let mut biomes: Vec<String> = map.route.segments.iter().map(|s| s.name.clone()).collect();
    // The lap ends in its first biome; that repeat says nothing about the order.
    if biomes.len() > 1 && biomes.first() == biomes.last() {
        biomes.pop();
    }
    if let Some((l, b, t)) = run
        && t > 0.2
    {
        corners.push(format!("{}{b}", if l { 'L' } else { 'R' }));
    }
    Fingerprint {
        curvature,
        corners,
        grade,
        relief_m: if hi > lo { hi - lo } else { 0.0 },
        biomes,
        pieces,
        beats,
        length_m,
    }
}

/// Total-variation distance between two histograms (each summing to about 1): 0 same, 1 disjoint.
fn tv(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| (x - y).abs()).sum::<f64>() / 2.0
}

/// 1 − (longest common subsequence / longer length): 0 for the same order.
fn order_distance(a: &[String], b: &[String]) -> f64 {
    let (n, m) = (a.len(), b.len());
    if n.max(m) == 0 {
        return 0.0;
    }
    let mut t = vec![vec![0usize; m + 1]; n + 1];
    for i in 0..n {
        for j in 0..m {
            t[i + 1][j + 1] = if a[i] == b[j] {
                t[i][j] + 1
            } else {
                t[i][j + 1].max(t[i + 1][j])
            };
        }
    }
    1.0 - t[n][m] as f64 / n.max(m) as f64
}

/// The parts' distances (route shape, corner sequence, relief, biome order, set-piece mix, rhythm, length), each 0..=1.
pub fn distances(a: &Fingerprint, b: &Fingerprint) -> [f64; 7] {
    let mix = |p: &[f64; 4]| {
        let t: f64 = p.iter().sum();
        p.map(|v| if t > 0.0 { v / t } else { 0.0 })
    };
    let count = (a.pieces.iter().sum::<f64>() - b.pieces.iter().sum::<f64>()).abs()
        / a.pieces
            .iter()
            .sum::<f64>()
            .max(b.pieces.iter().sum::<f64>())
            .max(1.0);
    [
        tv(&a.curvature, &b.curvature),
        order_distance(&a.corners, &b.corners),
        (tv(&a.grade, &b.grade) + ((a.relief_m - b.relief_m).abs() / RELIEF_SCALE_M).min(1.0))
            / 2.0,
        order_distance(&a.biomes, &b.biomes),
        (tv(&mix(&a.pieces), &mix(&b.pieces)) + count) / 2.0,
        tv(&a.beats, &b.beats),
        (a.length_m - b.length_m).abs() / a.length_m.max(b.length_m).max(1.0),
    ]
}

/// 1 for laps that feel the same, toward 0 the more they differ.
pub fn similarity(a: &Fingerprint, b: &Fingerprint) -> f64 {
    let d = distances(a, b);
    1.0 - d.iter().sum::<f64>() / d.len() as f64
}
