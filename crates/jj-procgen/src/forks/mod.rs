//! Route forks (R134, P1-FL16; docs/research/fun-tracks.md R1-R5): the generator finds where a second line can cut
//! across the land inside a meander of the road and lays one there, as a [`jj_map::fork`] feature.
//!
//! The first family is the **shortcut across a meander**: the branch leaves the road at 15-35° toward the inside of a
//! run of corners, crosses the land on its own smooth line, and rejoins at no more than 25° (R3), 150-600 m later. It is
//! shorter than the road it skips (it gains time) and paved looser (packed dirt off bitumen, gravel off dirt), so the
//! gain needs grip and nerve. Its ground is stamped into the terrain: a bed blending from the road's height at the
//! split to its height at the merge, flat across, blended into the landscape past a shoulder, so the island between the
//! two lines stays the land it was.
//!
//! Placement is a density per kilometre of eligible road (never a count), from its own stream. A site is refused where
//! the branch would come near another part of the road, leave the grid, or fail its contract; the terrain it touched
//! is put back.

use core::f64::consts::PI;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use jj_map::fork::{self, Fork};
use jj_map::{Feature, FeatureKind, Gate, Map, Pose, Surface};

use crate::assemble::{arc_lengths, mm};
use crate::seed::Rng;

/// The generator's fork data (`forks` in `assets/profiles/generator.json`).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkData {
    /// Forks per kilometre of road eligible for one (0 turns them off).
    pub per_km: f64,
    /// The road a fork skips, m.
    pub skip_m: [f64; 2],
    /// The time a clean run down the branch saves over the road it skips, s (R5: 1-3 s). Estimated by [`drive_s`]: at
    /// `top_speed_mps` on straights, and round each bend as fast as `grip_g` holds it; the branch's loose surface keeps
    /// `branch_pace` of both. The fork fixtures measure it with the autopilot.
    pub gain_s: [f64; 2],
    pub top_speed_mps: f64,
    pub grip_g: f64,
    pub accel_mps2: f64,
    pub brake_mps2: f64,
    pub branch_pace: f64,
    /// A shortcut that would save more winds (a sideways sine of this wavelength, m) until it saves the middle of the band.
    pub wave_m: [f64; 2],
    pub width_m: [f64; 2],
    pub split_deg: [f64; 2],
    pub merge_deg: [f64; 2],
    /// The curve's tangent length at each end as a share of the chord between them.
    pub tension: [f64; 2],
    /// Flat ground beside the branch's bed, and the distance over which its bed blends into the landscape, m.
    pub shoulder_m: f64,
    pub fade_m: f64,
}

impl ForkData {
    pub fn problems(&self) -> Vec<String> {
        let mut bad = Vec::new();
        let range = |n: &str, [lo, hi]: [f64; 2], min: f64, max: f64, bad: &mut Vec<String>| {
            if !(lo >= min && hi >= lo && hi <= max) {
                bad.push(format!("forks.{n}: needs {min} <= lo <= hi <= {max}"));
            }
        };
        if !(self.per_km >= 0.0 && self.per_km.is_finite()) {
            bad.push("forks.perKm: must not be negative".into());
        }
        range("skipM", self.skip_m, 100.0, 2_000.0, &mut bad);
        range("gainS", self.gain_s, -5.0, 30.0, &mut bad);
        if !(self.top_speed_mps > 0.0
            && self.grip_g > 0.0
            && self.accel_mps2 > 0.0
            && self.brake_mps2 > 0.0
            && self.branch_pace > 0.0
            && self.branch_pace <= 1.5)
        {
            bad.push(
                "forks.topSpeedMps, gripG, accelMps2, brakeMps2 and branchPace: must be positive, pace at most 1.5"
                    .into(),
            );
        }
        range("widthM", self.width_m, 9.0, 40.0, &mut bad);
        range("waveM", self.wave_m, 40.0, 400.0, &mut bad);
        let (s0, s1) = fork::limits::SPLIT_DEG;
        range("splitDeg", self.split_deg, s0, s1, &mut bad);
        range(
            "mergeDeg",
            self.merge_deg,
            1.0,
            fork::limits::MERGE_DEG_MAX,
            &mut bad,
        );
        range("tension", self.tension, 0.05, 2.0, &mut bad);
        for (n, v) in [("shoulderM", self.shoulder_m), ("fadeM", self.fade_m)] {
            if !(v > 0.0 && v.is_finite()) {
                bad.push(format!("forks.{n}: must be positive"));
            }
        }
        bad
    }
}

