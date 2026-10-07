//! The selector and the transition rules (P1-M03f).
//!
//! A lap runs through the recipe's biomes in order and **ends in the first one again**, so the lap seam (the start
//! corridor and finish) always sits inside one biome: `[A, B]` gives segments `A, B, A` and two transitions. Each
//! boundary is centred on a straight stretch of the route, at least [`MIN_BOUNDARY_GAP_M`] from its neighbours and clear
//! of the start and the seam. Across a [`TRANSITION_M`]-long zone around a boundary the biomes' terrain parameters blend
//! smoothly (smoothstep) and the road surface switches at the middle.

use jj_map::{Biome, Map, Segment, Span};

use super::def;
use crate::assemble::arc_lengths;
use crate::features::LIMITS;
use crate::seed::Rng;

/// Length of the zone over which two biomes blend, m.
pub const TRANSITION_M: f64 = 40.0;
/// Closest two boundary centres may be, m.
pub const MIN_BOUNDARY_GAP_M: f64 = 60.0;
/// A boundary's stretch must bend no more than this (radians, summed) within [`STRAIGHT_M`] of its centre.
pub const MAX_TURN: f64 = 0.12;
const STRAIGHT_M: f64 = 25.0;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SelectError {
    EmptyRecipe,
    /// No straight stretch could hold boundary `n` (0-based) near its target.
    NoStraight(usize),
}

/// Where the biomes change along a route.
#[derive(Clone, Debug, PartialEq)]
pub struct Selection {
    /// The biomes in lap order (the first is repeated at the end when there is more than one).
    pub lap: Vec<Biome>,
    /// Route point index of each boundary's centre (`lap.len() - 1` of them, ascending).
    pub cuts: Vec<usize>,
    /// Arc length (m) of each boundary's centre.
    pub cut_s: Vec<f64>,
    /// Arc length at each route point.
    pub s: Vec<f64>,
    pub total: f64,
}

fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl Selection {
    /// The biomes present, in lap order, each once.
    pub fn biomes(&self) -> Vec<Biome> {
        let mut out: Vec<Biome> = Vec::new();
        for b in &self.lap {
            if !out.contains(b) {
                out.push(*b);
            }
        }
        out
    }

    /// `(biome, from, to)` route-point index spans (inclusive) covering the whole route: the segments.
    pub fn segments(&self) -> Vec<(Biome, usize, usize)> {
        let n = self.s.len();
        let mut out = Vec::new();
        let mut from = 0;
        for (k, &cut) in self.cuts.iter().enumerate() {
            out.push((self.lap[k], from, cut));
            from = cut + 1;
        }
        out.push((self.lap[self.cuts.len()], from, n - 1));
        out
    }

    /// At route point `i`: the biome before and after, and how far through the transition (0 = all `a`, 1 = all `b`).
    pub fn blend_at(&self, i: usize) -> (Biome, Biome, f64) {
        let si = self.s[i];
        for (k, &c) in self.cut_s.iter().enumerate() {
            if (si - c).abs() < TRANSITION_M / 2.0 {
                return (
                    self.lap[k],
                    self.lap[k + 1],
                    smoothstep((si - (c - TRANSITION_M / 2.0)) / TRANSITION_M),
                );
            }
        }
        let k = self.cut_s.iter().filter(|&&c| c < si).count();
        (self.lap[k], self.lap[k], 0.0)
    }

    /// The `route.segments` for this selection.
    pub fn route_segments(&self) -> Vec<Segment> {
        self.segments()
            .into_iter()
            .map(|(b, from, to)| Segment {
                name: segment_name(b),
                span: Span {
                    from: from as u32,
                    to: to as u32,
                },
            })
            .collect()
    }

    /// Weight of `biome` at route point `i` (1 inside its stretch, fading across a transition, 0 elsewhere).
    pub fn weight(&self, biome: Biome, i: usize) -> f64 {
        let (a, b, t) = self.blend_at(i);
        (if a == biome { 1.0 - t } else { 0.0 }) + (if b == biome && a != b { t } else { 0.0 })
    }
}

