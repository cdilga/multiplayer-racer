//! Route forks (R134, P1-FL16): a second line that leaves the road, crosses the land on its own and rejoins the road
//! further on. A fork is a feature; its branch is derived from the route and the params (a cubic Hermite curve between
//! two route points, leaving and arriving at set angles), so the map format doesn't change and the generator, sim,
//! renderer and validator all read the same line.
//!
//! Integer params: `fromAt`, `toAt` (the route points where the branch leaves and rejoins; the route span between them
//! is the way it skips); `side` (+1: the branch leaves to the left of travel and rejoins from the left; -1: right);
//! `splitCdeg`, `mergeCdeg` (its angle off the road at each end, centidegrees); `inMm`, `outMm` (the curve's tangent
//! lengths at each end); `widthMm`; `surface` ([`surface_code`]). The branch's ground is the heightfield (the generator
//! stamps it).
//!
//! Shape rules (docs/research/fun-tracks.md R3): it splits at 15-35° and rejoins at no more than 25°; it is at least 9 m
//! wide; it runs 150-600 m; no other part of the road comes near it.
//!
//! A **cut** (`cut` 1; P1-FL10, R134's "dirt cut-throughs") is the second family: a short chord across the inside of one
//! tight bend (a hairpin's apex), so it splits and rejoins steeply, runs 25-160 m, turns tighter and only its own ends
//! meet the road ([`cut_limits`]). Everything else is a fork's: the same line, bed, paving and checks.

use crate::model::{Feature, FeatureKind, Map, Surface};

pub mod limits {
    pub const SPLIT_DEG: (f64, f64) = (15.0, 35.0);
    pub const MERGE_DEG_MAX: f64 = 25.0;
    pub const MIN_WIDTH_MM: i64 = 9_000;
    pub const BRANCH_M: (f64, f64) = (150.0, 600.0);
    /// The branch's tightest radius, m (a car at fork speed holds it).
    pub const MIN_RADIUS_M: f64 = 15.0;
    /// The steepest grade along the branch's centreline.
    pub const MAX_GRADE: f64 = 0.25;
    /// The branch samples one point per this much of its length, m.
    pub const STEP_M: f64 = 2.5;
    /// Away from its ends, the branch keeps both half-widths and this much clear of any other part of the road, m.
    pub const ROAD_GAP_M: f64 = 4.0;
    /// "Its ends": this far along the branch from the split and from the merge, m.
    pub const END_M: f64 = 40.0;
    /// A branch keeps this far clear of a set piece's pit rectangle (plan view), m.
    pub const PIT_CLEAR_M: f64 = 3.0;
}

/// A cut's shape rules (P1-FL10): where they differ from [`limits`].
pub mod cut_limits {
    pub const SPLIT_DEG: (f64, f64) = (30.0, 80.0);
    pub const MERGE_DEG_MAX: f64 = 80.0;
    pub const BRANCH_M: (f64, f64) = (25.0, 160.0);
    /// Driven slowly on loose ground, a cut turns tighter than a fork.
    pub const MIN_RADIUS_M: f64 = 9.0;
    /// Far enough along a steep split (25 m at 45°: 18 m out) to clear the road beside it.
    pub const END_M: f64 = 25.0;
}

/// One family's shape rules.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits {
    pub split_deg: (f64, f64),
    pub merge_deg_max: f64,
    pub branch_m: (f64, f64),
    pub min_radius_m: f64,
    pub end_m: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fork {
    pub from: u32,
    pub to: u32,
    pub side: f64,
    pub split_deg: f64,
    pub merge_deg: f64,
    pub in_m: f64,
    pub out_m: f64,
    pub width_m: f64,
    pub surface: Surface,
    /// The branch winds: a sideways sine of this amplitude and wavelength, m, faded in and out away from its ends (0: no
    /// winding).
    pub wiggle_m: f64,
    pub wave_m: f64,
    /// A cut across one tight bend rather than a shortcut across a meander ([`cut_limits`]).
    pub cut: bool,
}

