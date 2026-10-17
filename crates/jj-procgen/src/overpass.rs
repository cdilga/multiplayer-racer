//! Overpass leaps (R124, br-xlvx.5): at a figure-eight's crossing the upper road jumps the lower one instead of
//! bridging it. The road climbs an embankment to a take-off well above the lower road, levels, runs up a full-width
//! kicker, and the gap opens over the lower road (in its cutting); the far rim stands a little lower and the landing
//! runs down from it, then the road eases back to its own height. A car too slow to clear the gap falls (onto the lower
//! road or the cutting) and respawns: the piece's pit belongs to the upper road only, so the cars driving the lower road
//! beneath never count as fallen in (jj-map `setpiece`, `PieceKind::OverpassLeap`).
//!
//! The speed band is found against the ground as sculpted, with the same ballistic flight the validator checks
//! (`jj_map::setpiece::touchdown`), so the piece is landable by construction or it isn't placed (the bridge stays).
//! Data: assets/profiles/overpass.json (docs/research/fun-tracks.md R10-R17).

use std::sync::OnceLock;

use jj_map::model::{Feature, FeatureKind, Map, Pose, Span};
use jj_map::setpiece::{self, GapLeap, PieceKind, landing_lift};
use serde::Deserialize;

use crate::assemble::mm;
use crate::terrain::ground_height_m;

const SHIPPED: &str = include_str!("../../../assets/profiles/overpass.json");

/// assets/profiles/overpass.json.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverpassData {
    #[serde(rename = "//", default)]
    pub note: String,
    /// The generator tries a leap at a crossing this square or squarer (degrees between the two roads); shallower ones
    /// keep their bridge (br-xlvx.10.3).
    pub min_crossing_deg: f64,
    pub take_off_above_lower_m: f64,
    pub level_m: f64,
    pub ramp_m: f64,
    pub lip_m: f64,
    pub blend_m: f64,
    pub face_slope: f64,
    pub bed_clear_m: f64,
    pub rim_drop_m: f64,
    pub min_landing_slope: f64,
    pub max_landing_slope: f64,
    pub band_width: f64,
    pub max_band_floor_mps: f64,
    pub runout_m: f64,
    pub max_grade: f64,
    /// The approach's climb to the take-off (rise per metre), steeper than `maxGrade` so a leap fits a loop-over's exit
    /// straight (br-xlvx.10.3; the bridges' decks climb at up to 20 %). Absent: `maxGrade`.
    #[serde(default)]
    pub climb_grade: Option<f64>,
    pub shoulder_m: f64,
    pub side_slope: f64,
}

/// The shipped data, parsed once.
pub fn shipped() -> &'static OverpassData {
    static DATA: OnceLock<OverpassData> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(SHIPPED).expect("assets/profiles/overpass.json parses")
    })
}

/// Why a crossing kept its bridge.
#[derive(Clone, Debug, PartialEq)]
pub enum Refused {
    /// The upper road isn't straight enough around the crossing for the approach, flight and landing.
    Bent,
    /// The lower road doesn't pass under the upper one's straight.
    NoCrossing,
    /// The slowest landable speed (m/s; infinite when none is) is above the band floor allowed, for this gap (m).
    TooFast { gap_m: f64, floor_mps: f64 },
    /// The sculpted piece breaks its contract (the reasons, from jj-map).
    Contract(Vec<String>),
}

/// The crossing's frame on the upper road: the point over the lower road, the flight's direction and left, and the
/// route span the piece may use.
struct Frame {
    o: [f64; 2],
    t: [f64; 2],
    l: [f64; 2],
}

impl Frame {
    fn uv(&self, x: f64, z: f64) -> (f64, f64) {
        let (dx, dz) = (x - self.o[0], z - self.o[1]);
        (
            dx * self.t[0] + dz * self.t[1],
            dx * self.l[0] + dz * self.l[1],
        )
    }
    fn at(&self, u: f64) -> [f64; 2] {
        [self.o[0] + self.t[0] * u, self.o[1] + self.t[1] * u]
    }
}

fn xz(map: &Map, i: usize) -> [f64; 2] {
    let p = &map.route.points[i];
    [f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0]
}

