//! The course graph (P1-M03b): a biome-agnostic closed loop designed as a sequence of corners and straights, not noise
//! with a road painted over it.
//!
//! - **Corners first.** The structure stream draws a corner list: hairpins, sweepers, medium corners and chicanes, with
//!   at most one opposite-hand corner for rhythm. The main corners are scaled so the loop turns exactly 360°, keeping
//!   each corner inside its type's angle range.
//! - **Straights between them.** The first straight is the start straight, long enough for the start corridor behind
//!   the finish. The loop closes exactly by solving for two other straights' lengths (a 2×2 linear system), since
//!   headings are fixed once the corners are.
//! - **Length is real (R125).** The seed draws a length class (sprint, standard, epic) by the data's weights, and each
//!   draw targets a length in that class's band: the corners are drawn, then the straights share what the target leaves
//!   after the arcs and the start straight, and longer tracks add left-right bend pairs. Nothing here is a fixed count.
//! - **Checks.** The length is inside the class's band, and no two parts of the road more than
//!   [`NEIGHBOUR_WINDOW_M`] apart along it come closer than [`CLEARANCE_M`] (no self-intersection, no overlapping
//!   roads). A failed draw redraws from the same stream (deterministic) up to [`MAX_ATTEMPTS`] times, then falls back
//!   to a conservative oval: never an endless reroll (master §11.2a).
//!
//! Angles are radians, positions metres in the map's x/z plane; all maths through `libm`, so native and WASM agree.

use std::collections::BTreeMap;

use crate::seed::Rng;
pub use crate::tuning::{ClassName, CourseData, LengthClass, PresetName};

pub const WIDTH_M: f64 = 12.0;
/// Two parts of the road further apart than this along it must stay [`CLEARANCE_M`] apart.
pub const NEIGHBOUR_WINDOW_M: f64 = 60.0;
pub const CLEARANCE_M: f64 = WIDTH_M + 8.0;
pub const MAX_ATTEMPTS: u32 = 64;
pub const STEP_M: f64 = 2.5;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CornerKind {
    Hairpin,
    Sweeper,
    Medium,
    Chicane,
}

impl CornerKind {
    pub const ALL: [CornerKind; 4] = [
        CornerKind::Hairpin,
        CornerKind::Sweeper,
        CornerKind::Medium,
        CornerKind::Chicane,
    ];

    /// A corner that holds the car well under the flowing speed: a technical beat (R20).
    pub fn technical(self) -> bool {
        self != CornerKind::Sweeper
    }

    pub fn name(self) -> &'static str {
        match self {
            CornerKind::Hairpin => "hairpin",
            CornerKind::Sweeper => "sweeper",
            CornerKind::Medium => "medium",
            CornerKind::Chicane => "chicane",
        }
    }

    /// Turn angle range (degrees, magnitude) and radius range (m).
    fn ranges(self) -> ((f64, f64), (f64, f64)) {
        match self {
            CornerKind::Hairpin => ((140.0, 180.0), (13.0, 20.0)),
            CornerKind::Sweeper => ((35.0, 95.0), (45.0, 85.0)),
            CornerKind::Medium => ((60.0, 115.0), (20.0, 35.0)),
            // Each half of a chicane; the two halves cancel.
            CornerKind::Chicane => ((25.0, 45.0), (22.0, 32.0)),
        }
    }
}

/// One corner as designed: its kind, signed turn (radians, + = left) and radius.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Corner {
    pub kind: CornerKind,
    pub turn: f64,
    pub radius: f64,
}

/// A designed course: the corner list, straights, the sampled centerline and its length.
#[derive(Clone, Debug)]
pub struct Course {
    pub corners: Vec<Corner>,
    /// The family's own straights, m (not a technical cluster's links, nor the set-piece beats: `beat_spans`).
    pub straights: Vec<f64>,
    /// The centerline every ~2.5 m, starting at the start straight's beginning; closed (the last point leads back to
    /// the first).
    pub points: Vec<(f64, f64)>,
    pub length_m: f64,
    /// The length class drawn for the seed.
    pub class: ClassName,
    pub preset: PresetName,
    pub attempts: u32,
    /// True when every draw failed and the conservative oval was used.
    pub fallback: bool,
    /// Why earlier draws were rejected (introspection for the seed bank).
    pub rejects: BTreeMap<&'static str, u32>,
    /// The set-piece beat straights, as arc-length spans (m from the start, before resampling): where the lap's set
    /// pieces go, so biome boundaries keep off them (P1-FL15c).
    pub beat_spans: Vec<(f64, f64)>,
    /// Upper and lower straight spans in metres along the route, before resampling.
    pub crossing: Option<[(f64, f64); 2]>,
}