/// A placed fork's skipped route span (arc length, m), for the features that keep clear of it.
#[derive(Clone, Copy, Debug)]
pub struct Placed {
    pub from_s: f64,
    pub to_s: f64,
}

/// A winding branch's bends stay this much wider than the contract's tightest, m (the curve's own bend adds to them).
const WIGGLE_RADIUS_SPARE_M: f64 = 8.0;

/// How far a branch's edge keeps from a set piece's detour centreline, m.
const DETOUR_CLEAR_M: f64 = 10.0;

/// Room the small features keep from a fork's span, m.
pub const CLEAR_M: f64 = 30.0;
/// Candidate split and merge points are tried every this many route points.
const STRIDE: usize = 4;
/// Forks keep this much road between them, m.
const BETWEEN_M: f64 = 120.0;

/// Route points bucketed on a coarse grid, for "is any road near here".
struct RoadGrid {
    cell: f64,
    buckets: std::collections::BTreeMap<(i64, i64), Vec<usize>>,
    pts: Vec<[f64; 2]>,
}

impl RoadGrid {
    fn new(pts: &[[f64; 2]], cell: f64) -> Self {
        let mut buckets: std::collections::BTreeMap<(i64, i64), Vec<usize>> = Default::default();
        for (i, p) in pts.iter().enumerate() {
            let key = (
                libm::floor(p[0] / cell) as i64,
                libm::floor(p[1] / cell) as i64,
            );
            buckets.entry(key).or_default().push(i);
        }
        Self {
            cell,
            buckets,
            pts: pts.to_vec(),
        }
    }

