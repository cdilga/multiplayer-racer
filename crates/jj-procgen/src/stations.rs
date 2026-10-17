//! P1-W04: item pickup stations on generated tracks. Rows of `generic/item-station` boxes across the road every
//! `spacingM` of route from `firstM` on, at the data's lateral offsets, skipping the start corridor and every jump's ramp
//! and landing (with `CLEAR_M` to spare); the validator holds the same rule (jj_map `ItemStation`). Data, not a count:
//! a longer track gets more rows.

use jj_map::{FeatureKind, Map, Pose, kit::ITEM_STATION};

use crate::assemble::arc_lengths;
use crate::tuning::StationData;

/// Distance kept from a jump's envelope and from the start corridor, m.
pub const CLEAR_M: f64 = 12.0;

pub fn place(map: &mut Map, data: &StationData, registry: &jj_map::Registry) {
    let pts: Vec<(f64, f64)> = map
        .route
        .points
        .iter()
        .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
        .collect();
    let n = pts.len();
    if n < 3 {
        return;
    }
    let (s, total) = arc_lengths(&pts);
    let start = map.route.start;
    let s_front = s[start.at as usize];
    let s_back = s_front - f64::from(start.length) / 1000.0;
    // Along-route spans to keep clear: the start corridor and each jump (base to the end of its landing).
    let mut keep_out = vec![(s_back - CLEAR_M, s_front + CLEAR_M)];
    for f in &map.features {
        if f.kind != FeatureKind::Jump {
            continue;
        }
        let Some(d) = jj_map::jump::JumpDesign::of(f) else {
            continue;
        };
        let (fx, fz) = (f64::from(f.pose.x) / 1000.0, f64::from(f.pose.z) / 1000.0);
        let base = (0..n)
            .min_by(|&a, &b| {
                let d = |i: usize| (pts[i].0 - fx).powi(2) + (pts[i].1 - fz).powi(2);
                d(a).total_cmp(&d(b))
            })
            .unwrap_or(0);
        keep_out.push((s[base] - CLEAR_M, s[base] + d.length_m() + CLEAR_M));
    }
    // And each loop, its entry to its exit (br-xlvx.6.4).
    for d in map
        .features
        .iter()
        .filter_map(jj_map::looping::LoopDesign::of)
    {
        if d.exit < n {
            keep_out.push((s[d.entry] - CLEAR_M, s[d.exit] + CLEAR_M));
        }
    }
    let blocked = |at: f64| {
        keep_out.iter().any(|&(a, b)| {
            let (a, b) = (a.rem_euclid(total), b.rem_euclid(total));
            if a <= b {
                at >= a && at <= b
            } else {
                at >= a || at <= b
            }
        })
    };
    let mut at = data.first_m;
    while at < total - data.spacing_m / 2.0 {
        if !blocked(at) {
            let i = s.iter().position(|&v| v >= at).unwrap_or(n - 1).min(n - 1);
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            let len = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
            let (tx, tz) = ((b.0 - a.0) / len, (b.1 - a.1) / len);
            let yaw = libm::round(libm::atan2(tz, tx).to_degrees() * 100.0) as i32;
            for &lat in &data.lateral_m {
                // Left of the direction of travel is (-tz, tx).
                let (x, z) = (a.0 - tz * lat, a.1 + tx * lat);
                // Grounded the way the terrain pass grounds all dressing, so re-shaping the terrain is idempotent.
                let y = libm::round(crate::terrain::ground_height_m(&map.terrain, x, z) * 1000.0)
                    as i32;
                map.dressing.push(jj_map::Dressing {
                    kit_piece: ITEM_STATION.to_owned(),
                    pose: Pose {
                        x: libm::round(x * 1000.0) as i32,
                        y,
                        z: libm::round(z * 1000.0) as i32,
                        yaw,
                    },
                    params: Default::default(),
                    collides: false,
                });
            }
        }
        at += data.spacing_m;
    }
    prune(map, registry);
}

/// Drops every station the validator refuses (its landing envelopes reach past a jump's geometry: they cover the flight at
/// design speed). Called after stations are placed, and again whenever features are placed later, so no order of the
/// passes can leave a box on a jump.
pub fn prune(map: &mut Map, registry: &jj_map::Registry) {
    if !map.dressing.iter().any(|d| d.kit_piece == ITEM_STATION) {
        return;
    }
    let refused: std::collections::BTreeSet<String> = jj_map::validate(map, registry)
        .violations
        .into_iter()
        .filter(|v| v.rule == jj_map::Rule::ItemStation)
        .map(|v| v.at)
        .collect();
    if !refused.is_empty() {
        let mut i = 0;
        map.dressing.retain(|_| {
            let keep = !refused.contains(&format!("dressing[{i}]"));
            i += 1;
            keep
        });
    }
}