#[derive(Clone, Copy, Debug)]
enum Piece {
    Straight(f64),
    Arc { turn: f64, radius: f64 },
}

fn deg(d: f64) -> f64 {
    d * core::f64::consts::PI / 180.0
}

/// Traces pieces from the origin heading +x; returns the end position and heading.
fn trace(pieces: &[Piece]) -> ((f64, f64), f64) {
    let (mut p, mut a) = ((0.0, 0.0), 0.0);
    for piece in pieces {
        match *piece {
            Piece::Straight(l) => p = (p.0 + l * libm::cos(a), p.1 + l * libm::sin(a)),
            Piece::Arc { turn, radius } => {
                let s = if turn >= 0.0 { 1.0 } else { -1.0 };
                let c = (
                    p.0 - s * radius * libm::sin(a),
                    p.1 + s * radius * libm::cos(a),
                );
                a += turn;
                p = (
                    c.0 + s * radius * libm::sin(a),
                    c.1 - s * radius * libm::cos(a),
                );
            }
        }
    }
    (p, a)
}

/// Samples the pieces every ~[`STEP_M`] (arcs by angle, straights by length).
fn sample(pieces: &[Piece]) -> Vec<(f64, f64)> {
    let (mut p, mut a) = ((0.0, 0.0), 0.0);
    let mut out = vec![p];
    for piece in pieces {
        match *piece {
            Piece::Straight(l) => {
                let n = libm::ceil(l / STEP_M).max(1.0) as usize;
                for k in 1..=n {
                    let t = l * k as f64 / n as f64;
                    out.push((p.0 + t * libm::cos(a), p.1 + t * libm::sin(a)));
                }
                p = (p.0 + l * libm::cos(a), p.1 + l * libm::sin(a));
            }
            Piece::Arc { turn, radius } => {
                let s = if turn >= 0.0 { 1.0 } else { -1.0 };
                let c = (
                    p.0 - s * radius * libm::sin(a),
                    p.1 + s * radius * libm::cos(a),
                );
                let n = libm::ceil(turn.abs() * radius / STEP_M).max(1.0) as usize;
                for k in 1..=n {
                    let b = a + turn * k as f64 / n as f64;
                    out.push((
                        c.0 + s * radius * libm::sin(b),
                        c.1 - s * radius * libm::cos(b),
                    ));
                }
                a += turn;
                p = (
                    c.0 + s * radius * libm::sin(a),
                    c.1 - s * radius * libm::cos(a),
                );
            }
        }
    }
    // The loop closes onto the first point: drop the duplicate end.
    out.pop();
    out
}

/// Arc-length spans (m from the start) of the pieces at `ix`.
fn spans_of(pieces: &[Piece], ix: &[usize]) -> Vec<(f64, f64)> {
    let mut at = 0.0;
    let mut out = Vec::new();
    for (i, p) in pieces.iter().enumerate() {
        let len = match *p {
            Piece::Straight(l) => l,
            Piece::Arc { turn, radius } => turn.abs() * radius,
        };
        if ix.contains(&i) {
            out.push((at, at + len));
        }
        at += len;
    }
    out
}

fn length(points: &[(f64, f64)]) -> f64 {
    (0..points.len())
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % points.len()]);
            libm::hypot(b.0 - a.0, b.1 - a.1)
        })
        .sum()
}

/// No two parts of the road further apart than the neighbour window along it come within the clearance.
pub fn self_clear(points: &[(f64, f64)]) -> bool {
    let n = points.len();
    let mut s = vec![0.0; n];
    for i in 1..n {
        s[i] = s[i - 1] + libm::hypot(points[i].0 - points[i - 1].0, points[i].1 - points[i - 1].1);
    }
    let total = length(points);
    for i in 0..n {
        for j in (i + 1)..n {
            let along = (s[j] - s[i]).min(total - (s[j] - s[i]));
            if along > NEIGHBOUR_WINDOW_M
                && libm::hypot(points[i].0 - points[j].0, points[i].1 - points[j].1) < CLEARANCE_M
            {
                return false;
            }
        }
    }
    true
}

fn range(rng: &mut Rng, (lo, hi): (f64, f64)) -> f64 {
    rng.range(lo, hi)
}

/// How an attempt treats the set-piece beat straights.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Beat {
    Drawn,
    Shortest,
    None,
}

/// A figure eight's lobes get set-piece beat straights only if they stay at least this round, m.
const EIGHT_BEAT_MIN_RADIUS_M: f64 = 45.0;
/// A figure eight's beat may be shortened to fit its lobes, to this share of the data's shortest beat (a set piece's
/// core still fits).
const EIGHT_BEAT_MIN_SHARE: f64 = 0.75;