    /// Whether any route point other than those `skip` accepts lies within `reach` of `p`.
    fn near(&self, p: [f64; 2], reach: f64, skip: &dyn Fn(usize) -> bool) -> bool {
        let (cx, cz) = (
            libm::floor(p[0] / self.cell) as i64,
            libm::floor(p[1] / self.cell) as i64,
        );
        let span = libm::ceil(reach / self.cell) as i64;
        for gx in cx - span..=cx + span {
            for gz in cz - span..=cz + span {
                if let Some(ix) = self.buckets.get(&(gx, gz)) {
                    for &i in ix {
                        let q = self.pts[i];
                        if !skip(i) && libm::hypot(q[0] - p[0], q[1] - p[1]) < reach {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }
}

/// Places forks whose skipped span lies in `ranges` (arc-length ranges free of set pieces, crossings and transitions)
/// at `data.per_km` of their length, then moves the gates out of each skipped span. Returns the spans placed and why candidates were turned down (R90).
pub fn place<T: Copy>(
    map: &mut Map,
    rng: &mut Rng,
    ranges: &[(f64, f64, T)],
    data: &ForkData,
) -> (Vec<Placed>, BTreeMap<String, u32>) {
    let n = map.route.points.len();
    if data.per_km <= 0.0 || n < 16 {
        return Default::default();
    }
    let xz: Vec<[f64; 2]> = map
        .route
        .points
        .iter()
        .map(|p| [f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0])
        .collect();
    let (s, _) = arc_lengths(&xz.iter().map(|p| (p[0], p[1])).collect::<Vec<_>>());
    let eligible: f64 = ranges.iter().map(|(a, b, _)| (b - a).max(0.0)).sum();
    let wanted = libm::round(data.per_km * eligible / 1000.0) as usize;
    if wanted == 0 {
        return Default::default();
    }
    let half = f64::from(map.route.points[0].width) / 2000.0;
    let grid = RoadGrid::new(&xz, 20.0);
    let left = |t: [f64; 2]| [-t[1], t[0]];
    let tangent = |i: usize| {
        let (a, b) = (xz[(i + n - 1) % n], xz[(i + 1) % n]);
        let l = libm::hypot(b[0] - a[0], b[1] - a[1]).max(1e-9);
        [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
    };
    // Every split point (seeded order), each with its merge points by skipped length.
    let mut starts: Vec<(f64, usize)> = (0..n).step_by(STRIDE).map(|i| (rng.unit(), i)).collect();
    starts.sort_by(|a, b| a.0.total_cmp(&b.0));
    let width = rng.range(data.width_m[0], data.width_m[1]);
    let split = rng.range(data.split_deg[0], data.split_deg[1]);
    let merge = rng.range(data.merge_deg[0], data.merge_deg[1]);
    let tension = rng.range(data.tension[0], data.tension[1]);
    let wave = rng.range(data.wave_m[0], data.wave_m[1]);
    let mut placed: Vec<Placed> = Vec::new();
    let mut rejects: BTreeMap<String, u32> = BTreeMap::new();
    let mut reject = |why: &str| *rejects.entry(why.to_string()).or_default() += 1;
    for (_, a) in starts {
        if placed.len() >= wanted {
            break;
        }
        let s_from = s[a];
        let mut best: Option<(f64, Fork, Vec<[f64; 2]>, f64)> = None;
        let mut k = STRIDE;
        while k < n {
            let b = a + k;
            k += STRIDE;
            if b >= n {
                // A fork never spans the lap's seam (the start corridor lives there).
                break;
            }
            let skipped = s[b] - s[a];
            if skipped < data.skip_m[0] {
                continue;
            }
            if skipped > data.skip_m[1] {
                break;
            }
            let s_to = s[b];
            if !ranges
                .iter()
                .any(|&(lo, hi, _)| s_from - CLEAR_M >= lo && s_to + CLEAR_M <= hi)
                || placed
                    .iter()
                    .any(|p| s_to + BETWEEN_M > p.from_s && s_from < p.to_s + BETWEEN_M)
            {
                continue;
            }
            // The finish line stays on the one road every car drives.
            if map
                .route
                .gates
                .iter()
                .any(|g| g.finish && (a..=b).contains(&(g.at as usize)))
            {
                reject("finish");
                continue;
            }
            let (pa, pb) = (xz[a], xz[b]);
            let chord = [pb[0] - pa[0], pb[1] - pa[1]];
            let chord_len = libm::hypot(chord[0], chord[1]);
            let (la, lb) = (left(tangent(a)), left(tangent(b)));
            let side_a = (chord[0] * la[0] + chord[1] * la[1]).signum();
            let side_b = (-chord[0] * lb[0] - chord[1] * lb[1]).signum();
            if side_a != side_b || chord_len < fork::limits::BRANCH_M.0 * 0.6 {
                reject(if side_a != side_b { "side" } else { "chord" });
                continue;
            }
            let mut d = Fork {
                from: a as u32,
                to: b as u32,
                side: side_a,
                split_deg: split,
                merge_deg: merge,
                in_m: tension * chord_len,
                out_m: tension * chord_len,
                width_m: width,
                surface: Surface::PackedDirt,
                wiggle_m: 0.0,
                wave_m: wave,
            };
            let road: Vec<[f64; 2]> = xz[a..=b].to_vec();
            let road_s = drive_s(&road, data, 1.0);
            let gain_of = |d: &Fork| {
                let path = fork::path_of(map, d);
                let gain = road_s - drive_s(&path, data, data.branch_pace);
                (path, gain)
            };
            let (mut path, mut gain) = gain_of(&d);
            let mid = (data.gain_s[0] + data.gain_s[1]) / 2.0;
            if gain > data.gain_s[1] {
                // Too big a cut: wind the branch until it saves the middle of the band, no tighter than its bends allow.
                let most = wave * wave
                    / (4.0 * PI * PI * (fork::limits::MIN_RADIUS_M + WIGGLE_RADIUS_SPARE_M));
                let (mut lo, mut hi) = (0.0, most);
                if gain_of(&Fork {
                    wiggle_m: most,
                    ..d
                })
                .1 > data.gain_s[1]
                {
                    reject("gain>hi");
                    continue;
                }
                for _ in 0..12 {
                    let m = (lo + hi) / 2.0;
                    if gain_of(&Fork { wiggle_m: m, ..d }).1 > mid {
                        lo = m;
                    } else {
                        hi = m;
                    }
                }
                // Millimetres, as the feature keeps it.
                d.wiggle_m = libm::round(hi * 1000.0) / 1000.0;
                (path, gain) = gain_of(&d);
            }
            let len = fork::length_m(&path);
            let why = if !(fork::limits::BRANCH_M.0..=fork::limits::BRANCH_M.1).contains(&len) {
                Some("len")
            } else if !(data.gain_s[0]..=data.gain_s[1]).contains(&gain) {
                Some("gain<lo")
            } else if !holds_radius(&path) {
                Some("radius")
            } else if !clear_of_road(&grid, &path, len, half, width, a, b, n) {
                Some("clear")
            } else {
                None
            };
            if let Some(why) = why {
                reject(why);
                continue;
            }
            // The branch whose saving sits nearest the middle of the band from this split.
            let off = (gain - mid).abs();
            if best.as_ref().is_none_or(|(o, ..)| off < *o) {
                best = Some((off, d, path, s_to));
            }
        }
        let Some((_, mut d, path, s_to)) = best else {
            continue;
        };
        d.surface = match map.route.points[a].surface {
            Surface::Tarmac => Surface::PackedDirt,
            _ => Surface::Gravel,
        };
        if !on_grid(map, &path, &d, data) {
            continue;
        }
        let feature = feature_of(map, &d);
        // The set pieces' landmarks are domes in the terrain: whether the lap's set pieces are seen from afar before
        // this stamp (it may cut a dome or raise ground in the line of sight), so the stamp can't spoil them.
        let sighted = crate::setpieces::check_minimum(map).is_empty();
        let before = (map.terrain.heights.clone(), map.terrain.surfaces.clone());
        stamp(map, &xz, &d, &path, data);
        // The new fork, every one before it and every set piece (whose ground this stamp may have touched) hold their
        // contracts, and the branch keeps clear of the set pieces' detours.
        let probe = Map {
            features: map
                .features
                .iter()
                .filter(|f| matches!(f.kind, FeatureKind::Fork | FeatureKind::SetPiece))
                .chain([&feature])
                .cloned()
                .collect(),
            ..map.clone()
        };
        let detours: Vec<[f64; 2]> = probe
            .features
            .iter()
            .filter(|f| f.kind == FeatureKind::SetPiece)
            .flat_map(|f| jj_map::setpiece::detour_path(&probe, f))
            .collect();
        let crosses_detour = path.iter().any(|p| {
            detours
                .iter()
                .any(|q| libm::hypot(p[0] - q[0], p[1] - q[1]) < width / 2.0 + DETOUR_CLEAR_M)
        });
        if crosses_detour
            || sighted && !crate::setpieces::check_minimum(&probe).is_empty()
            || probe.features.iter().any(|f| match f.kind {
                FeatureKind::Fork => !fork::problems(&probe, f).is_empty(),
                _ => !jj_map::setpiece::problems(&probe, f).is_empty(),
            })
        {
            (map.terrain.heights, map.terrain.surfaces) = before;
            reject("ground");
            continue;
        }
        map.features.push(feature);
        placed.push(Placed {
            from_s: s_from,
            to_s: s_to,
        });
    }
    if !placed.is_empty() {
        move_gates(map);
        regrounded(map);
    }
    (placed, rejects)
}

fn feature_of(map: &Map, d: &Fork) -> Feature {
    let q = &map.route.points[d.from as usize];
    Feature {
        kind: FeatureKind::Fork,
        pose: Pose {
            x: q.x,
            y: q.y,
            z: q.z,
            yaw: 0,
        },
        params: [
            ("fromAt", i64::from(d.from)),
            ("toAt", i64::from(d.to)),
            ("side", d.side as i64),
            ("splitCdeg", libm::round(d.split_deg * 100.0) as i64),
            ("mergeCdeg", libm::round(d.merge_deg * 100.0) as i64),
            ("inMm", i64::from(mm(d.in_m))),
            ("outMm", i64::from(mm(d.out_m))),
            ("widthMm", i64::from(mm(d.width_m))),
            ("surface", fork::surface_code(d.surface)),
            ("wiggleMm", i64::from(mm(d.wiggle_m))),
            ("waveMm", i64::from(mm(d.wave_m))),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect(),
    }
}

/// Roughly how long a line takes to drive, s, as the autopilot drives it: each point's speed limit is the top speed
/// or the bend's grip-limited speed (radius over the points ~5 m either side), whichever is lower; a forward pass
/// accelerates out of bends at `accel_mps2` and a backward pass brakes into them at `brake_mps2`; all of it times `pace`.
pub fn drive_s(line: &[[f64; 2]], data: &ForkData, pace: f64) -> f64 {
    const G: f64 = 9.81;
    let n = line.len();
    if n < 2 {
        return 0.0;
    }
    let ds: Vec<f64> = (1..n)
        .map(|k| libm::hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]))
        .collect();
    let mut v: Vec<f64> = (0..n)
        .map(|k| {
            let p = line[k];
            let back = (0..k)
                .rev()
                .find(|&i| libm::hypot(line[i][0] - p[0], line[i][1] - p[1]) >= 5.0);
            let ahead = (k..n).find(|&i| libm::hypot(line[i][0] - p[0], line[i][1] - p[1]) >= 5.0);
            let bend = match (back, ahead) {
                (Some(i), Some(j)) => {
                    let (a, b) = (line[i], line[j]);
                    let cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
                    let r = libm::hypot(b[0] - a[0], b[1] - a[1])
                        * libm::hypot(p[0] - a[0], p[1] - a[1])
                        * libm::hypot(b[0] - p[0], b[1] - p[1])
                        / (2.0 * cross.abs()).max(1e-12);
                    libm::sqrt(data.grip_g * G * r)
                }
                _ => f64::INFINITY,
            };
            data.top_speed_mps.min(bend) * pace
        })
        .collect();
    for k in 1..n {
        v[k] = v[k].min(libm::sqrt(
            v[k - 1] * v[k - 1] + 2.0 * data.accel_mps2 * ds[k - 1],
        ));
    }
    for k in (0..n - 1).rev() {
        v[k] = v[k].min(libm::sqrt(
            v[k + 1] * v[k + 1] + 2.0 * data.brake_mps2 * ds[k],
        ));
    }
    (1..n)
        .map(|k| 2.0 * ds[k - 1] / (v[k - 1] + v[k]).max(1e-6))
        .sum()
}

/// The branch's tightest radius (over 10 m) stays above the contract's minimum.
fn holds_radius(path: &[[f64; 2]]) -> bool {
    (4..path.len()).all(|k| {
        let (a, m, b) = (path[k - 4], path[k - 2], path[k]);
        let cross = (m[0] - a[0]) * (b[1] - m[1]) - (m[1] - a[1]) * (b[0] - m[0]);
        let r = libm::hypot(b[0] - a[0], b[1] - a[1])
            * libm::hypot(m[0] - a[0], m[1] - a[1])
            * libm::hypot(b[0] - m[0], b[1] - m[1])
            / (2.0 * cross.abs()).max(1e-12);
        r >= fork::limits::MIN_RADIUS_M + 3.0
    })
}

/// Away from its ends, no part of the road comes within both half-widths and the gap of the branch.
#[allow(clippy::too_many_arguments)]
fn clear_of_road(
    grid: &RoadGrid,
    path: &[[f64; 2]],
    len: f64,
    half: f64,
    width: f64,
    a: usize,
    b: usize,
    n: usize,
) -> bool {
    let reach = half + width / 2.0 + fork::limits::ROAD_GAP_M;
    // The route near the split and the merge is where the branch meets it by design.
    let guard = 16;
    let near_end = |i: usize| {
        let d = |e: usize| {
            let k = (i + n - e) % n;
            k.min(n - k)
        };
        d(a) <= guard || d(b) <= guard
    };
    let mut u = 0.0;
    for (k, p) in path.iter().enumerate() {
        if k > 0 {
            u += libm::hypot(p[0] - path[k - 1][0], p[1] - path[k - 1][1]);
        }
        if u < fork::limits::END_M || len - u < fork::limits::END_M {
            continue;
        }
        if grid.near(*p, reach + 1.0, &near_end) {
            return false;
        }
    }
    true
}

/// The branch and its blend stay inside the terrain grid.
fn on_grid(map: &Map, path: &[[f64; 2]], d: &Fork, data: &ForkData) -> bool {
    let t = &map.terrain;
    let reach = d.width_m / 2.0 + data.shoulder_m + data.fade_m;
    let (x0, z0) = (
        f64::from(t.origin_x) / 1000.0,
        f64::from(t.origin_z) / 1000.0,
    );
    let sp = f64::from(t.spacing) / 1000.0;
    let (x1, z1) = (
        x0 + f64::from(t.cols - 1) * sp,
        z0 + f64::from(t.rows - 1) * sp,
    );
    path.iter()
        .all(|p| p[0] - reach > x0 && p[0] + reach < x1 && p[1] - reach > z0 && p[1] + reach < z1)
}

/// Stamps the branch into the ground: a bed at [`fork::heights`] along it, level across, flat for the shoulder, blended
/// into the land over the fade; its surface painted on the cells within its half-width that were off-road. Cells of the
/// road's own bed are left alone.
fn stamp(map: &mut Map, xz: &[[f64; 2]], d: &Fork, path: &[[f64; 2]], data: &ForkData) {
    let ys = fork::heights(map, d, path);
    let t = &map.terrain;
    let (cols, rows) = (t.cols as usize, t.rows as usize);
    let sp = f64::from(t.spacing) / 1000.0;
    let (ox, oz) = (
        f64::from(t.origin_x) / 1000.0,
        f64::from(t.origin_z) / 1000.0,
    );
    let bed_road = fork::road_bed_m(map);
    let half = d.width_m / 2.0;
    let reach = half + data.shoulder_m + data.fade_m;
    let grid = RoadGrid::new(xz, 20.0);
    let mut best = vec![(f64::INFINITY, 0.0f64); cols * rows];
    for k in 0..path.len() - 1 {
        let (a, b) = (path[k], path[k + 1]);
        let (ya, yb) = (ys[k], ys[k + 1]);
        let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
        let l2 = (dx * dx + dz * dz).max(1e-12);
        let c0 = libm::floor((a[0].min(b[0]) - reach - ox) / sp).max(0.0) as usize;
        let c1 = (libm::ceil((a[0].max(b[0]) + reach - ox) / sp).max(0.0) as usize).min(cols - 1);
        let r0 = libm::floor((a[1].min(b[1]) - reach - oz) / sp).max(0.0) as usize;
        let r1 = (libm::ceil((a[1].max(b[1]) + reach - oz) / sp).max(0.0) as usize).min(rows - 1);
        for r in r0..=r1 {
            for c in c0..=c1 {
                let (x, z) = (ox + c as f64 * sp, oz + r as f64 * sp);
                let u = (((x - a[0]) * dx + (z - a[1]) * dz) / l2).clamp(0.0, 1.0);
                let dist = libm::hypot(x - a[0] - u * dx, z - a[1] - u * dz);
                let at = r * cols + c;
                if dist < best[at].0 {
                    best[at] = (dist, ya + (yb - ya) * u);
                }
            }
        }
    }
    let fade = |v: f64| {
        let v = v.clamp(0.0, 1.0);
        v * v * (3.0 - 2.0 * v)
    };
    let t = &mut map.terrain;
    for (at, &(dist, bed)) in best.iter().enumerate() {
        if dist > reach {
            continue;
        }
        let (x, z) = (ox + (at % cols) as f64 * sp, oz + (at / cols) as f64 * sp);
        // The branch is paved wherever it runs off the road, even beside it where it splits and merges.
        if dist <= half && matches!(t.surfaces[at], Surface::OffTrack | Surface::Rock) {
            t.surfaces[at] = d.surface;
        }
        // The road's own bed keeps its heights.
        if grid.near([x, z], bed_road, &|_| false) {
            continue;
        }
        let old = f64::from(t.heights[at]) / 100.0;
        let k = fade((dist - half - data.shoulder_m) / data.fade_m);
        t.heights[at] = libm::round((bed + (old - bed) * k) * 100.0) as i16;
    }
}

fn within(n: usize, a: usize, b: usize, i: usize) -> bool {
    let (a, b) = (a % n, b % n);
    if a <= b {
        i >= a && i <= b
    } else {
        i >= a || i <= b
    }
}

/// Every gate strictly inside a fork's skipped span leaves; gates stand at each span's ends, where both lines meet.
fn move_gates(map: &mut Map) {
    let n = map.route.points.len();
    let spans: Vec<(usize, usize)> = map
        .features
        .iter()
        .filter_map(Fork::of)
        .map(|d| (d.from as usize, d.to as usize))
        .collect();
    let mut gates: Vec<Gate> = map
        .route
        .gates
        .iter()
        .copied()
        .filter(|g| {
            g.finish
                || !spans.iter().any(|&(a, b)| {
                    g.at as usize != a && g.at as usize != b && within(n, a, b, g.at as usize)
                })
        })
        .collect();
    for &(a, b) in &spans {
        for at in [a, b] {
            if gates.iter().all(|g| g.at as usize != at) {
                gates.push(Gate {
                    at: at as u32,
                    finish: false,
                });
            }
        }
    }
    gates.sort();
    map.route.gates = gates;
}

/// Everything already placed stands on the ground the forks reshaped.
fn regrounded(map: &mut Map) {
    let terrain = map.terrain.clone();
    for pose in map
        .dressing
        .iter_mut()
        .map(|d| &mut d.pose)
        .chain(map.props.iter_mut().map(|q| &mut q.pose))
    {
        let y = crate::terrain::ground_height_m(
            &terrain,
            f64::from(pose.x) / 1000.0,
            f64::from(pose.z) / 1000.0,
        );
        pose.y = libm::round(y * 1000.0) as i32;
    }
}

/// `ranges` with every fork's span (and [`CLEAR_M`] either side) cut out.
pub fn clear_of<T: Copy>(ranges: &[(f64, f64, T)], placed: &[Placed]) -> Vec<(f64, f64, T)> {
    let mut out = ranges.to_vec();
    for p in placed {
        let (lo, hi) = (p.from_s - CLEAR_M, p.to_s + CLEAR_M);
        out = out
            .into_iter()
            .flat_map(|(a, b, t)| {
                let mut keep = Vec::new();
                if a < lo {
                    keep.push((a, b.min(lo), t));
                }
                if b > hi {
                    keep.push((a.max(hi), b, t));
                }
                keep
            })
            .filter(|(a, b, _)| b > a)
            .collect();
    }
    out
}

/// Dressing (but not wayfinding) and props whose footprint touches a branch (its half-width and a margin) leave: a
/// branch is road.
/// Whether `p` (m) is within `reach` of a fork's branch edge: where the road's edge furniture (rails, chevrons) would
/// stand on the branch or across its mouth, so the road keeps none (the corner lint treats it as a junction).
pub fn in_mouth(map: &Map, p: [f64; 2], reach: f64) -> bool {
    map.features.iter().filter_map(Fork::of).any(|d| {
        fork::path_of(map, &d)
            .iter()
            .any(|q| libm::hypot(q[0] - p[0], q[1] - p[1]) < d.width_m / 2.0 + reach)
    })
}

/// Whether `p` (m) stands on a fork branch's graded verge: its roadway, shoulder and the fade into the landscape, with
/// a couple of metres to spare. Anything that regrades ground (a roof stunt's lot) keeps off it.
pub fn in_verge(map: &Map, p: [f64; 2]) -> bool {
    let d = &crate::tuning::GeneratorData::shipped().forks;
    in_mouth(map, p, d.shoulder_m + d.fade_m + 2.0)
}

pub fn clear_corridors(map: &mut Map, registry: &jj_map::Registry) {
    let branches: Vec<(Vec<[f64; 2]>, f64)> = map
        .features
        .iter()
        .filter_map(|f| Fork::of(f).map(|d| (fork::path_of(map, &d), d.width_m / 2.0 + 1.5)))
        .collect();
    if branches.is_empty() {
        return;
    }
    let touches = |x: f64, z: f64, radius: f64| {
        branches.iter().any(|(path, reach)| {
            path.windows(2).any(|w| {
                let (a, b) = (w[0], w[1]);
                let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
                let u = (((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz).max(1e-12))
                    .clamp(0.0, 1.0);
                libm::hypot(x - a[0] - u * dx, z - a[1] - u * dz) < reach + radius
            })
        })
    };
    // Footprints are millimetres; a piece without a collider still keeps a metre clear.
    let radius_of = |piece: &str, params: &std::collections::BTreeMap<String, i64>| match registry
        .get(piece)
        .and_then(|e| e.footprint(params))
    {
        Some(jj_map::kit::Footprint::Rect { x, z, .. }) => libm::hypot(x, z) / 2000.0,
        Some(jj_map::kit::Footprint::Circle { radius, .. }) => radius / 1000.0,
        None => 1.0,
    };
    // Wayfinding only where it would stand on the branch or across its mouth ([`in_mouth`], which the corner lint
    // shares); everything else touching the branch's corridor goes.
    let mouths = map.clone();
    map.dressing.retain(|d| {
        let (x, z, r) = (
            f64::from(d.pose.x) / 1000.0,
            f64::from(d.pose.z) / 1000.0,
            radius_of(&d.kit_piece, &d.params),
        );
        if d.kit_piece.starts_with("wayfinding/") {
            !in_mouth(&mouths, [x, z], r + 1.5)
        } else {
            !touches(x, z, r)
        }
    });
    map.props.retain(|p| {
        !touches(
            f64::from(p.pose.x) / 1000.0,
            f64::from(p.pose.z) / 1000.0,
            radius_of(&p.kit_piece, &p.params),
        )
    });
}