/// The road's profile along the upper road (u from the crossing point): the ground the road is laid on, or `None` in
/// the gap (cut down only, to the faces).
struct Profile {
    start: f64,
    level_from: f64,
    lip: f64,
    rim: f64,
    land_end: f64,
    stop: f64,
    take_off: f64,
    rim_y: f64,
    slope: f64,
    face: f64,
    /// The gap's floor: the lower road's height (the cutting under the flight is dug down to it).
    floor: f64,
    /// The take-off and the rim run on flat this far into the gap before their faces drop (a terrain cell: the
    /// heightfield's bilinear ground under the lip and the rim stays at their height).
    pad: f64,
    natural: Vec<(f64, f64)>,
}

impl Profile {
    /// The road's own height at u before the piece (its route points' heights, interpolated).
    fn natural(&self, u: f64) -> f64 {
        let n = &self.natural;
        let k = n.partition_point(|&(v, _)| v < u);
        if k == 0 {
            return n[0].1;
        }
        if k >= n.len() {
            return n[n.len() - 1].1;
        }
        let ((u0, y0), (u1, y1)) = (n[k - 1], n[k]);
        y0 + (y1 - y0) * (u - u0) / (u1 - u0).max(1e-9)
    }

    fn smooth(t: f64) -> f64 {
        let t = t.clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }

    /// The ground height the road is laid on at u, or `None` in the gap.
    fn road(&self, u: f64) -> Option<f64> {
        if u <= self.level_from {
            let t = (u - self.start) / (self.level_from - self.start);
            let n = self.natural(u);
            return Some(n + (self.take_off - n) * Self::smooth(t));
        }
        // The take-off and the rim are laid (filled as well as cut) a pad into the gap, so the ground under the lip
        // and the rim stands at their height.
        if u <= self.lip + self.pad {
            return Some(self.take_off);
        }
        if u < self.rim - self.pad {
            return None;
        }
        if u < self.rim {
            return Some(self.rim_y);
        }
        let land = self.rim_y - self.slope * (u - self.rim);
        if u <= self.land_end {
            return Some(land);
        }
        let end_y = self.rim_y - self.slope * (self.land_end - self.rim);
        let t = (u - self.land_end) / (self.stop - self.land_end);
        let n = self.natural(u);
        Some(end_y + (n - end_y) * Self::smooth(t))
    }

    /// The highest the ground may stand in the gap at u: the abutment faces falling from the lip and the rim, down to
    /// the lower road's height between them (the pit a short car falls into is the lower road's cutting, dug wide).
    fn gap_cap(&self, u: f64) -> f64 {
        (self.take_off - (u - self.lip - self.pad).max(0.0) * self.face)
            .max(self.rim_y - (self.rim - self.pad - u).max(0.0) * self.face)
            .max(self.floor)
    }
}

/// Every bridge whose roads cross at `minCrossingDeg` or squarer becomes an overpass leap where [`place`] lays one, and
/// stays a bridge where it refuses (br-xlvx.10.3). Shallower crossings keep their bridges. Returns how many leapt.
pub fn leap_crossings(map: &mut Map, data: &OverpassData) -> usize {
    let mut leapt = 0;
    let mut k = 0;
    while k < map.features.len() {
        let Some(b) = jj_map::bridge::BridgeDesign::of(&map.features[k]) else {
            k += 1;
            continue;
        };
        let span = |s: jj_map::model::Span| (s.from as usize, s.to as usize);
        let (upper, lower) = (span(b.upper), span(b.lower));
        if crossing_deg(map, upper, lower) < data.min_crossing_deg {
            k += 1;
            continue;
        }
        let bridge = map.features.remove(k);
        // The deck's heights go with it: the upper road lies on its ground again before the leap reshapes it (a ramp
        // the leap's run-in doesn't reach would otherwise float over the ground).
        let route = map.route.clone();
        let n = map.route.points.len();
        for i in (0..=(upper.1 + n - upper.0) % n).map(|k| (upper.0 + k) % n) {
            let p = xz(map, i);
            map.route.points[i].y = mm(ground_height_m(&map.terrain, p[0], p[1]));
        }
        match place(map, upper, lower, data) {
            Ok(f) => {
                map.features.insert(k, f);
                leapt += 1;
            }
            Err(_) => {
                map.route = route;
                map.features.insert(k, bridge);
            }
        }
        k += 1;
    }
    leapt
}

/// The angle between the two roads at their spans' middles, degrees (0..=90).
fn crossing_deg(map: &Map, upper: (usize, usize), lower: (usize, usize)) -> f64 {
    let n = map.route.points.len();
    let heading = |(a, b): (usize, usize)| {
        let mid = (a + ((b + n - a) % n) / 2) % n;
        let (p, q) = (xz(map, (mid + n - 2) % n), xz(map, (mid + 2) % n));
        libm::atan2(q[1] - p[1], q[0] - p[0])
    };
    let d = libm::fabs(heading(upper) - heading(lower)) % core::f64::consts::PI;
    let d = if d > core::f64::consts::FRAC_PI_2 {
        core::f64::consts::PI - d
    } else {
        d
    };
    d.to_degrees()
}