/// The surface a branch is paved with, as a param: 0 tarmac, 1 packed dirt, 2 gravel.
pub fn surface_code(s: Surface) -> i64 {
    match s {
        Surface::PackedDirt => 1,
        Surface::Gravel => 2,
        _ => 0,
    }
}

fn surface_of(code: i64) -> Option<Surface> {
    match code {
        0 => Some(Surface::Tarmac),
        1 => Some(Surface::PackedDirt),
        2 => Some(Surface::Gravel),
        _ => None,
    }
}

impl Fork {
    pub fn of(f: &Feature) -> Option<Self> {
        if f.kind != FeatureKind::Fork {
            return None;
        }
        let p = |key: &str| f.params.get(key).copied();
        let mm = |key: &str| p(key).map(|v| v as f64 / 1000.0);
        Some(Self {
            from: u32::try_from(p("fromAt")?).ok()?,
            to: u32::try_from(p("toAt")?).ok()?,
            side: p("side")? as f64,
            split_deg: p("splitCdeg")? as f64 / 100.0,
            merge_deg: p("mergeCdeg")? as f64 / 100.0,
            in_m: mm("inMm")?,
            out_m: mm("outMm")?,
            width_m: mm("widthMm")?,
            surface: surface_of(p("surface")?)?,
            wiggle_m: mm("wiggleMm").unwrap_or(0.0),
            wave_m: mm("waveMm").unwrap_or(0.0),
            cut: p("cut").is_some_and(|v| v == 1),
        })
    }

    /// The shape rules of this fork's family.
    pub fn limits(&self) -> Limits {
        if self.cut {
            Limits {
                split_deg: cut_limits::SPLIT_DEG,
                merge_deg_max: cut_limits::MERGE_DEG_MAX,
                branch_m: cut_limits::BRANCH_M,
                min_radius_m: cut_limits::MIN_RADIUS_M,
                end_m: cut_limits::END_M,
            }
        } else {
            Limits {
                split_deg: limits::SPLIT_DEG,
                merge_deg_max: limits::MERGE_DEG_MAX,
                branch_m: limits::BRANCH_M,
                min_radius_m: limits::MIN_RADIUS_M,
                end_m: limits::END_M,
            }
        }
    }
}

/// The route's unit tangent at point `i` (central difference), and its position, m (x, z).
fn frame(map: &Map, i: usize) -> ([f64; 2], [f64; 2]) {
    let pts = &map.route.points;
    let n = pts.len();
    let p = |k: usize| {
        let q = &pts[k % n];
        [f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0]
    };
    let (a, b) = (p(i + n - 1), p(i + 1));
    let l = libm::hypot(b[0] - a[0], b[1] - a[1]).max(1e-9);
    ([(b[0] - a[0]) / l, (b[1] - a[1]) / l], p(i))
}

/// `v` turned by `deg` toward the left of travel (left is (-z, x) of the direction, as the detour's lateral).
fn turned(v: [f64; 2], deg: f64) -> [f64; 2] {
    let (s, c) = (libm::sin(deg.to_radians()), libm::cos(deg.to_radians()));
    [v[0] * c - v[1] * s, v[0] * s + v[1] * c]
}

