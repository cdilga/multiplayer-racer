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

/// Ground within this distance of the road's edge is never terraced, m: the road and its verge keep their profile.
const TERRACE_ROAD_M: f64 = 1.0;
/// A terraced lot's ground fades back to the landscape over this distance outside its rectangle, m (past one cell
/// held flat, so the bilinear ground at the rectangle's edge is the terrace's).
const TERRACE_BLEND_M: f64 = 4.0;
/// A lot's ground may climb or fall along its axis at most this much untouched (the kicker is designed level); steeper is
/// terraced.
const LOT_AXIAL_GRADE: f64 = 0.03;
/// The deepest cut or fill a terrace may make inside its lot, m: deeper, the hill around it stands at roof height.
const TERRACE_MAX_M: f64 = 1.5;

/// Terraces a lot whose ground is too steep (P1-FL15a: Town keeps 25 m of relief): level at the ground's height at its
/// middle, faded back into the landscape outside it. A sloping terrace pitches the kicker and the car overshoots the
/// roof; a cut or fill deeper than `TERRACE_MAX_M` leaves the hill at roof height, so that lot stays unbuilt. Returns
/// the cells it changed with their old heights (none if it refused), to undo a lot that fails anyway.
fn terrace(
    map: &mut Map,
    road: &RoadIndex,
    f: &Feature,
    (from, to, half): (f64, f64, f64),
) -> Vec<(usize, i16)> {
    let a = f64::from(f.pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
    let (c, sn) = (libm::cos(a), libm::sin(a));
    let (fx, fz) = (f64::from(f.pose.x) / 1000.0, f64::from(f.pose.z) / 1000.0);
    let at = |u: f64| (fx + c * u, fz + sn * u);
    let ground = |(x, z): (f64, f64)| ground_height_m(&map.terrain, x, z);
    let mid = (from + to) / 2.0;
    let level = ground(at(mid));
    let t = &map.terrain;
    let sp = f64::from(t.spacing) / 1000.0;
    let (ox, oz) = (
        f64::from(t.origin_x) / 1000.0,
        f64::from(t.origin_z) / 1000.0,
    );
    let (cols, rows) = (t.cols as usize, t.rows as usize);
    let reach = libm::hypot((to - from) / 2.0, half) + sp + TERRACE_BLEND_M;
    let (mx, mz) = at(mid);
    let c0 = libm::floor(((mx - reach - ox) / sp).max(0.0)) as usize;
    let c1 = (libm::ceil(((mx + reach - ox) / sp).max(0.0)) as usize).min(cols - 1);
    let r0 = libm::floor(((mz - reach - oz) / sp).max(0.0)) as usize;
    let r1 = (libm::ceil(((mz + reach - oz) / sp).max(0.0)) as usize).min(rows - 1);
    let mut changed = Vec::new();
    let mut deepest: f64 = 0.0;
    for r in r0..=r1 {
        for col in c0..=c1 {
            let (x, z) = (ox + col as f64 * sp, oz + r as f64 * sp);
            let (dx, dz) = (x - fx, z - fz);
            let (u, lat) = (dx * c + dz * sn, -dx * sn + dz * c);
            let out = libm::hypot(u - u.clamp(from, to), (lat.abs() - half).max(0.0));
            let w = if out <= sp {
                1.0
            } else {
                let k = (1.0 - (out - sp) / TERRACE_BLEND_M).clamp(0.0, 1.0);
                k * k * (3.0 - 2.0 * k)
            };
            if w <= 0.0 {
                continue;
            }
            let (dist, nearest) = road.nearest((x, z));
            if dist < f64::from(map.route.points[nearest].width) / 2000.0 + TERRACE_ROAD_M {
                continue;
            }
            let at_cell = r * cols + col;
            let old = map.terrain.heights[at_cell];
            let plane = level;
            if out <= 0.0 {
                deepest = deepest.max((plane - f64::from(old) / 100.0).abs());
            }
            let new = f64::from(old) / 100.0 + w * (plane - f64::from(old) / 100.0);
            let new = libm::round(new * 100.0) as i16;
            if new != old {
                map.terrain.heights[at_cell] = new;
                changed.push((at_cell, old));
            }
        }
    }
    if deepest > TERRACE_MAX_M {
        untrace(map, &changed);
        changed.clear();
    }
    changed
}

/// Dressing and props (but the new house, `skip`) keep their height above the ground a terrace moved.
fn settle(map: &mut Map, before: &jj_map::Terrain, skip: usize) {
    let terrain = map.terrain.clone();
    let poses = map
        .dressing
        .iter_mut()
        .enumerate()
        .filter(|(k, _)| *k != skip)
        .map(|(_, d)| &mut d.pose)
        .chain(map.props.iter_mut().map(|q| &mut q.pose));
    for pose in poses {
        let (x, z) = (f64::from(pose.x) / 1000.0, f64::from(pose.z) / 1000.0);
        let moved = ground_height_m(&terrain, x, z) - ground_height_m(before, x, z);
        pose.y += libm::round(moved * 1000.0) as i32;
    }
}

/// Undoes [`terrace`].
fn untrace(map: &mut Map, changed: &[(usize, i16)]) {
    for &(at, old) in changed.iter().rev() {
        map.terrain.heights[at] = old;
    }
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
                let clear_ground = |map: &Map| {
                    (0..=samples).all(|k| {
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
                            // Unpainted ground: not a set piece's detour, a fork's branch or a side street.
                            let unpainted = bounds && {
                                let t = &map.terrain;
                                let sp = f64::from(t.spacing) / 1000.0;
                                let c =
                                    libm::round((x - f64::from(t.origin_x) / 1000.0) / sp) as i64;
                                let r =
                                    libm::round((z - f64::from(t.origin_z) / 1000.0) / sp) as i64;
                                c >= 0
                                    && r >= 0
                                    && c < i64::from(t.cols)
                                    && r < i64::from(t.rows)
                                    && matches!(
                                        t.surfaces[(r * i64::from(t.cols) + c) as usize],
                                        jj_map::Surface::OffTrack | jj_map::Surface::Rock
                                    )
                            };
                            // Off a fork branch's graded verge too: a lot's terrace would bend the branch's ground.
                            bounds
                                && road_clear
                                && grade
                                && unpainted
                                && !crate::forks::in_verge(map, [x, z])
                        })
                    })
                };
                // Ground too steep for a lot is terraced (and the terrace undone if the lot fails anyway).
                let mut terraced = Vec::new();
                let before = map.terrain.clone();
                // The kicker is designed for level ground: a lot that climbs or falls along its axis (still under the
                // grade limit) slows or speeds the car off the lip and it misses the roof, so it's terraced too.
                let axial = |map: &Map| {
                    let (x0, z0) = at(from, 0.0);
                    let (x1, z1) = at(to, 0.0);
                    (ground_height_m(&map.terrain, x1, z1) - ground_height_m(&map.terrain, x0, z0))
                        .abs()
                        / (to - from).max(1.0)
                };
                if !clear_ground(map) || axial(map) > LOT_AXIAL_GRADE {
                    terraced = terrace(map, &road, &f, (from, to, half));
                    if terraced.is_empty() || !clear_ground(map) {
                        untrace(map, &terraced);
                        continue;
                    }
                }
                let mut house = house;
                let mut f = f;
                house.pose.y = mm(ground_height_m(&map.terrain, hx, hz));
                f.pose.y = mm(ground_height_m(&map.terrain, x, z));
                map.dressing.push(house);
                if jj_map::roof::problems(map, &f).is_empty() {
                    map.features.push(f);
                    // Respect the route's existing feature exclusion around biome transitions
                    // as well as the physical lot's Town mask. Never move a boundary for a stunt.
                    if crate::biome::check_transitions(map).is_empty() {
                        if !terraced.is_empty() {
                            settle(map, &before, map.dressing.len() - 1);
                        }
                        break 'candidate;
                    }
                    map.features.pop();
                }
                map.dressing.pop();
                untrace(map, &terraced);
            }
        }
    }
}