/// Largest share of the lap one set-piece beat straight may take.
const BEAT_SHARE: f64 = 0.22;

/// A draw's corners, pieces and the two lists of piece indices it returns alongside them.
type Drawn = (Vec<Corner>, Vec<Piece>, Vec<usize>, Vec<usize>);

/// One draw: a corner list and straights, closed exactly, or why it couldn't be.
fn draw(
    rng: &mut Rng,
    data: &CourseData,
    preset: &crate::tuning::CoursePreset,
    target_m: f64,
    beat: Beat,
    technical: f64,
) -> Result<Drawn, &'static str> {
    // The turn budget: 360° of left-hand turning net, plus whatever an optional right-hander takes back.
    let right = (rng.unit() < preset.opposite_corner_probability).then(|| range(rng, (40.0, 75.0)));
    let total = 360.0 + right.unwrap_or(0.0);
    // Hairpins first (one, sometimes two), then sweepers and medium corners filling what's left, scaled to fit.
    let mut corners = Vec::new();
    let hairpins = if rng.unit() < preset.hairpin_probability {
        1 + usize::from(rng.unit() < preset.second_hairpin_probability)
    } else {
        0
    };
    for _ in 0..hairpins {
        let ((a0, a1), r) = CornerKind::Hairpin.ranges();
        corners.push(Corner {
            kind: CornerKind::Hairpin,
            turn: range(rng, (a0, a1)),
            radius: range(rng, r),
        });
    }
    let mut rest = total - corners.iter().map(|c| c.turn).sum::<f64>();
    if rest < 35.0 {
        // Two big hairpins leave too little for anything else: drop one.
        corners.pop();
        rest = total - corners.iter().map(|c| c.turn).sum::<f64>();
    }
    let others = libm::round(rest / 75.0).max(1.0) as usize;
    let mut fill: Vec<Corner> = (0..others)
        .map(|_| {
            let kind = if rng.unit() < preset.sweeper_probability {
                CornerKind::Sweeper
            } else {
                CornerKind::Medium
            };
            let (a, r) = kind.ranges();
            Corner {
                kind,
                turn: range(rng, a),
                radius: range(rng, r),
            }
        })
        .collect();
    let drawn: f64 = fill.iter().map(|c| c.turn).sum();
    for c in &mut fill {
        let ((lo, hi), _) = c.kind.ranges();
        c.turn = (c.turn * rest / drawn).clamp(lo, hi);
    }
    // Fit within the actual angle ranges instead of rejecting a whole course
    // when one proportional angle overshoots. Redistribute the residual only
    // through available capacity; an infeasible type list still redraws.
    let mut remaining = rest - fill.iter().map(|c| c.turn).sum::<f64>();
    for c in &mut fill {
        let ((lo, hi), _) = c.kind.ranges();
        let add = remaining.clamp(lo - c.turn, hi - c.turn);
        c.turn += add;
        remaining -= add;
    }
    if remaining.abs() > 1e-6 {
        return Err("corner types cannot fit the turn budget");
    }
    corners.extend(fill);
    if let Some(r) = right {
        let (_, radius) = CornerKind::Medium.ranges();
        corners.push(Corner {
            kind: CornerKind::Medium,
            turn: -r,
            radius: range(rng, radius),
        });
    }
    // Longer tracks bend more: left-right pairs (net zero turn) in proportion to the length.
    let pairs = libm::floor(
        (target_m / (data.bend_spacing_m * preset.bend_spacing_scale) - 3.0).max(0.0) + rng.unit(),
    ) as usize;
    for _ in 0..pairs {
        let kind = if rng.unit() < preset.sweeper_probability {
            CornerKind::Sweeper
        } else {
            CornerKind::Medium
        };
        let (_, r) = kind.ranges();
        let turn = range(rng, (30.0, 60.0));
        let radius = range(rng, r);
        let side = if rng.unit() < 0.5 { 1.0 } else { -1.0 };
        for sign in [side, -side] {
            corners.push(Corner {
                kind,
                turn: sign * turn,
                radius,
            });
        }
    }
    let chicanes = libm::floor(target_m / 1000.0 * preset.chicanes_per_km + rng.unit()) as usize;
    for _ in 0..chicanes {
        let (a, r) = CornerKind::Chicane.ranges();
        corners.push(Corner {
            kind: CornerKind::Chicane,
            turn: range(rng, a) * preset.chicane_angle_scale,
            radius: range(rng, r),
        });
    }
    // The rhythm (R20, P1-FL15c): at least one technical corner (hairpin, medium, chicane) every `technicalSpacingM`,
    // topped up with chicanes (they turn net zero, so the turn budget holds).
    let clusters = if data.technical_spacing_m > 0.0 && technical > 0.0 {
        libm::ceil(
            technical * target_m
                / (data.technical_spacing_m * preset.technical_spacing_scale.max(0.1)),
        ) as usize
    } else {
        0
    };
    if clusters > 0 {
        let corners_technical = |c: &Corner| c.kind.technical();
        let already = corners.iter().filter(|c| c.kind.technical()).count();
        let mut tightened = 0usize;
        let want = clusters * data.technical_cluster.max(1);
        // Tighten sweepers into medium corners first (same turn, a medium radius: the straights keep their count and
        // length, so a speedway stays a speedway), then add chicanes.
        for c in corners.iter_mut() {
            if corners_technical(c) {
                continue;
            }
            if c.kind == CornerKind::Sweeper && tightened < want.saturating_sub(already) {
                let (_, r) = CornerKind::Medium.ranges();
                c.kind = CornerKind::Medium;
                c.radius = range(rng, r);
                tightened += 1;
            }
        }
        // (A family without chicanes, a speedway, only tightens its sweepers.)
        while preset.chicanes_per_km > 0.0
            && corners.iter().filter(|c| c.kind.technical()).count() < want
        {
            let (a, r) = CornerKind::Chicane.ranges();
            corners.push(Corner {
                kind: CornerKind::Chicane,
                turn: range(rng, a) * preset.chicane_angle_scale,
                radius: range(rng, r),
            });
        }
    }
    for c in &mut corners {
        c.turn = deg(c.turn);
        c.radius *= preset.radius_scale;
    }
    // A shuffled order, but never two hairpins back to back.
    for i in (1..corners.len()).rev() {
        let j = (rng.next_u64() % (i as u64 + 1)) as usize;
        corners.swap(i, j);
    }
    // Then the technical corners grouped into clusters (a technical beat: corners joined by short links, dealt round
    // robin so the hairpins land in different clusters) spread evenly round the lap between the flowing corners, so
    // the lap alternates flow and technical beats and no flowing stretch runs on (R20).
    let mut link_after = vec![false; corners.len()];
    if clusters > 0 {
        let (tech, flow): (Vec<Corner>, Vec<Corner>) =
            corners.iter().partition(|c| c.kind.technical());
        // As many clusters as the spacing asks for, or as the lap's own technical corners fill at the cluster size
        // (a twisty lap's corners stay spread: clustering them all into a few would leave a few long straights).
        let size = data.technical_cluster.max(1);
        let k = clusters
            .max(tech.len().div_ceil(size))
            .min(tech.len())
            .max(1);
        let groups: Vec<Vec<Corner>> = (0..k)
            .map(|j| tech.iter().skip(j).step_by(k).copied().collect())
            .filter(|g: &Vec<Corner>| !g.is_empty())
            .collect();
        let at: Vec<usize> = (0..groups.len())
            .map(|j| ((2 * j + 1) * flow.len()) / (2 * groups.len()))
            .collect();
        let mut ordered = Vec::with_capacity(corners.len());
        let mut links = Vec::with_capacity(corners.len());
        for i in 0..=flow.len() {
            for (j, g) in groups.iter().enumerate() {
                if at[j] == i {
                    for (m, c) in g.iter().enumerate() {
                        ordered.push(*c);
                        links.push(m + 1 < g.len());
                    }
                }
            }
            if let Some(c) = flow.get(i) {
                ordered.push(*c);
                links.push(false);
            }
        }
        corners = ordered;
        link_after = links;
    }
    if corners
        .windows(2)
        .any(|w| w[0].kind == CornerKind::Hairpin && w[1].kind == CornerKind::Hairpin)
    {
        return Err("two hairpins back to back");
    }
    // Pieces: the start straight, then each corner followed by a straight. A chicane is two opposite arcs back to back.
    let mut pieces = vec![Piece::Straight(range(
        rng,
        (data.start_straight_min_m, data.start_straight_max_m),
    ))];
    let mut fixed_links: Vec<usize> = Vec::new();
    // The straights that follow a technical corner (by piece index): a set-piece beat there starts its approach out of
    // a tight corner, the chase camera swinging, so its landmark is seen late.
    let mut after_technical: Vec<usize> = Vec::new();
    for (ci, c) in corners.iter().enumerate() {
        if c.kind == CornerKind::Chicane {
            let side = if rng.unit() < 0.5 { 1.0 } else { -1.0 };
            pieces.push(Piece::Arc {
                turn: side * c.turn,
                radius: c.radius,
            });
            pieces.push(Piece::Arc {
                turn: -side * c.turn,
                radius: c.radius,
            });
        } else {
            pieces.push(Piece::Arc {
                turn: c.turn,
                radius: c.radius,
            });
        }
        if c.kind.technical() {
            after_technical.push(pieces.len());
        }
        // A share of the lap; the scale that brings the lap to the target comes after. Inside a technical cluster it's
        // a short link of fixed length instead.
        if link_after[ci] {
            fixed_links.push(pieces.len());
            pieces.push(Piece::Straight(range(
                rng,
                (data.technical_link_m[0], data.technical_link_m[1]),
            )));
        } else {
            pieces.push(Piece::Straight(range(
                rng,
                (1.0 - data.straight_spread, 1.0 + data.straight_spread),
            )));
        }
    }
    // Set-piece beats (R132): some of the straights after a corner get a fixed set-piece length, kept out of the
    // scaling and the loop closing below, so every lap has the run a set piece needs (P1-FL15b).
    let mut beats: Vec<usize> = Vec::new();
    let [b0, b1] = data.set_piece_straight_m;
    if beat != Beat::None && b1 > 0.0 {
        // As many beats as the lap's set-piece minimum, which a short lap halves (`setpieces::min_for`).
        let floor = data
            .set_piece_straights_min
            .max(1)
            .min(crate::setpieces::min_for(crate::setpieces::shipped(), target_m, &[]).max(1));
        let want = (floor as usize)
            .max(libm::round(data.set_piece_straights_per_km * target_m / 1000.0) as usize);
        let mut slots: Vec<usize> = (1..pieces.len())
            .filter(|&i| matches!(pieces[i], Piece::Straight(_)) && !fixed_links.contains(&i))
            .collect();
        // The straights either side of the start (into the corridor, and right after the first corner) stay free: a
        // piece there would crowd the grid.
        slots.pop();
        if slots.len() > 1 {
            slots.remove(0);
        }
        // Out of a flowing corner where the lap has enough such straights (the landmark is seen from afar, R132).
        let flowing: Vec<usize> = slots
            .iter()
            .copied()
            .filter(|i| !after_technical.contains(i))
            .collect();
        if flowing.len() >= want {
            slots = flowing;
        }
        // Spread round the lap (set pieces >= 15 s apart, R20): every (slots / want)-th straight from a drawn offset.
        let take = want.min(slots.len());
        let stride = slots.len() as f64 / take.max(1) as f64;
        let offset = rng.unit() * stride;
        let picked: Vec<usize> = (0..take)
            .map(|k| slots[(libm::floor(offset + k as f64 * stride) as usize).min(slots.len() - 1)])
            .collect();
        for i in picked {
            // A short lap can't spare a long beat: at most a fifth of the lap.
            let cap = target_m * BEAT_SHARE;
            let l = range(rng, (b0.min(cap), b1.min(cap)));
            pieces[i] = Piece::Straight(if beat == Beat::Shortest {
                b0.min(cap)
            } else {
                l
            });
            beats.push(i);
        }
    }
    let arcs: f64 = pieces
        .iter()
        .map(|p| match *p {
            Piece::Arc { turn, radius } => turn.abs() * radius,
            Piece::Straight(_) => 0.0,
        })
        .sum();
    let start = match pieces[0] {
        Piece::Straight(l) => l,
        Piece::Arc { .. } => 0.0,
    };
    // The beats and the cluster links keep their lengths: out of the scaling and the loop closing.
    let set_piece_beats = beats.clone();
    beats.extend(fixed_links.iter().copied());
    let fixed: f64 = beats
        .iter()
        .map(|&i| {
            if let Piece::Straight(l) = pieces[i] {
                l
            } else {
                0.0
            }
        })
        .sum();
    let shares: f64 = pieces[1..]
        .iter()
        .enumerate()
        .filter(|(k, _)| !beats.contains(&(k + 1)))
        .map(|(_, p)| if let Piece::Straight(l) = p { *l } else { 0.0 })
        .sum();
    let scale = (target_m - arcs - start - fixed) / shares;
    if scale * (1.0 - data.straight_spread) < data.min_straight_m {
        return Err("the target length leaves the straights too short");
    }
    for (k, p) in pieces[1..].iter_mut().enumerate() {
        if let Piece::Straight(l) = p
            && !beats.contains(&(k + 1))
        {
            *l *= scale;
        }
    }
    // Close the position: of every pair of straights (not the start straight), the one whose adjustment keeps both
    // straights long enough with the least total change.
    let (end, _) = trace(&pieces);
    let mut heading = 0.0;
    let mut dirs = Vec::new();
    for (i, p) in pieces.iter().enumerate() {
        match *p {
            Piece::Straight(l) => dirs.push((i, (libm::cos(heading), libm::sin(heading)), l)),
            Piece::Arc { turn, .. } => heading += turn,
        }
    }
    let (ex, ez) = (-end.0, -end.1);
    let mut best: Option<(f64, usize, f64, usize, f64)> = None;
    for (x, &(i, di, li)) in dirs.iter().enumerate().skip(1) {
        for &(j, dj, lj) in dirs.iter().skip(x + 1) {
            if beats.contains(&i) || beats.contains(&j) {
                continue;
            }
            let det = di.0 * dj.1 - di.1 * dj.0;
            if det.abs() < 0.2 {
                continue;
            }
            let a = (ex * dj.1 - ez * dj.0) / det;
            let b = (di.0 * ez - di.1 * ex) / det;
            if li + a < data.min_straight_m || lj + b < data.min_straight_m {
                continue;
            }
            let cost = a.abs() + b.abs();
            if best.is_none_or(|bb| cost < bb.0) {
                best = Some((cost, i, a, j, b));
            }
        }
    }
    let (_, i, a, j, b) = best.ok_or("no pair of straights closes the loop")?;
    for (k, add) in [(i, a), (j, b)] {
        if let Piece::Straight(l) = &mut pieces[k] {
            *l += add;
        }
    }
    Ok((corners, pieces, set_piece_beats, fixed_links))
}

