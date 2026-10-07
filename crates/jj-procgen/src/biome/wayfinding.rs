//! The shared wayfinding family (P1-M03f; R104, R105, R106): the core places it on every route, whatever the biomes.
//!
//! - **Corner chevrons (R104):** a row of posts along the outside of every corner, [`CHEVRON_SPACING_M`] apart, each a
//!   `wayfinding/chevron-post` carrying one chevron and facing the road. Never one big multi-chevron board.
//! - **Guard rail (R105):** Australian steel W-beam on posts, `wayfinding/guard-rail` sections end to end behind the
//!   chevrons on the outer edge of every corner. Not tyre walls.
//! - **Finish gantry (R106):** a race-banner gantry at the line, a `wayfinding/finish-gantry` leg each side of the road
//!   (the renderer hangs the banner between them). No "Checkpoint N" pieces anywhere.
//!
//! Pieces are registry ids (P1-R10 builds the real ones; [`super::WAYFINDING_PIECES`] are stand-ins with the same ids).
//! Placed after features, before scatter (which treats them as obstacles). Deterministic, no randomness.

use std::collections::BTreeMap;

use jj_map::{Dressing, Map, Pose};

use crate::terrain::ground_height_m;

pub const CHEVRON: &str = "wayfinding/chevron-post";
pub const GUARD_RAIL: &str = "wayfinding/guard-rail";
pub const FINISH_GANTRY: &str = "wayfinding/finish-gantry";

/// A turn at least this tight (radius, m) is a corner that gets chevrons and rail.
pub const CORNER_RADIUS_M: f64 = 150.0;
/// A corner shorter than this along the road isn't one (m).
const MIN_CORNER_M: f64 = 10.0;
/// Corner runs split by fewer than this many straight points are one corner.
const MERGE_GAP_POINTS: usize = 3;
pub const CHEVRON_SPACING_M: f64 = 6.0;
pub const RAIL_SECTION_M: f64 = 4.0;
/// Distance from the road edge to the chevron posts and to the rail's centre line, m.
pub const CHEVRON_OFFSET_M: f64 = 2.8;
pub const RAIL_OFFSET_M: f64 = 3.6;
pub const GANTRY_OFFSET_M: f64 = 3.2;

/// A corner on the route.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Corner {
    /// First and last route point of the turn.
    pub from: usize,
    pub to: usize,
    /// Turning left (the outside is the right of travel).
    pub left: bool,
}

fn tangent(pts: &[(f64, f64)], i: usize) -> (f64, f64) {
    let n = pts.len();
    let (a, b) = (pts[i % n], pts[(i + 1) % n]);
    let l = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
    ((b.0 - a.0) / l, (b.1 - a.1) / l)
}

/// The route's corners: runs of points whose smoothed plan curvature is at least `1 / CORNER_RADIUS_M`, one sign each.
pub fn corners(pts: &[(f64, f64)]) -> Vec<Corner> {
    let n = pts.len();
    // Signed curvature, + = left (the tangent turns toward (tz, -tx)), smoothed over +-2 points.
    let raw: Vec<f64> = (0..n)
        .map(|i| {
            let (a, b) = (tangent(pts, (i + n - 1) % n), tangent(pts, i));
            let turn = libm::atan2(b.0 * a.1 - b.1 * a.0, a.0 * b.0 + a.1 * b.1);
            let ds =
                (libm::hypot(
                    pts[i].0 - pts[(i + n - 1) % n].0,
                    pts[i].1 - pts[(i + n - 1) % n].1,
                ) + libm::hypot(pts[(i + 1) % n].0 - pts[i].0, pts[(i + 1) % n].1 - pts[i].1))
                    / 2.0;
            turn / ds.max(1e-9)
        })
        .collect();
    let k: Vec<f64> = (0..n)
        .map(|i| (0..5).map(|j| raw[(i + n + j - 2) % n]).sum::<f64>() / 5.0)
        .collect();
    let sign = |i: usize| {
        if k[i] >= 1.0 / CORNER_RADIUS_M {
            1
        } else if k[i] <= -1.0 / CORNER_RADIUS_M {
            -1
        } else {
            0
        }
    };
    // Runs of one sign, found without wrapping (the seam is on a straight: boundaries and start sit there).
    let mut runs: Vec<(usize, usize, i32)> = Vec::new();
    let mut i = 0;
    while i < n {
        let sg = sign(i);
        if sg == 0 {
            i += 1;
            continue;
        }
        let mut j = i;
        while j + 1 < n && sign(j + 1) == sg {
            j += 1;
        }
        // Merge with the previous run of the same sign across a short gap.
        match runs.last_mut() {
            Some(last) if last.2 == sg && i - last.1 <= MERGE_GAP_POINTS => last.1 = j,
            _ => runs.push((i, j, sg)),
        }
        i = j + 1;
    }
    let mean_ds = pts
        .iter()
        .enumerate()
        .map(|(i, p)| libm::hypot(pts[(i + 1) % n].0 - p.0, pts[(i + 1) % n].1 - p.1))
        .sum::<f64>()
        / n as f64;
    runs.into_iter()
        .filter(|&(a, b, _)| (b - a) as f64 * mean_ds >= MIN_CORNER_M)
        .map(|(from, to, sg)| Corner {
            from,
            to,
            left: sg > 0,
        })
        .collect()
}

