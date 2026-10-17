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
    select_avoiding(pts, recipe, rng, &[])
}

/// [`select`], keeping each boundary (and its transition) off the `avoid` arc-length spans (the course's set-piece
/// beat straights, P1-FL15c) where the lap has another straight for it; where it doesn't, the boundary goes where it
/// would have anyway.
pub fn select_avoiding(
    pts: &[(f64, f64)],
    recipe: &[Biome],
    rng: &mut Rng,
    avoid: &[(f64, f64)],
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
        // First keeping off the avoided spans, then (no straight elsewhere) anywhere.
        for keep_off in [true, false] {
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
                    if keep_off
                        && avoid
                            .iter()
                            .any(|&(a, b)| c > a - TRANSITION_M / 2.0 && c < b + TRANSITION_M / 2.0)
                    {
                        continue;
                    }
                    let (i0, i1) = (index_at(c - STRAIGHT_M), index_at(c + STRAIGHT_M));
                    if turn(pts, i0.saturating_sub(1), i1 + 1) <= MAX_TURN {
                        chosen = Some(c);
                        break;
                    }
                }
                d += 2.5;
            }
            if chosen.is_some() || avoid.is_empty() {
                break;
            }
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

/// Crossing layouts have two long straight runs. Plan all boundaries together:
/// a greedy first cut at the end of one run can otherwise consume the room needed
/// by the later cuts. Retains exactly the same turn, spacing, start and seam rules.
/// Like [`select_avoiding`], the boundaries (and their transitions) keep off the `avoid` spans (the lobes' set-piece
/// beat straights, P1-FL15c.1) where the lap has room for every boundary elsewhere; where it doesn't, anywhere.
pub fn select_crossing(
    pts: &[(f64, f64)],
    recipe: &[Biome],
    rng: &mut Rng,
    avoid: &[(f64, f64)],
) -> Result<Selection, SelectError> {
    let mut lap = Vec::new();
    for &b in recipe {
        if lap.last() != Some(&b) {
            lap.push(b);
        }
    }
    let first = *lap.first().ok_or(SelectError::EmptyRecipe)?;
    if lap.len() > 1 && lap.last() != Some(&first) {
        lap.push(first);
    }
    let (s, total) = arc_lengths(pts);
    let boundaries = lap.len() - 1;
    if boundaries == 0 {
        return Ok(Selection {
            lap,
            cuts: Vec::new(),
            cut_s: Vec::new(),
            s,
            total,
        });
    }
    let lo = LIMITS.earliest_m + TRANSITION_M;
    let hi = total - LIMITS.seam_m - TRANSITION_M;
    let spacing = (hi - lo) / (boundaries + 1) as f64;
    let at = |v: f64| s.iter().position(|&x| x >= v).unwrap_or(s.len() - 1);
    let straight: Vec<usize> = (0..s.len())
        .filter(|&i| {
            s[i] >= lo
                && s[i] <= hi
                && turn(
                    pts,
                    at(s[i] - STRAIGHT_M).saturating_sub(1),
                    at(s[i] + STRAIGHT_M) + 1,
                ) <= MAX_TURN
        })
        .collect();
    let targets: Vec<f64> = (0..boundaries)
        .map(|boundary| lo + spacing * (boundary + 1) as f64 + rng.range(-0.1, 0.1) * spacing)
        .collect();
    let off_avoided: Vec<usize> = straight
        .iter()
        .copied()
        .filter(|&i| {
            !avoid
                .iter()
                .any(|&(a, b)| s[i] > a - TRANSITION_M / 2.0 && s[i] < b + TRANSITION_M / 2.0)
        })
        .collect();
    let cuts = match plan_cuts(&s, &off_avoided, &targets) {
        Some(cuts) => cuts,
        None => {
            plan_cuts(&s, &straight, &targets).ok_or(SelectError::NoStraight(boundaries - 1))?
        }
    };
    let cut_s = cuts.iter().map(|&i| s[i]).collect();
    Ok(Selection {
        lap,
        cuts,
        cut_s,
        s,
        total,
    })
}

/// The boundary chain over `candidates` (route indices) nearest the `targets` (least squares), each boundary at least
/// [`MIN_BOUNDARY_GAP_M`] after the one before; `None` if no chain fits.
fn plan_cuts(s: &[f64], candidates: &[usize], targets: &[f64]) -> Option<Vec<usize>> {
    let boundaries = targets.len();
    let n = candidates.len();
    let mut previous = vec![0.0f64; n];
    let mut parents = Vec::new();
    for (boundary, &target) in targets.iter().enumerate() {
        let mut scores = vec![f64::INFINITY; n];
        let mut parent = vec![None; n];
        let (mut eligible, mut best) = (0, None::<usize>);
        for j in 0..n {
            if boundary > 0 {
                while eligible < j
                    && s[candidates[j]] - s[candidates[eligible]] >= MIN_BOUNDARY_GAP_M
                {
                    if previous[eligible].is_finite()
                        && best.is_none_or(|k| previous[eligible] < previous[k])
                    {
                        best = Some(eligible);
                    }
                    eligible += 1;
                }
                if let Some(k) = best {
                    scores[j] = previous[k];
                    parent[j] = Some(k);
                } else {
                    continue;
                }
            } else {
                scores[j] = 0.0;
            }
            scores[j] += (s[candidates[j]] - target).powi(2);
        }
        previous = scores;
        parents.push(parent);
    }
    let mut j = (0..n)
        .filter(|&j| previous[j].is_finite())
        .min_by(|&a, &b| previous[a].total_cmp(&previous[b]))?;
    let mut cuts = Vec::new();
    for boundary in (0..boundaries).rev() {
        cuts.push(candidates[j]);
        if boundary > 0 {
            j = parents[boundary][j].expect("finite boundary chain");
        }
    }
    cuts.reverse();
    Some(cuts)
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
    // Canonical storage sorts this unordered collection by name. Validate its
    // route coverage in spatial order, both before and after a canonical load.
    let mut ordered: Vec<_> = r.segments.iter().collect();
    ordered.sort_by_key(|seg| seg.span.from);
    for (k, seg) in ordered.into_iter().enumerate() {
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
            // A bridge carries the route itself, including its per-segment surface
            // transitions. Its grade/clearance validator governs the whole deck;
            // unlike an ordinary jump or crest it is not biome-local furniture.
            if feat.kind == jj_map::FeatureKind::Bridge {
                continue;
            }
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