/// The branch's centreline (m, x and z) for explicit params: a cubic Hermite curve from route point `from`, leaving at
/// `side × split` off the road's direction there, to route point `to`, arriving at `side × merge` back onto it; sampled
/// at about [`limits::STEP_M`] (by parameter, from a first estimate of its length). A winding branch then moves each
/// point sideways by `wiggle × sin(2π (u - END_M) / wave)` at distance `u` along the curve, faded in over half a wave
/// after the first [`limits::END_M`] and out before the last.
pub fn path_of(map: &Map, d: &Fork) -> Vec<[f64; 2]> {
    let n = map.route.points.len();
    if n < 3 || d.from as usize >= n || d.to as usize >= n || d.from == d.to {
        return Vec::new();
    }
    let (ta, pa) = frame(map, d.from as usize);
    let (tb, pb) = frame(map, d.to as usize);
    let da = turned(ta, d.side * d.split_deg);
    let db = turned(tb, -d.side * d.merge_deg);
    let (m0, m1) = (
        [da[0] * d.in_m, da[1] * d.in_m],
        [db[0] * d.out_m, db[1] * d.out_m],
    );
    let at = |t: f64| {
        let (t2, t3) = (t * t, t * t * t);
        let (h00, h10, h01, h11) = (
            2.0 * t3 - 3.0 * t2 + 1.0,
            t3 - 2.0 * t2 + t,
            -2.0 * t3 + 3.0 * t2,
            t3 - t2,
        );
        [
            h00 * pa[0] + h10 * m0[0] + h01 * pb[0] + h11 * m1[0],
            h00 * pa[1] + h10 * m0[1] + h01 * pb[1] + h11 * m1[1],
        ]
    };
    // Length estimate on a fixed coarse sampling, then the real sampling.
    let coarse: Vec<[f64; 2]> = (0..=64).map(|k| at(f64::from(k) / 64.0)).collect();
    let estimate = length_m(&coarse);
    let count = (libm::ceil(estimate / limits::STEP_M) as usize).max(2);
    let curve: Vec<[f64; 2]> = (0..=count).map(|k| at(k as f64 / count as f64)).collect();
    if d.wiggle_m <= 0.0 || d.wave_m <= 0.0 {
        return curve;
    }
    let total = length_m(&curve);
    let fade = d.wave_m / 2.0;
    let smooth = |t: f64| {
        let t = t.clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    };
    let mut u = 0.0;
    (0..curve.len())
        .map(|k| {
            if k > 0 {
                u += libm::hypot(curve[k][0] - curve[k - 1][0], curve[k][1] - curve[k - 1][1]);
            }
            let (a, b) = (
                curve[k.saturating_sub(1)],
                curve[(k + 1).min(curve.len() - 1)],
            );
            let l = libm::hypot(b[0] - a[0], b[1] - a[1]).max(1e-9);
            let left = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
            let env =
                smooth((u - limits::END_M) / fade) * smooth((total - u - limits::END_M) / fade);
            let off = d.wiggle_m
                * env
                * libm::sin(2.0 * core::f64::consts::PI * (u - limits::END_M) / d.wave_m);
            [curve[k][0] + left[0] * off, curve[k][1] + left[1] * off]
        })
        .collect()
}

pub fn path(map: &Map, f: &Feature) -> Vec<[f64; 2]> {
    Fork::of(f).map_or_else(Vec::new, |d| path_of(map, &d))
}

/// The route points the fork skips (from `from` to `to`, wrapping on a closed route).
pub fn skipped(map: &Map, d: &Fork) -> Vec<usize> {
    let n = map.route.points.len();
    let (a, b) = (d.from as usize, d.to as usize);
    if n < 3 || a >= n || b >= n || a == b || (!map.route.closed && a > b) {
        return Vec::new();
    }
    (0..=(b + n - a) % n).map(|k| (a + k) % n).collect()
}

/// The length of a polyline, m.
pub fn length_m(path: &[[f64; 2]]) -> f64 {
    path.windows(2)
        .map(|w| libm::hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]))
        .sum()
}

/// How far either side of the road's centreline its bed runs, m: the generator leaves the ground there to the road, and
/// a branch riding it where it splits or merges takes the road's own ground.
pub fn road_bed_m(map: &Map) -> f64 {
    map.route
        .points
        .first()
        .map_or(0.0, |p| f64::from(p.width) / 2000.0)
        + 1.5 * f64::from(map.terrain.spacing) / 1000.0
}