/// The conservative fallback: a plain oval of the target length.
fn oval(target_m: f64) -> (Vec<Corner>, Vec<Piece>) {
    let radius = 40.0;
    let straight = (target_m - 2.0 * core::f64::consts::PI * radius) / 2.0;
    let half = Corner {
        kind: CornerKind::Hairpin,
        turn: deg(180.0),
        radius,
    };
    (
        vec![half, half],
        vec![
            Piece::Straight(straight),
            Piece::Arc {
                turn: half.turn,
                radius,
            },
            Piece::Straight(straight),
            Piece::Arc {
                turn: half.turn,
                radius,
            },
        ],
    )
}

/// A hand-made oval (Feel Lab scenes, R131): two straights of `straight_m` joined by half circles of `radius_m`, starting at
/// the first straight's beginning.
pub fn lab_oval(straight_m: f64, radius_m: f64) -> Course {
    let half = Corner {
        kind: CornerKind::Hairpin,
        turn: deg(180.0),
        radius: radius_m,
    };
    let pieces = vec![
        Piece::Straight(straight_m),
        Piece::Arc {
            turn: half.turn,
            radius: radius_m,
        },
        Piece::Straight(straight_m),
        Piece::Arc {
            turn: half.turn,
            radius: radius_m,
        },
    ];
    let points = sample(&pieces);
    Course {
        corners: vec![half, half],
        straights: straights(&pieces),
        length_m: length(&points),
        points,
        class: ClassName::Sprint,
        preset: PresetName::Speedway,
        attempts: 1,
        fallback: false,
        rejects: BTreeMap::new(),
        crossing: None,
        beat_spans: Vec::new(),
    }
}