/// A segment's name: the biome's own, as `jj.map.v1` spells it (`outback-dirt`).
pub fn segment_name(b: Biome) -> String {
    serde_json::to_value(b)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// Total absolute plan turning over points `i0..=i1` (wrapping), radians.
fn turn(pts: &[(f64, f64)], i0: usize, i1: usize) -> f64 {
    let n = pts.len();
    let dir = |i: usize| {
        let (a, b) = (pts[i % n], pts[(i + 1) % n]);
        let l = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
        ((b.0 - a.0) / l, (b.1 - a.1) / l)
    };
    (i0 + 1..=i1)
        .map(|i| {
            let (a, b) = (dir(i - 1), dir(i));
            libm::fabs(libm::atan2(b.0 * a.1 - b.1 * a.0, a.0 * b.0 + a.1 * b.1))
        })
        .sum()
}

/// Assigns the route's stretches to the recipe's biomes. Draws only from `rng` (the structure stream, after the course).
pub fn select(
    pts: &[(f64, f64)],
    recipe: &[Biome],
    rng: &mut Rng,
) -> Result<Selection, SelectError> {
    let mut lap: Vec<Biome> = Vec::new();
    for &b in recipe {
        if lap.last() != Some(&b) {
            lap.push(b);
        }
    }
    let Some(&first) = lap.first() else {
        return Err(SelectError::EmptyRecipe);
    };
    if lap.len() > 1 && lap.last() != Some(&first) {
        lap.push(first);
    }
    let (s, total) = arc_lengths(pts);
    let n = pts.len();
    let boundaries = lap.len() - 1;
    let mut cuts: Vec<usize> = Vec::new();
    let mut cut_s: Vec<f64> = Vec::new();
    let (lo, hi) = (
        LIMITS.earliest_m + TRANSITION_M,
        total - LIMITS.seam_m - TRANSITION_M,
    );
    let spacing = (hi - lo) / (boundaries + 1) as f64;
    let index_at = |v: f64| s.iter().position(|&x| x >= v).unwrap_or(n - 1);
    for j in 0..boundaries {
        let target = lo + spacing * (j + 1) as f64 + rng.range(-0.1, 0.1) * spacing;
        let mut chosen = None;
        let mut d = 0.0;
        while d <= spacing * 0.9 && chosen.is_none() {
            for sign in [1.0, -1.0] {
                let c = target + sign * d;
                let prev = cut_s.last().copied().unwrap_or(f64::NEG_INFINITY);
                if c < lo || c > hi || c - prev < MIN_BOUNDARY_GAP_M {
                    continue;
                }
                // Judged at the point the boundary snaps to, with margin for the map's millimetre rounding.
                let c = s[index_at(c)];
                let (i0, i1) = (index_at(c - STRAIGHT_M), index_at(c + STRAIGHT_M));
                if turn(pts, i0.saturating_sub(1), i1 + 1) <= MAX_TURN {
                    chosen = Some(c);
                    break;
                }
            }
            d += 2.5;
        }
        let c = chosen.ok_or(SelectError::NoStraight(j))?;
        cuts.push(index_at(c));
        cut_s.push(s[index_at(c)]);
    }
    Ok(Selection {
        lap,
        cuts,
        cut_s,
        s,
        total,
    })
}

/// The transition rules, checked on a finished map's `route.segments`: the segments tile the route without gap or
/// overlap, name known biomes, adjacent ones differ, the header lists exactly the biomes used, every boundary is on a
/// straight clear of the start and seam and far from the next, the road surface follows the biome outside the transition
/// zones, and no feature straddles a boundary. Empty means valid. A map without segments is a single-biome map.
pub fn check_transitions(map: &Map) -> Vec<String> {
    let mut bad = Vec::new();
    let r = &map.route;
    let n = r.points.len();
    if r.segments.is_empty() {
        return bad;
    }
    let pts: Vec<(f64, f64)> = r
        .points
        .iter()
        .map(|p| (f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0))
        .collect();
    let (s, total) = arc_lengths(&pts);
    let known: Vec<(Biome, String)> = super::ALL.iter().map(|&b| (b, segment_name(b))).collect();
    let mut segs: Vec<(Biome, usize, usize)> = Vec::new();
    let mut expect = 0usize;
    for (k, seg) in r.segments.iter().enumerate() {
        let at = format!("route.segments[{k}] {:?}", seg.name);
        let Some((b, _)) = known.iter().find(|(_, name)| *name == seg.name).cloned() else {
            bad.push(format!("{at}: not a biome's name"));
            continue;
        };
        let (from, to) = (seg.span.from as usize, seg.span.to as usize);
        if from != expect || to < from || to >= n {
            bad.push(format!("{at}: {from}..={to} should start at point {expect} (no gap or overlap) and stay in the route"));
            continue;
        }
        if segs.last().is_some_and(|l| l.0 == b) {
            bad.push(format!("{at}: the previous segment is the same biome"));
        }
        segs.push((b, from, to));
        expect = to + 1;
    }
    if expect != n {
        bad.push(format!(
            "the segments end at point {expect}, the route has {n}"
        ));
    }
    let mut used: Vec<Biome> = segs.iter().map(|x| x.0).collect();
    used.sort();
    used.dedup();
    if used != map.header.biomes {
        bad.push(format!(
            "header.biomes {:?} isn't the biomes used {used:?}",
            map.header.biomes
        ));
    }
    let mut last_cut = f64::NEG_INFINITY;
    for w in segs.windows(2) {
        let cut = s[w[0].2];
        let name = format!("boundary at {cut:.0} m ({:?} to {:?})", w[0].0, w[1].0);
        if cut < LIMITS.earliest_m || cut > total - LIMITS.seam_m {
            bad.push(format!("{name}: inside the start or the lap seam"));
        }
        if cut - last_cut < MIN_BOUNDARY_GAP_M - 1e-9 {
            bad.push(format!(
                "{name}: only {:.0} m from the last boundary",
                cut - last_cut
            ));
        }
        last_cut = cut;
        let idx = |v: f64| s.iter().position(|&x| x >= v).unwrap_or(n - 1);
        let t = turn(&pts, idx(cut - STRAIGHT_M), idx(cut + STRAIGHT_M));
        if t > MAX_TURN + 1e-9 {
            bad.push(format!("{name}: bends {t:.2} rad within {STRAIGHT_M} m"));
        }
        for (k, feat) in map.features.iter().enumerate() {
            let fp = (
                f64::from(feat.pose.x) / 1000.0,
                f64::from(feat.pose.z) / 1000.0,
            );
            let i = (0..n)
                .min_by(|&a, &b| {
                    let d = |i: usize| (pts[i].0 - fp.0).powi(2) + (pts[i].1 - fp.1).powi(2);
                    d(a).total_cmp(&d(b))
                })
                .unwrap_or(0);
            let (before, after) = crate::features::extent_m(feat);
            let (lo, hi) = (s[i] + before, s[i] + after);
            if lo < cut + TRANSITION_M / 2.0 && hi > cut - TRANSITION_M / 2.0 {
                bad.push(format!(
                    "{name}: features[{k}] sits in or beside the transition zone"
                ));
            }
        }
    }
    for &(b, from, to) in &segs {
        let want = def(b).data().road;
        for i in from..=to {
            let near_cut = segs
                .windows(2)
                .any(|w| (s[i] - s[w[0].2]).abs() < TRANSITION_M / 2.0);
            if !near_cut && r.points[i].surface != want {
                bad.push(format!(
                    "route point {i}: {:?} on a {b:?} stretch, expected {want:?}",
                    r.points[i].surface
                ));
                break;
            }
        }
    }
    bad
}