/// The branch's height (m) at each of its points. Where it splits from and merges into the road it rides the road's bed
/// and takes its ground; between the last point on the bed after the split and the first before the merge it ramps
/// straight, by distance along the branch. The generator stamps the ground off the bed to it.
pub fn heights(map: &Map, d: &Fork, path: &[[f64; 2]]) -> Vec<f64> {
    let pts = &map.route.points;
    let n = pts.len();
    let bed = road_bed_m(map);
    let on_bed = |p: &[f64; 2], end: usize| {
        (0..=END_SEARCH * 2).any(|k| {
            let q = &pts[(end + n * 2 + k - END_SEARCH) % n];
            libm::hypot(
                f64::from(q.x) / 1000.0 - p[0],
                f64::from(q.z) / 1000.0 - p[1],
            ) < bed
        })
    };
    let ground = |p: &[f64; 2]| crate::jump::ground_height_m(&map.terrain, p[0], p[1]);
    let last = path.len().saturating_sub(1);
    // The last point on the bed after the split and the first on it before the merge.
    let k_in = (0..=last)
        .take_while(|&k| on_bed(&path[k], d.from as usize))
        .last()
        .unwrap_or(0);
    let k_out = (0..=last)
        .rev()
        .take_while(|&k| on_bed(&path[k], d.to as usize))
        .last()
        .unwrap_or(last)
        .max(k_in);
    let mut u = vec![0.0; path.len()];
    for k in 1..path.len() {
        u[k] = u[k - 1] + libm::hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
    }
    let (y_in, y_out) = (ground(&path[k_in]), ground(&path[k_out]));
    let span = (u[k_out] - u[k_in]).max(1e-9);
    (0..path.len())
        .map(|k| {
            if k <= k_in || k >= k_out {
                ground(&path[k])
            } else {
                y_in + (y_out - y_in) * (u[k] - u[k_in]) / span
            }
        })
        .collect()
}

/// Route points either side of a fork's end searched for the road beside the branch.
const END_SEARCH: usize = 60;