/// Designs a course from the structure stream with the shipped generator data.
pub fn design(rng: &mut Rng) -> Course {
    design_with(rng, &crate::tuning::GeneratorData::shipped().course)
}

/// [`design`] with explicit course data (the owner tuning menu's length classes and straights).
pub fn design_with(rng: &mut Rng, data: &CourseData) -> Course {
    let class = draw_class(rng, data);
    let total: f64 = PresetName::ALL
        .iter()
        .map(|n| data.presets.weight(*n))
        .sum();
    let mut pick = rng.unit() * total;
    let preset = PresetName::ALL
        .into_iter()
        .find(|n| {
            let weight = data.presets.weight(*n);
            if pick < weight {
                true
            } else {
                pick -= weight;
                false
            }
        })
        .unwrap_or(PresetName::Speedway);
    let band = *data.classes.get(class);
    // A figure eight needs its minimum length (lobes round enough for set-piece beats, P1-FL15c): a class too short for
    // one draws among the other families instead, by their weights.
    let others = [
        PresetName::Twisty,
        PresetName::Flowing,
        PresetName::Speedway,
    ];
    let total: f64 = others.iter().map(|n| data.presets.weight(*n)).sum();
    // (Data that draws only figure eights keeps them: a plain eight, without its lobe beats, on a short class.)
    let preset = if preset == PresetName::FigureEight
        && band.length_max_m < data.presets.figure_eight.min_length_m
        && total > 0.0
    {
        let mut pick = rng.unit() * total;
        others
            .into_iter()
            .find(|n| {
                let w = data.presets.weight(*n);
                if pick < w {
                    true
                } else {
                    pick -= w;
                    false
                }
            })
            .unwrap_or(PresetName::Speedway)
    } else {
        preset
    };
    if preset == PresetName::FigureEight {
        return figure_eight(rng, data, class, band);
    }
    let mut rejects: BTreeMap<&'static str, u32> = BTreeMap::new();
    for attempt in 1..=MAX_ATTEMPTS {
        let target = range(rng, (band.length_min_m, band.length_max_m));
        // Each attempt first tries with the set-piece beat (drawn, then its shortest) and the technical clusters; if no
        // course works out, the same attempt runs again with fewer clusters and then without the beat, from the same
        // stream state, so neither costs a course the plain designer would find.
        let saved = rng.clone();
        let mut found = None;
        // The set-piece beats matter more than the technical clusters: a lap that can't fit both keeps its beats with
        // half the clusters, then none, before it gives up the beats.
        for (beat, technical) in [
            (Beat::Drawn, 1.0),
            (Beat::Shortest, 1.0),
            (Beat::Drawn, 0.5),
            (Beat::Shortest, 0.5),
            (Beat::Shortest, 0.0),
            (Beat::None, 1.0),
            (Beat::None, 0.0),
        ] {
            *rng = saved.clone();
            let (corners, pieces, beat_ix, link_ix) = match draw(
                rng,
                data,
                data.presets.get(preset).expect("ordinary course preset"),
                target,
                beat,
                technical,
            ) {
                Ok(d) => d,
                Err(why) => {
                    *rejects.entry(why).or_default() += 1;
                    continue;
                }
            };
            let points = sample(&pieces);
            let len = length(&points);
            let why = if len < band.length_min_m {
                Some("shorter than the length band")
            } else if len > band.length_max_m {
                Some("longer than the length band")
            } else if !self_clear(&points) {
                Some("the road comes too close to itself")
            } else {
                None
            };
            if let Some(why) = why {
                *rejects.entry(why).or_default() += 1;
                continue;
            }
            found = Some((corners, pieces, points, len, beat_ix, link_ix));
            break;
        }
        let Some((corners, pieces, points, len, beat_ix, link_ix)) = found else {
            continue;
        };
        // The family's own straights: a technical cluster's links are part of the cluster, and the set-piece beats
        // (the same in every family) are reported apart, as `beat_spans`.
        let straights_m = straights(
            &pieces
                .iter()
                .enumerate()
                .filter(|(i, _)| !link_ix.contains(i) && !beat_ix.contains(i))
                .map(|(_, p)| *p)
                .collect::<Vec<_>>(),
        );
        return Course {
            corners,
            straights: straights_m,
            points,
            length_m: len,
            class,
            preset,
            attempts: attempt,
            fallback: false,
            rejects,
            crossing: None,
            beat_spans: spans_of(&pieces, &beat_ix),
        };
    }
    let (corners, pieces) = oval((band.length_min_m + band.length_max_m) / 2.0);
    let points = sample(&pieces);
    Course {
        corners,
        straights: straights(&pieces),
        length_m: length(&points),
        points,
        class,
        preset,
        attempts: MAX_ATTEMPTS,
        fallback: true,
        rejects,
        crossing: None,
        beat_spans: Vec::new(),
    }
}

