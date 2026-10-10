//! The course graph (P1-M03b): a biome-agnostic closed loop designed as a sequence of corners and straights, not noise
//! with a road painted over it.
//!
//! - **Corners first.** The structure stream draws a corner list: hairpins, sweepers, medium corners and chicanes, with
//!   at most one opposite-hand corner for rhythm. The main corners are scaled so the loop turns exactly 360°, keeping
//!   each corner inside its type's angle range.
//! - **Straights between them.** The first straight is the start straight, long enough for the start corridor behind
//!   the finish. The loop closes exactly by solving for two other straights' lengths (a 2×2 linear system), since
//!   headings are fixed once the corners are.
//! - **Checks.** The length is inside [`LENGTH_BAND_M`], and no two parts of the road more than
//!   [`NEIGHBOUR_WINDOW_M`] apart along it come closer than [`CLEARANCE_M`] (no self-intersection, no overlapping
//!   roads). A failed draw redraws from the same stream (deterministic) up to [`MAX_ATTEMPTS`] times, then falls back
//!   to a conservative oval: never an endless reroll (master §11.2a).
//!
//! Angles are radians, positions metres in the map's x/z plane; all maths through `libm`, so native and WASM agree.

use std::collections::BTreeMap;

use crate::seed::Rng;
pub use crate::tuning::CourseData;

/// The lap length band (TUNE): laps of ~47–73 s at the 15 m/s reference speed.
pub const LENGTH_BAND_M: (f64, f64) = (700.0, 1100.0);
pub const WIDTH_M: f64 = 12.0;
/// The start straight: long enough for the 60 m to the finish plus room past it.
pub const START_STRAIGHT_M: (f64, f64) = (110.0, 160.0);
pub const STRAIGHT_M: (f64, f64) = (18.0, 90.0);
pub const MIN_STRAIGHT_M: f64 = 12.0;
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
    pub straights: Vec<f64>,
    /// The centerline every ~2.5 m, starting at the start straight's beginning; closed (the last point leads back to
    /// the first).
    pub points: Vec<(f64, f64)>,
    pub length_m: f64,
    pub attempts: u32,
    /// True when every draw failed and the conservative oval was used.
    pub fallback: bool,
    /// Why earlier draws were rejected (introspection for the seed bank).
    pub rejects: BTreeMap<&'static str, u32>,
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

/// One draw: a corner list and straights, closed exactly, or why it couldn't be.
fn draw(rng: &mut Rng, data: &CourseData) -> Result<(Vec<Corner>, Vec<Piece>), &'static str> {
    // The turn budget: 360° of left-hand turning net, plus whatever an optional right-hander takes back.
    let right = (rng.unit() < 0.4).then(|| range(rng, (40.0, 75.0)));
    let total = 360.0 + right.unwrap_or(0.0);
    // Hairpins first (one, sometimes two), then sweepers and medium corners filling what's left, scaled to fit.
    let mut corners = Vec::new();
    let hairpins = if rng.unit() < 0.35 { 2 } else { 1 };
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
            let kind = if rng.unit() < 0.5 {
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
        c.turn *= rest / drawn;
        let ((lo, hi), _) = c.kind.ranges();
        if c.turn < lo || c.turn > hi {
            return Err("corner out of range after fitting the turn budget");
        }
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
    for _ in 0..(rng.next_u64() % 3) {
        let (a, r) = CornerKind::Chicane.ranges();
        corners.push(Corner {
            kind: CornerKind::Chicane,
            turn: range(rng, a),
            radius: range(rng, r),
        });
    }
    for c in &mut corners {
        c.turn = deg(c.turn);
    }
    // A shuffled order, but never two hairpins back to back.
    for i in (1..corners.len()).rev() {
        let j = (rng.next_u64() % (i as u64 + 1)) as usize;
        corners.swap(i, j);
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
    for c in &corners {
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
        pieces.push(Piece::Straight(range(
            rng,
            (data.straight_min_m, data.straight_max_m),
        )));
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
    Ok((corners, pieces))
}

/// The conservative fallback: a plain oval inside the length band.
fn oval() -> (Vec<Corner>, Vec<Piece>) {
    let (straight, radius) = (240.0, 40.0);
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

/// Designs a course from the structure stream with the shipped generator data.
pub fn design(rng: &mut Rng) -> Course {
    design_with(rng, &crate::tuning::GeneratorData::shipped().course)
}

/// [`design`] with explicit course data (the owner tuning menu's length band and straights).
pub fn design_with(rng: &mut Rng, data: &CourseData) -> Course {
    let mut rejects: BTreeMap<&'static str, u32> = BTreeMap::new();
    for attempt in 1..=MAX_ATTEMPTS {
        let (corners, pieces) = match draw(rng, data) {
            Ok(d) => d,
            Err(why) => {
                *rejects.entry(why).or_default() += 1;
                continue;
            }
        };
        let points = sample(&pieces);
        let len = length(&points);
        let why = if len < data.length_min_m {
            Some("shorter than the length band")
        } else if len > data.length_max_m {
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
        return Course {
            corners,
            straights: straights(&pieces),
            points,
            length_m: len,
            attempts: attempt,
            fallback: false,
            rejects,
        };
    }
    let (corners, pieces) = oval();
    let points = sample(&pieces);
    Course {
        corners,
        straights: straights(&pieces),
        length_m: length(&points),
        points,
        attempts: MAX_ATTEMPTS,
        fallback: true,
        rejects,
    }
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