fn pose_at(map: &Map, pts: &[(f64, f64)], i: usize, lateral: f64) -> (Pose, (f64, f64)) {
    let (tx, tz) = tangent(pts, i);
    let (x, z) = (pts[i].0 - tz * lateral, pts[i].1 + tx * lateral);
    let yaw = libm::round(libm::atan2(tz, tx).to_degrees() * 100.0) as i32;
    let (mx, mz) = (
        libm::round(x * 1000.0) as i32,
        libm::round(z * 1000.0) as i32,
    );
    let y = ground_height_m(&map.terrain, f64::from(mx) / 1000.0, f64::from(mz) / 1000.0);
    (
        Pose {
            x: mx,
            y: libm::round(y * 1000.0) as i32,
            z: mz,
            yaw,
        },
        (tx, tz),
    )
}

/// Places the family on the map's route, replacing any it placed before. Call after features and the final ground.
pub fn place(map: &mut Map) {
    map.dressing
        .retain(|d| !d.kit_piece.starts_with("wayfinding/"));
    let pts: Vec<(f64, f64)> = map
        .route
        .points
        .iter()
        .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
        .collect();
    let half = f64::from(map.route.points[0].width) / 2000.0;
    let n = pts.len();
    let mut placed: Vec<Dressing> = Vec::new();
    for c in corners(&pts) {
        // The outside of a left turn is the right of travel (+ lateral, along (-tz, tx)); of a right turn, the left.
        let side = if c.left { 1.0 } else { -1.0 };
        let mut dist = 0.0;
        let mut rail_dist = 0.0;
        let mut last = pts[c.from];
        for i in c.from..=c.to.min(n - 1) {
            dist += libm::hypot(pts[i].0 - last.0, pts[i].1 - last.1);
            rail_dist += libm::hypot(pts[i].0 - last.0, pts[i].1 - last.1);
            last = pts[i];
            if i == c.from || dist >= CHEVRON_SPACING_M {
                dist = 0.0;
                let (mut pose, _) = pose_at(map, &pts, i, side * (half + CHEVRON_OFFSET_M));
                // The chevron faces the road: yaw turned toward the centerline.
                pose.yaw = (pose.yaw + if c.left { 9_000 } else { -9_000 }).rem_euclid(36_000);
                placed.push(Dressing {
                    kit_piece: CHEVRON.into(),
                    pose,
                    params: BTreeMap::from([("heightCm".into(), 140), ("radiusMm".into(), 60)]),
                    collides: false,
                });
            }
            if i == c.from || rail_dist >= RAIL_SECTION_M {
                rail_dist = 0.0;
                let (pose, _) = pose_at(map, &pts, i, side * (half + RAIL_OFFSET_M));
                placed.push(Dressing {
                    kit_piece: GUARD_RAIL.into(),
                    pose,
                    params: BTreeMap::from([
                        ("lengthMm".into(), (RAIL_SECTION_M * 1000.0) as i64),
                        ("heightCm".into(), 80),
                        ("thicknessMm".into(), 300),
                    ]),
                    collides: true,
                });
            }
        }
    }
    // The finish gantry: one leg each side of the road at the finish gate.
    if let Some(g) = map.route.gates.iter().find(|g| g.finish) {
        let i = g.at as usize;
        for side in [-1.0, 1.0] {
            let (pose, _) = pose_at(map, &pts, i, side * (half + GANTRY_OFFSET_M));
            placed.push(Dressing {
                kit_piece: FINISH_GANTRY.into(),
                pose,
                params: BTreeMap::from([
                    (
                        "spanMm".into(),
                        libm::round((2.0 * (half + GANTRY_OFFSET_M)) * 1000.0) as i64,
                    ),
                    ("heightCm".into(), 520),
                ]),
                collides: true,
            });
        }
    }
    map.dressing.extend(placed);
    map.dressing.sort();
}

/// What the seed bank checks: every corner has a chevron row and a rail, the finish has both legs, nothing is a
/// checkpoint. Empty means fine.
pub fn check(map: &Map) -> Vec<String> {
    let mut bad = Vec::new();
    let pts: Vec<(f64, f64)> = map
        .route
        .points
        .iter()
        .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
        .collect();
    let half = f64::from(map.route.points[0].width) / 2000.0;
    let near = |piece: &str, i: usize, reach: f64| {
        map.dressing.iter().any(|d| {
            d.kit_piece == piece
                && libm::hypot(
                    f64::from(d.pose.x) / 1000.0 - pts[i].0,
                    f64::from(d.pose.z) / 1000.0 - pts[i].1,
                ) <= half + reach + 2.0
        })
    };
    for (k, c) in corners(&pts).iter().enumerate() {
        let (mid, first, last) = ((c.from + c.to) / 2, c.from, c.to);
        for &i in &[first, mid, last] {
            if !near(CHEVRON, i, CHEVRON_OFFSET_M + CHEVRON_SPACING_M) {
                bad.push(format!(
                    "corner {k} ({:?}): no chevron post near point {i}",
                    c
                ));
            }
            if !near(GUARD_RAIL, i, RAIL_OFFSET_M + RAIL_SECTION_M) {
                bad.push(format!(
                    "corner {k} ({:?}): no guard rail near point {i}",
                    c
                ));
            }
        }
    }
    let legs = map
        .dressing
        .iter()
        .filter(|d| d.kit_piece == FINISH_GANTRY)
        .count();
    if legs != 2 {
        bad.push(format!("the finish has {legs} gantry legs, not 2"));
    }
    let names = map
        .dressing
        .iter()
        .map(|d| &d.kit_piece)
        .chain(map.props.iter().map(|p| &p.kit_piece));
    if let Some(name) = names
        .into_iter()
        .find(|n| n.to_lowercase().contains("checkpoint"))
    {
        bad.push(format!("a checkpoint piece {name:?} (R106)"));
    }
    bad
}
