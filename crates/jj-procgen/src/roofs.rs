//! Town rooftop stunt lots, added after the complete street/scatter. Neither scenery nor route is
//! removed to make space. An empty, gently sloping run-in, kicker and receiving house are one lot.
use std::collections::BTreeMap;

use jj_map::{Dressing, Feature, FeatureKind, Map, Pose, Registry};
use serde::{Deserialize, Serialize};

use crate::assemble::mm;
use crate::scatter::{RoadIndex, reach_m};
use crate::terrain::ground_height_m;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoofStunts {
    pub spacing_m: f64,
    pub offset_min_m: f64,
    pub offset_max_m: f64,
    pub offset_step_m: f64,
    pub run_in_m: f64,
    pub max_ground_grade: f64,
    pub house_width_m: f64,
    pub house_depth_m: f64,
    pub house_height_m: f64,
    pub ramp_length_m: f64,
    pub ramp_width_m: f64,
    pub lip_height_m: f64,
    pub blend_m: f64,
    pub lip_to_house_m: f64,
    pub design_speed_mps: f64,
}

impl RoofStunts {
    pub fn problems(&self) -> Vec<String> {
        let mut bad = Vec::new();
        for (key, v) in [
            ("spacingM", self.spacing_m),
            ("offsetMinM", self.offset_min_m),
            ("offsetMaxM", self.offset_max_m),
            ("offsetStepM", self.offset_step_m),
            ("runInM", self.run_in_m),
            ("maxGroundGrade", self.max_ground_grade),
            ("houseWidthM", self.house_width_m),
            ("houseDepthM", self.house_depth_m),
            ("houseHeightM", self.house_height_m),
            ("rampLengthM", self.ramp_length_m),
            ("rampWidthM", self.ramp_width_m),
            ("lipHeightM", self.lip_height_m),
            ("blendM", self.blend_m),
            ("lipToHouseM", self.lip_to_house_m),
            ("designSpeedMps", self.design_speed_mps),
        ] {
            if !v.is_finite() || v <= 0.0 {
                bad.push(format!("roofStunts.{key}: must be finite and positive"));
            }
        }
        if self.offset_min_m > self.offset_max_m {
            bad.push("roofStunts: inverted offset range".into());
        }
        // Offsets are millimetre map poses; a step below that resolution can repeatedly produce
        // the same candidate (or fail to advance in floating point) rather than new placements.
        if self.offset_step_m < 0.001 || self.offset_max_m + self.offset_step_m <= self.offset_max_m
        {
            bad.push("roofStunts.offsetStepM: must advance by at least one map millimetre".into());
        }
        if self.blend_m > self.ramp_length_m {
            bad.push("roofStunts.blendM: exceeds ramp length".into());
        }
        if self.max_ground_grade > 0.1 {
            bad.push("roofStunts.maxGroundGrade: above 0.1".into());
        }
        bad
    }
}

/// Whole lot in the kicker's local frame, including run-in and house footprint.
pub fn lot(f: &Feature, house: &Dressing) -> (f64, f64, f64) {
    let ramp = f.params["rampLengthMm"] as f64 / 1000.0;
    let gap = f.params["lipToHouseMm"] as f64 / 1000.0;
    let house_half = house.params["widthMm"] as f64 / 2000.0;
    (
        -f.params["runInMm"] as f64 / 1000.0,
        ramp + gap + house_half,
        (house.params["depthMm"] as f64 / 2000.0 + 1.0)
            .max(f.params["rampWidthMm"] as f64 / 2000.0 + jj_map::jump::EDGE_SLOPE_M),
    )
}