/// Opposite-hand lobes joined by long tangent straights, crossing once at a real angle.
/// The upper straight's grade is applied after terrain, never baked into the lower road.
fn figure_eight(rng: &mut Rng, data: &CourseData, class: ClassName, band: LengthClass) -> Course {
    let floor = data
        .presets
        .figure_eight
        .min_length_m
        .clamp(band.length_min_m, band.length_max_m);
    let target = rng.range(floor, band.length_max_m);
    let angle = deg(rng.range(
        data.crossing.lobe_turn_min_deg,
        data.crossing.lobe_turn_max_deg,
    ));
    let ratio = -libm::tan(angle / 2.0);
    let sign = if rng.unit() < 0.5 { 1.0 } else { -1.0 };
    // Set-piece beats (P1-FL15c): `k` straights of `beat` m in each lobe, splitting it into k + 1 equal arcs, where the
    // crossing's keep-outs don't reach. A lobe's beats head along angle·j/(k+1); summed, each lobe's lie along angle/2
    // (both lobes' do), so they join the closing equation along it:
    // S = (2r·sin(angle/2) + beat·Σ cos(angle·(j/(k+1) − 1/2))) / -cos(angle/2), and the lap 2S + 2k·beat + 2·angle·r is
    // linear in r. Two beats a lobe on a long eight, one on a shorter one (the beat shortened to fit, never below the
    // data's minimum), none if the lobes would get tighter than `EIGHT_BEAT_MIN_RADIUS_M`.
    let [b0, b1] = data.set_piece_straight_m;
    let drawn_beat = if b1 > 0.0 { range(rng, (b0, b1)) } else { 0.0 };
    let c = -libm::cos(angle / 2.0);
    let layout = |k: usize, beat: f64| {
        let along: f64 = (1..=k)
            .map(|j| libm::cos(angle * (j as f64 / (k + 1) as f64 - 0.5)))
            .sum();
        // target = 2S + 2k·beat + 2·angle·r, S = (2r·sin(angle/2) + beat·along) / c
        let per_r = 2.0 * angle + 4.0 * libm::sin(angle / 2.0) / c;
        let fixed = 2.0 * k as f64 * beat + 2.0 * beat * along / c;
        let r = (target - fixed) / per_r;
        (
            r,
            (2.0 * r * libm::sin(angle / 2.0) + beat * along) / c,
            fixed,
            per_r,
        )
    };
    let mut chosen: Option<(usize, f64)> = None;
    if drawn_beat > 0.0 {
        for k in [2usize, 1] {
            let (r, _, _, per_r) = layout(k, drawn_beat);
            let beat = if r >= EIGHT_BEAT_MIN_RADIUS_M {
                drawn_beat
            } else {
                // The longest beat that keeps the lobes round enough.
                let unit = layout(k, 1.0).2;
                (target - EIGHT_BEAT_MIN_RADIUS_M * per_r) / unit
            };
            if beat >= b0 * EIGHT_BEAT_MIN_SHARE {
                chosen = Some((k, beat.min(drawn_beat)));
                break;
            }
        }
    }
    let (k, beat_m) = chosen.unwrap_or((0, 0.0));
    let beat = k > 0;
    let (mut radius, mut straight) = if beat {
        let (r, sl, _, _) = layout(k, beat_m);
        (r, sl)
    } else {
        let r = target / (4.0 * ratio + 2.0 * angle);
        (r, 2.0 * ratio * r)
    };
    let part = |turn: f64| Piece::Arc {
        turn: turn / (k + 1) as f64,
        radius,
    };
    let mut pieces: Vec<Piece> = Vec::new();
    let mut beat_ix: Vec<usize> = Vec::new();
    for lobe in [sign, -sign] {
        pieces.push(Piece::Straight(straight));
        if beat {
            pieces.push(part(lobe * angle));
            for _ in 0..k {
                beat_ix.push(pieces.len());
                pieces.push(Piece::Straight(beat_m));
                pieces.push(part(lobe * angle));
            }
        } else {
            pieces.push(Piece::Arc {
                turn: lobe * angle,
                radius,
            });
        }
    }
    debug_assert!({
        let (end, _) = trace(&pieces);
        libm::hypot(end.0, end.1) < 1e-6 * target
    });

    let mut points = sample(&pieces);
    // Arc chords are shorter than analytical arcs. Fit the sampled route to the
    // requested length, rather than letting the shortest band undershoot.
    let scale = target / length(&points);
    for p in &mut points {
        p.0 *= scale;
        p.1 *= scale;
    }
    radius *= scale;
    straight *= scale;
    let beat_m = beat_m * scale;
    let lobe = angle * radius;
    let beat_spans: Vec<(f64, f64)> = spans_of(&pieces, &beat_ix)
        .into_iter()
        .map(|(a, b)| (a * scale, b * scale))
        .collect();
    Course {
        corners: vec![
            Corner {
                kind: CornerKind::Sweeper,
                turn: sign * angle,
                radius,
            },
            Corner {
                kind: CornerKind::Sweeper,
                turn: -sign * angle,
                radius,
            },
        ],
        straights: vec![straight, straight],
        length_m: length(&points),
        points,
        class,
        preset: PresetName::FigureEight,
        attempts: 1,
        fallback: false,
        rejects: BTreeMap::new(),
        crossing: Some([
            (
                straight + lobe + k as f64 * beat_m,
                2.0 * straight + lobe + k as f64 * beat_m,
            ),
            (0.0, straight),
        ]),
        beat_spans,
    }
}

/// The seed's length class, by the data's weights (the first draw of the structure stream).
fn draw_class(rng: &mut Rng, data: &CourseData) -> ClassName {
    let total: f64 = ClassName::ALL
        .iter()
        .map(|c| data.classes.get(*c).weight)
        .sum();
    let mut pick = rng.unit() * total;
    for c in ClassName::ALL {
        let w = data.classes.get(c).weight;
        if pick < w {
            return c;
        }
        pick -= w;
    }
    ClassName::Standard
}

fn straights(pieces: &[Piece]) -> Vec<f64> {
    pieces
        .iter()
        .filter_map(|p| {
            if let Piece::Straight(l) = p {
                Some(*l)
            } else {
                None
            }
        })
        .collect()
}