/// Lays an overpass leap at the crossing of `upper` (route points `a..=b`, the road on top) over `lower` (`c..=d`),
/// in place of a bridge (the caller removes the bridge's feature and its deck heights first or keeps them on refusal).
/// On success the map carries the piece's feature, its sculpted ground and the upper road's new heights; on refusal
/// the map is untouched.
pub fn place(
    map: &mut Map,
    upper: (usize, usize),
    lower: (usize, usize),
    data: &OverpassData,
) -> Result<Feature, Refused> {
    let n = map.route.points.len();
    let span = |(a, b): (usize, usize)| -> Vec<usize> {
        let len = (b + n - a) % n + 1;
        (0..len).map(|k| (a + k) % n).collect()
    };
    let (up, low) = (span(upper), span(lower));
    // The crossing: the upper point nearest the lower road.
    let (_, ci, cj) = up
        .iter()
        .flat_map(|&i| low.iter().map(move |&j| (i, j)))
        .map(|(i, j)| {
            let (p, q) = (xz(map, i), xz(map, j));
            (libm::hypot(p[0] - q[0], p[1] - q[1]), i, j)
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .ok_or(Refused::NoCrossing)?;
    let (p0, p1) = (xz(map, (ci + n - 4) % n), xz(map, (ci + 4) % n));
    let len = libm::hypot(p1[0] - p0[0], p1[1] - p0[1]).max(1e-9);
    let t = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
    let fr = Frame {
        o: xz(map, ci),
        t,
        l: [-t[1], t[0]],
    };
    let y_lower = f64::from(map.route.points[cj].y) / 1000.0;
    let hw = f64::from(map.route.points[ci].width) / 2000.0;
    let lower_hw = f64::from(map.route.points[cj].width) / 2000.0;
    // The flight's lane: the road and its shoulder (the embankment's side slopes stop short of the lower road's bed,
    // which is never touched: abutments).
    let take_off = y_lower + data.take_off_above_lower_m;
    let lane = hw + data.shoulder_m;
    // The gap: the lower road's footprint (its edges, and its bed clearance) across that lane, plus the faces.
    let (mut lo_u, mut hi_u) = (f64::INFINITY, f64::NEG_INFINITY);
    for &j in &low {
        let q = xz(map, j);
        let (a, b) = (xz(map, (j + n - 1) % n), xz(map, (j + 1) % n));
        let l = libm::hypot(b[0] - a[0], b[1] - a[1]).max(1e-9);
        let side = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
        for s in [-1.0, 0.0, 1.0] {
            let reach = s * (lower_hw + data.bed_clear_m);
            let (u, v) = fr.uv(q[0] + side[0] * reach, q[1] + side[1] * reach);
            if v.abs() <= lane {
                lo_u = lo_u.min(u);
                hi_u = hi_u.max(u);
            }
        }
    }
    if !lo_u.is_finite() {
        return Err(Refused::NoCrossing);
    }
    let rim_y = take_off - data.rim_drop_m;
    let pad = f64::from(map.terrain.spacing) / 1000.0;
    let lip = lo_u - (take_off - y_lower) / data.face_slope - pad;
    let rim = hi_u + (rim_y - y_lower) / data.face_slope + pad;
    let base = lip - data.ramp_m;
    let level_from = base - data.level_m;
    // The upper road's own heights along u (before the piece).
    let mut natural: Vec<(f64, f64)> = up
        .iter()
        .map(|&i| {
            let p = xz(map, i);
            // The ground under the road (a bridge's deck heights, if the map had one, aren't the road's own).
            (
                fr.uv(p[0], p[1]).0,
                ground_height_m(&map.terrain, p[0], p[1]),
            )
        })
        .collect();
    natural.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut prof = Profile {
        start: 0.0,
        level_from,
        lip,
        rim,
        land_end: rim + 30.0,
        stop: 0.0,
        take_off,
        rim_y,
        slope: data.min_landing_slope,
        face: data.face_slope,
        floor: y_lower,
        pad,
        natural,
    };
    let climb = (take_off - prof.natural(level_from)).abs()
        / data.climb_grade.unwrap_or(data.max_grade)
        * 1.5;
    prof.start = level_from - climb.max(30.0);
    let original = (map.terrain.clone(), map.route.clone());
    let refuse = |map: &mut Map, why: Refused| {
        (map.terrain, map.route) = original.clone();
        Err(why)
    };
    // Sculpt, find the band against that ground, and lengthen the landing until the band's top comes down on it (the
    // landing's length barely moves the flight, so this settles in a pass or two).
    for _ in 0..10 {
        (map.terrain, map.route) = original.clone();
        let end_y = rim_y - prof.slope * (prof.land_end - rim);
        let back =
            (prof.natural(prof.land_end + data.runout_m) - end_y).abs() / data.max_grade * 1.5;
        prof.stop = prof.land_end + data.runout_m.max(back);
        // The piece stays on the upper road's straight.
        let (u_min, u_max) = (prof.natural[0].0, prof.natural[prof.natural.len() - 1].0);
        let bent = up.iter().any(|&i| {
            let p = xz(map, i);
            let (u, v) = fr.uv(p[0], p[1]);
            u >= prof.start && u <= prof.stop && v.abs() > 1.0
        });
        if prof.start < u_min || prof.stop > u_max || bent {
            return refuse(map, Refused::Bent);
        }
        let sizing = feature_of(map, &fr, &prof, &up, lower, data, 20.0, 27.0, hw);
        let d = GapLeap::of(&sizing).expect("an overpass leap");
        sculpt(map, &fr, &prof, &low, lower_hw, data, &d, base, hw);
        // The embankment and cutting may reach another stretch of road beside the straight (a loop-over's own arc runs
        // into it): a road whose heights the piece didn't set must keep its ground, or it floats over a cutting.
        if let Some(i) = (0..n).find(|&i| {
            let (q, q0) = (&map.route.points[i], &original.1.points[i]);
            let (x, z) = (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0);
            q.y == q0.y
                && libm::fabs(
                    ground_height_m(&map.terrain, x, z) - ground_height_m(&original.0, x, z),
                ) > 0.1
        }) {
            return refuse(
                map,
                Refused::Contract(vec![format!(
                    "the leap's ground reshapes the road at point {i}"
                )]),
            );
        }
        // The band's floor: the slowest speed that comes down past the rim with margin (bisection on the validator's
        // own flight over this ground).
        let clears = |map: &Map, v: f64| {
            setpiece::touchdown(map, &sizing, &d, v)
                .is_some_and(|(x, _)| x >= d.gap_m + setpiece::limits::RIM_MARGIN_M + 0.5)
        };
        if !clears(map, 60.0) {
            return refuse(
                map,
                Refused::TooFast {
                    gap_m: d.gap_m,
                    floor_mps: f64::INFINITY,
                },
            );
        }
        let (mut lo, mut hi) = (5.0, 60.0);
        for _ in 0..30 {
            let m = (lo + hi) / 2.0;
            if clears(map, m) {
                hi = m;
            } else {
                lo = m;
            }
        }
        let floor = libm::ceil(hi * 10.0) / 10.0;
        if floor > data.max_band_floor_mps {
            return refuse(
                map,
                Refused::TooFast {
                    gap_m: d.gap_m,
                    floor_mps: floor,
                },
            );
        }
        let top = libm::floor(floor * (1.0 + data.band_width) * 10.0) / 10.0;
        // R13: the landing runs down at the flight's own angle where the band's middle comes down, so a car meets it
        // nearly parallel (a ski jump's landing hill), then the run-out eases it back onto the road.
        let mid = (floor + top) / 2.0;
        let a = d.launch_angle();
        let vh = mid * libm::cos(a);
        let x_mid = setpiece::touchdown(map, &sizing, &d, mid).map_or(d.gap_m, |(x, _)| x);
        let slope = (9.81 * x_mid / (vh * vh) - libm::tan(a))
            .clamp(data.min_landing_slope, data.max_landing_slope);
        let far = setpiece::touchdown(map, &sizing, &d, top).map_or(f64::INFINITY, |(x, _)| x);
        let need_end = lip + far + setpiece::limits::END_MARGIN_M + 2.0;
        if need_end > prof.land_end || (slope - prof.slope).abs() > 0.02 {
            prof.land_end = prof.land_end.max(need_end);
            prof.slope = slope;
            continue;
        }
        let mut f = feature_of(map, &fr, &prof, &up, lower, data, floor, top, hw);
        // The pit's depth as the validator measures it, on this ground (mid-gap, below the take-off ground).
        let dd = GapLeap::of(&f).expect("an overpass leap");
        let (vl, vt, vg) = setpiece::take_off(map, &f, &dd);
        let mid = dd.gap_m / 2.0;
        let depth = vg - ground_height_m(&map.terrain, vl[0] + vt[0] * mid, vl[2] + vt[1] * mid);
        f.params
            .insert("pitDepthCm".into(), libm::floor(depth * 95.0) as i64);
        // No gate inside the piece (the finish line stays on a road every car drives), and no respawn anchor on it.
        let (from, to) = (f.params["fromAt"] as usize, f.params["toAt"] as usize);
        let inside = |i: usize| {
            if from <= to {
                i > from && i < to
            } else {
                i > from || i < to
            }
        };
        if map
            .route
            .gates
            .iter()
            .any(|g| g.finish && inside(g.at as usize))
        {
            return refuse(
                map,
                Refused::Contract(vec!["the finish line is on the leap".into()]),
            );
        }
        map.route.gates.retain(|g| !inside(g.at as usize));
        map.route.recovery = without(&map.route.recovery, from, to, n);
        let problems = setpiece::problems(map, &f);
        if !problems.is_empty() {
            return refuse(map, Refused::Contract(problems));
        }
        return Ok(f);
    }
    refuse(
        map,
        Refused::Contract(vec!["the landing never settled on the band".into()]),
    )
}

/// The piece's feature: the kicker's base on the centerline, its route span, the gap, the pit and the band.
#[allow(clippy::too_many_arguments)]
fn feature_of(
    map: &Map,
    fr: &Frame,
    prof: &Profile,
    up: &[usize],
    lower: (usize, usize),
    data: &OverpassData,
    floor: f64,
    top: f64,
    hw: f64,
) -> Feature {
    let nearest = |u: f64| {
        let p = fr.at(u);
        *up.iter()
            .min_by(|&&a, &&b| {
                let (pa, pb) = (xz(map, a), xz(map, b));
                libm::hypot(pa[0] - p[0], pa[1] - p[1])
                    .total_cmp(&libm::hypot(pb[0] - p[0], pb[1] - p[1]))
            })
            .expect("an upper road")
    };
    let base_u = prof.lip - data.ramp_m;
    let b = fr.at(base_u);
    let gap = prof.rim - prof.lip;
    let pit = prof.take_off
        - ground_height_m(
            &map.terrain,
            fr.at((prof.lip + prof.rim) / 2.0)[0],
            fr.at((prof.lip + prof.rim) / 2.0)[1],
        );
    // The flat top spans the road less its side slopes, as a set piece's does: the landing lift's taper then falls on the
    // road bed, not between ground cells past its edge (where bilinear ground lifted the landing's edge vertices 0.4 m
    // over the designed surface, Rocks seed 7).
    let width = 2.0 * (hw - jj_map::jump::EDGE_SLOPE_M);
    Feature {
        kind: FeatureKind::SetPiece,
        pose: Pose {
            x: mm(b[0]),
            y: mm(prof.take_off),
            z: mm(b[1]),
            yaw: 0,
        },
        params: [
            ("piece", PieceKind::OverpassLeap.code()),
            ("fromAt", nearest(prof.start) as i64),
            ("toAt", nearest(prof.stop) as i64),
            ("rampLengthMm", i64::from(mm(data.ramp_m))),
            ("rampWidthMm", i64::from(mm(width))),
            ("lipHeightCm", libm::round(data.lip_m * 100.0) as i64),
            ("blendMm", i64::from(mm(data.blend_m))),
            ("gapLengthMm", i64::from(mm(gap))),
            (
                "pitDepthCm",
                (libm::floor(pit * 0.95 * 100.0) as i64).max(0),
            ),
            ("pitLeftMm", i64::from(mm(hw + 6.0))),
            ("pitRightMm", i64::from(mm(hw + 6.0))),
            ("landingLengthMm", i64::from(mm(prof.land_end - prof.rim))),
            ("minSpeedCmps", libm::round(floor * 100.0) as i64),
            ("maxSpeedCmps", libm::round(top * 100.0) as i64),
            ("detourSide", 1),
            ("detourOffsetMm", 0),
            ("detourWidthMm", 0),
            ("sharp", 1),
            ("lowerFrom", lower.0 as i64),
            ("lowerTo", lower.1 as i64),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect(),
    }
}

/// Sculpts the ground: the road's profile across its lane, side slopes out to the land, the gap cut down to its faces,
/// the landing lowered under its lifted surface; the lower road's bed is never touched. The upper road's points stand on
/// the new ground.
#[allow(clippy::too_many_arguments)]
fn sculpt(
    map: &mut Map,
    fr: &Frame,
    prof: &Profile,
    low: &[usize],
    lower_hw: f64,
    data: &OverpassData,
    d: &GapLeap,
    base_u: f64,
    hw: f64,
) {
    let lower_pts: Vec<[f64; 2]> = low.iter().map(|&j| xz(map, j)).collect();
    let near_lower = |x: f64, z: f64| {
        lower_pts
            .windows(2)
            .any(|w| seg_dist(w[0], w[1], [x, z]) < lower_hw + data.bed_clear_m)
    };
    let t = &mut map.terrain;
    let (cols, rows) = (t.cols as usize, t.rows as usize);
    let sp = f64::from(t.spacing) / 1000.0;
    let (ox, oz) = (
        f64::from(t.origin_x) / 1000.0,
        f64::from(t.origin_z) / 1000.0,
    );
    let flat = hw + data.shoulder_m;
    let reach = flat + 40.0 / data.side_slope;
    // The bounding box of the piece's ground in world cells.
    let corners = [fr.at(prof.start), fr.at(prof.stop)];
    let (mut x0, mut x1, mut z0, mut z1) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for c in corners {
        for s in [-1.0, 1.0] {
            let p = [c[0] + fr.l[0] * reach * s, c[1] + fr.l[1] * reach * s];
            x0 = x0.min(p[0]);
            x1 = x1.max(p[0]);
            z0 = z0.min(p[1]);
            z1 = z1.max(p[1]);
        }
    }
    let ci = |v: f64, o: f64, n: usize| (libm::floor((v - o) / sp).max(0.0) as usize).min(n - 1);
    for r in ci(z0, oz, rows)..=ci(z1, oz, rows) {
        for c in ci(x0, ox, cols)..=ci(x1, ox, cols) {
            let (x, z) = (ox + c as f64 * sp, oz + r as f64 * sp);
            let (u, v) = fr.uv(x, z);
            if u < prof.start || u > prof.stop || near_lower(x, z) {
                continue;
            }
            let at = r * cols + c;
            let old = f64::from(t.heights[at]) / 100.0;
            let out = (v.abs() - flat).max(0.0);
            let new = match prof.road(u) {
                Some(y) => {
                    let y = y - landing_lift(d, u - base_u, v);
                    y + (old - y).clamp(-out * data.side_slope, out * data.side_slope)
                }
                None => old.min(prof.gap_cap(u) + out * data.side_slope),
            };
            t.heights[at] = libm::round(new * 100.0) as i16;
        }
    }
    let terrain = map.terrain.clone();
    for q in &mut map.route.points {
        let (x, z) = (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0);
        let (u, v) = fr.uv(x, z);
        if u >= prof.start && u <= prof.stop && v.abs() <= flat {
            q.y = mm(ground_height_m(&terrain, x, z));
            q.bank = 0;
        }
    }
}

fn seg_dist(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> f64 {
    let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
    let l2 = (dx * dx + dz * dz).max(1e-12);
    let s = (((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2).clamp(0.0, 1.0);
    libm::hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dz)
}

/// `spans` with route points `a..=b` (forward, possibly across the seam) taken out.
fn without(spans: &[Span], a: usize, b: usize, n: usize) -> Vec<Span> {
    let covered = |i: usize| {
        if a <= b {
            i >= a && i <= b
        } else {
            i >= a || i <= b
        }
    };
    let mut open = vec![false; n];
    for sp in spans {
        let (f, t) = (sp.from as usize, sp.to as usize);
        let len = (t + n - f) % n + 1;
        for k in 0..len {
            open[(f + k) % n] = true;
        }
    }
    for (i, o) in open.iter_mut().enumerate() {
        if covered(i) {
            *o = false;
        }
    }
    let mut out = Vec::new();
    let mut from = None;
    for (i, &o) in open.iter().enumerate() {
        match (o, from) {
            (true, None) => from = Some(i),
            (false, Some(f)) => {
                out.push(Span {
                    from: f as u32,
                    to: (i - 1) as u32,
                });
                from = None;
            }
            _ => {}
        }
    }
    if let Some(f) = from {
        out.push(Span {
            from: f as u32,
            to: (n - 1) as u32,
        });
    }
    out
}