fn obstacle_clear(
    map: &Map,
    f: &Feature,
    registry: &Registry,
    from: f64,
    to: f64,
    half: f64,
) -> bool {
    let a = f64::from(f.pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
    let (tx, tz) = (libm::cos(a), libm::sin(a));
    let clear = |pose: &Pose, id: &str, params: &BTreeMap<String, i64>| {
        let r = registry
            .get(id)
            .and_then(|k| k.footprint(params))
            .map_or(0.5, |fp| reach_m(&fp));
        let (dx, dz) = (
            f64::from(pose.x - f.pose.x) / 1000.0,
            f64::from(pose.z - f.pose.z) / 1000.0,
        );
        let (u, lat) = (dx * tx + dz * tz, -dx * tz + dz * tx);
        // Distance from the centre to the rectangle, with a conservative circumscribed footprint.
        libm::hypot(u - u.clamp(from, to), (lat.abs() - half).max(0.0)) >= r + 0.5
    };
    map.dressing
        .iter()
        .all(|d| clear(&d.pose, &d.kit_piece, &d.params))
        && map
            .props
            .iter()
            .all(|d| clear(&d.pose, &d.kit_piece, &d.params))
        && map
            .features
            .iter()
            .filter(|q| q.params.contains_key("roofTarget"))
            .all(|q| {
                let h = &map.dressing[q.params["roofTarget"] as usize];
                let (lo, hi, w) = lot(q, h);
                // Lots stay separated by their enclosing circles, including their empty run-in.
                let qa = f64::from(q.pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
                let p = Pose {
                    x: q.pose.x + mm((lo + hi) / 2.0 * libm::cos(qa)),
                    z: q.pose.z + mm((lo + hi) / 2.0 * libm::sin(qa)),
                    ..q.pose
                };
                let r = libm::hypot((hi - lo) / 2.0, w);
                let (dx, dz) = (
                    f64::from(p.x - f.pose.x) / 1000.0,
                    f64::from(p.z - f.pose.z) / 1000.0,
                );
                let (u, lat) = (dx * tx + dz * tz, -dx * tz + dz * tx);
                libm::hypot(u - u.clamp(from, to), (lat.abs() - half).max(0.0)) >= r + 0.5
            })
}

pub fn place(map: &mut Map, d: &RoofStunts, registry: &Registry, town: &dyn Fn(usize) -> f64) {
    let pts: Vec<_> = map
        .route
        .points
        .iter()
        .map(|p| (f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0))
        .collect();
    let b = map.header.bounds;
    let road = RoadIndex::new(
        pts.clone(),
        f64::from(b.min_x) / 1000.0,
        f64::from(b.min_z) / 1000.0,
        f64::from(b.max_x - b.min_x) / 1000.0,
        f64::from(b.max_z - b.min_z) / 1000.0,
    );
    let (s, total) = crate::assemble::arc_lengths(&pts);
    let corners = crate::biome::wayfinding::corners(&pts);
    let mut next = d.spacing_m;
    for i in 0..pts.len() {
        if s[i] < next || s[i] > total - d.spacing_m {
            continue;
        }
        next = s[i] + d.spacing_m;
        if town(i) < 0.999 {
            continue;
        }
        let (p, q) = (pts[i], pts[(i + 1) % pts.len()]);
        let l = libm::hypot(q.0 - p.0, q.1 - p.1);
        let (tx, tz) = ((q.0 - p.0) / l, (q.1 - p.1) / l);
        let yaw = libm::round(libm::atan2(tz, tx).to_degrees() * 100.0) as i32;
        'candidate: for side in [-1.0, 1.0] {
            let mut offset = d.offset_min_m;
            while offset <= d.offset_max_m {
                let (hx, hz) = (p.0 - tz * side * offset, p.1 + tx * side * offset);
                offset += d.offset_step_m;
                let house = Dressing {
                    kit_piece: "town/house".into(),
                    collides: true,
                    pose: Pose {
                        x: mm(hx),
                        z: mm(hz),
                        y: mm(ground_height_m(&map.terrain, hx, hz)),
                        // The house's front (+local Z) faces the road on either side.
                        yaw: if side > 0.0 { yaw + 18_000 } else { yaw },
                    },
                    params: BTreeMap::from([
                        ("widthMm".into(), mm(d.house_width_m) as i64),
                        ("depthMm".into(), mm(d.house_depth_m) as i64),
                        (
                            "heightCm".into(),
                            libm::round(d.house_height_m * 100.0) as i64,
                        ),
                        ("roofPitchDeg".into(), 24),
                    ]),
                };
                let nearest = (0..pts.len())
                    .min_by(|&a, &b| {
                        libm::hypot(pts[a].0 - hx, pts[a].1 - hz)
                            .total_cmp(&libm::hypot(pts[b].0 - hx, pts[b].1 - hz))
                    })
                    .unwrap();
                if corners.iter().any(|c| nearest >= c.from && nearest <= c.to) {
                    continue;
                }
                // Preserve Town's existing circumscribed-footprint spacing as well as the
                // physical rectangular lot clearance below. Neither trees nor houses move.
                let house_r = registry
                    .get(&house.kit_piece)
                    .unwrap()
                    .footprint(&house.params)
                    .map(|fp| reach_m(&fp))
                    .unwrap();
                let spaced = |pose: &Pose, id: &str, params: &BTreeMap<String, i64>| {
                    let r = registry
                        .get(id)
                        .and_then(|k| k.footprint(params))
                        .map_or(0.5, |fp| reach_m(&fp));
                    libm::hypot(
                        f64::from(pose.x) / 1000.0 - hx,
                        f64::from(pose.z) / 1000.0 - hz,
                    ) >= house_r + r + 0.5
                };
                if !map
                    .dressing
                    .iter()
                    .all(|p| spaced(&p.pose, &p.kit_piece, &p.params))
                    || !map
                        .props
                        .iter()
                        .all(|p| spaced(&p.pose, &p.kit_piece, &p.params))
                {
                    continue;
                }
                let back = d.ramp_length_m + d.lip_to_house_m;
                let lane = -side;
                let (x, z) = (hx - tx * back - tz * lane, hz - tz * back + tx * lane);
                let f = Feature {
                    kind: FeatureKind::Jump,
                    pose: Pose {
                        x: mm(x),
                        z: mm(z),
                        y: mm(ground_height_m(&map.terrain, x, z)),
                        yaw,
                    },
                    params: BTreeMap::from([
                        ("sharp".into(), 1),
                        ("roofTarget".into(), map.dressing.len() as i64),
                        ("designSpeedMmps".into(), mm(d.design_speed_mps) as i64),
                        ("rampLengthMm".into(), mm(d.ramp_length_m) as i64),
                        ("rampWidthMm".into(), mm(d.ramp_width_m) as i64),
                        (
                            "lipHeightCm".into(),
                            libm::round(d.lip_height_m * 100.0) as i64,
                        ),
                        ("blendMm".into(), mm(d.blend_m) as i64),
                        ("runInMm".into(), mm(d.run_in_m) as i64),
                        ("lipToHouseMm".into(), mm(d.lip_to_house_m) as i64),
                    ]),
                };
                let (from, to, half) = lot(&f, &house);
                if !obstacle_clear(map, &f, registry, from, to, half) {
                    continue;
                }
                let a = f64::from(yaw) / 100.0 * core::f64::consts::PI / 180.0;
                let (c, sn) = (libm::cos(a), libm::sin(a));
                let at = |u: f64, lat: f64| {
                    (
                        f64::from(f.pose.x) / 1000.0 + c * u - sn * lat,
                        f64::from(f.pose.z) / 1000.0 + sn * u + c * lat,
                    )
                };
                let samples = libm::ceil((to - from) / 1.0) as usize;
                let clear_ground = (0..=samples).all(|k| {
                    let u = from + (to - from) * k as f64 / samples as f64;
                    [-half, 0.0, half].into_iter().all(|lat| {
                        let (x, z) = at(u, lat);
                        let (dist, nearest) = road.nearest((x, z));
                        let h = ground_height_m(&map.terrain, x, z);
                        let (xx, zz) = at(u + 0.5, lat);
                        let (lx, lz) = at(u, lat + 0.5);
                        let bounds = x * 1000.0 >= f64::from(b.min_x)
                            && x * 1000.0 <= f64::from(b.max_x)
                            && z * 1000.0 >= f64::from(b.min_z)
                            && z * 1000.0 <= f64::from(b.max_z);
                        let road_clear = dist
                            >= f64::from(map.route.points[nearest].width) / 2000.0 + 3.5
                            && town(nearest) >= 0.999;
                        let grade = (h - ground_height_m(&map.terrain, xx, zz)).abs() / 0.5
                            <= d.max_ground_grade
                            && (h - ground_height_m(&map.terrain, lx, lz)).abs() / 0.5
                                <= d.max_ground_grade;
                        bounds && road_clear && grade
                    })
                });
                if !clear_ground {
                    continue;
                }
                map.dressing.push(house);
                if jj_map::roof::problems(map, &f).is_empty() {
                    map.features.push(f);
                    // Respect the route's existing feature exclusion around biome transitions
                    // as well as the physical lot's Town mask. Never move a boundary for a stunt.
                    if crate::biome::check_transitions(map).is_empty() {
                        break 'candidate;
                    }
                    map.features.pop();
                }
                map.dressing.pop();
            }
        }
    }
}