/// Problems with a fork: params, shape (R3), its paving, grade and radius on the map's ground, and other road nearby.
pub fn problems(map: &Map, f: &Feature) -> Vec<String> {
    let mut bad = Vec::new();
    let Some(d) = Fork::of(f) else {
        bad.push("missing or invalid fork params".into());
        return bad;
    };
    if d.side.abs() != 1.0 {
        bad.push(format!("side {} is not +1 or -1", d.side));
    }
    let lim = d.limits();
    let (lo, hi) = lim.split_deg;
    if !(lo..=hi).contains(&d.split_deg) {
        bad.push(format!("splits at {:.1}°, outside {lo}-{hi}°", d.split_deg));
    }
    if !(0.0..=lim.merge_deg_max).contains(&d.merge_deg) {
        bad.push(format!(
            "rejoins at {:.1}°, outside 0-{}°",
            d.merge_deg, lim.merge_deg_max
        ));
    }
    if ((d.width_m * 1000.0).round() as i64) < limits::MIN_WIDTH_MM {
        bad.push(format!("{:.1} m wide, under 9 m", d.width_m));
    }
    if !(d.in_m > 0.0 && d.out_m > 0.0) {
        bad.push("tangent lengths must be positive".into());
        return bad;
    }
    let line = path_of(map, &d);
    let skip = skipped(map, &d);
    if line.len() < 3 || skip.is_empty() {
        bad.push("span is not a valid route span".into());
        return bad;
    }
    let len = length_m(&line);
    let (b0, b1) = lim.branch_m;
    if !(b0..=b1).contains(&len) {
        bad.push(format!("branch {len:.0} m long, outside {b0}-{b1} m"));
    }
    let t = &map.terrain;
    let surface_at = |x: f64, z: f64| {
        let c = ((x * 1000.0 - f64::from(t.origin_x)) / f64::from(t.spacing)).round();
        let r = ((z * 1000.0 - f64::from(t.origin_z)) / f64::from(t.spacing)).round();
        if c < 0.0 || r < 0.0 || c >= f64::from(t.cols) || r >= f64::from(t.rows) {
            return None;
        }
        t.surfaces
            .get(r as usize * t.cols as usize + c as usize)
            .copied()
    };
    if let Some(k) = line.iter().position(|p| {
        matches!(
            surface_at(p[0], p[1]),
            Some(Surface::OffTrack | Surface::Rock) | None
        )
    }) {
        bad.push(format!("branch point {k} is not on a road surface"));
    }
    let ground = |p: &[f64; 2]| crate::jump::ground_height_m(t, p[0], p[1]);
    // Grade over two steps (5 m) and radius over four (10 m), as the terrain banks measure (centimetre heights).
    for k in 2..line.len() {
        let (a, b) = (&line[k - 2], &line[k]);
        let run = libm::hypot(b[0] - a[0], b[1] - a[1]);
        if run > 1.0 {
            let g = (ground(b) - ground(a)).abs() / run;
            if g > limits::MAX_GRADE {
                bad.push(format!("branch grade {g:.3} at point {k}"));
                break;
            }
        }
    }
    for k in 4..line.len() {
        let (a, m, b) = (&line[k - 4], &line[k - 2], &line[k]);
        let cross = (m[0] - a[0]) * (b[1] - m[1]) - (m[1] - a[1]) * (b[0] - m[0]);
        let (ab, am, mb) = (
            libm::hypot(b[0] - a[0], b[1] - a[1]),
            libm::hypot(m[0] - a[0], m[1] - a[1]),
            libm::hypot(b[0] - m[0], b[1] - m[1]),
        );
        let radius = ab * am * mb / (2.0 * cross.abs()).max(1e-12);
        if radius < lim.min_radius_m {
            bad.push(format!("branch radius {radius:.1} m at point {k}"));
            break;
        }
    }
    // No part of the branch's roadway crosses a set piece's pit (in plan view, with room to spare): a car there would
    // count as fallen in (the race's out-of-bounds pit test), wherever its wheels are.
    let pits = crate::setpiece::pits(map);
    let in_pit = |x: f64, z: f64| {
        pits.iter().any(|pit| {
            let (dx, dz) = (x - pit.origin[0], z - pit.origin[2]);
            let u = dx * pit.dir[0] + dz * pit.dir[1];
            let lat = -dx * pit.dir[1] + dz * pit.dir[0];
            u >= -limits::PIT_CLEAR_M
                && u <= pit.length_m + limits::PIT_CLEAR_M
                && lat <= pit.left_m + limits::PIT_CLEAR_M
                && lat >= -pit.right_m - limits::PIT_CLEAR_M
        })
    };
    if let Some(k) = (0..line.len()).find(|&k| {
        let (a, b) = (line[k.saturating_sub(1)], line[(k + 1).min(line.len() - 1)]);
        let l = libm::hypot(b[0] - a[0], b[1] - a[1]).max(1e-9);
        let left = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
        [-1.0, 0.0, 1.0].iter().any(|s| {
            let lat = s * d.width_m / 2.0;
            in_pit(line[k][0] + left[0] * lat, line[k][1] + left[1] * lat)
        })
    }) {
        bad.push(format!("branch point {k} crosses a set piece's pit"));
    }
    // Away from its ends, the branch keeps clear of every other part of the road (the route it skips included).
    let pts = &map.route.points;
    let mut u = 0.0;
    for (k, p) in line.iter().enumerate() {
        if k > 0 {
            u += libm::hypot(p[0] - line[k - 1][0], p[1] - line[k - 1][1]);
        }
        if u < lim.end_m || len - u < lim.end_m {
            continue;
        }
        if let Some(q) = pts.iter().find(|q| {
            let reach = f64::from(q.width) / 2000.0 + d.width_m / 2.0 + limits::ROAD_GAP_M;
            libm::hypot(
                f64::from(q.x) / 1000.0 - p[0],
                f64::from(q.z) / 1000.0 - p[1],
            ) < reach
        }) {
            bad.push(format!(
                "branch point {k} comes within reach of the road at ({:.0}, {:.0})",
                f64::from(q.x) / 1000.0,
                f64::from(q.z) / 1000.0
            ));
            break;
        }
    }
    bad
}
