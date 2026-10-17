//! R124: explicit upper road; the terrain remains ground beneath the deck.
use crate::{
    assemble::{arc_lengths, distance_to_loop, mm},
    course::{Course, Crossing},
    features::Density,
    tuning::CrossingData,
};
use jj_map::{Feature, FeatureKind, Map, Pose, Registry};

/// The deck counts as over the lower road within both roads' half-widths of each other plus this, m.
const DECK_OVERLAP_MARGIN_M: f64 = 2.0;

/// Every crossing of the course becomes a bridge: its upper span a deck over the lower road.
pub fn place(map: &mut Map, course: &Course, data: &CrossingData) {
    for c in &course.crossings {
        place_one(map, c, data);
    }
}

fn place_one(map: &mut Map, crossing: &Crossing, data: &CrossingData) {
    let (upper, lower) = (crossing.upper, crossing.lower);
    let pts: Vec<_> = map
        .route
        .points
        .iter()
        .map(|p| (p.x as f64 / 1000.0, p.z as f64 / 1000.0))
        .collect();
    let (s, _) = arc_lengths(&pts);
    let at = |v: f64| {
        (0..s.len())
            .min_by(|&a, &b| (s[a] - v).abs().total_cmp(&(s[b] - v).abs()))
            .unwrap()
    };
    let (a, b, c, d) = (at(upper.0), at(upper.1), at(lower.0), at(lower.1));
    // The deck's top is at the crossing point; each side ramps over its own length (equal at a mid-span crossing).
    let (mid, half_lo, half_hi) = if crossing.halves().0 == crossing.halves().1 {
        let half = (s[b] - s[a]) / 2.0;
        ((s[a] + s[b]) / 2.0, half, half)
    } else {
        let t = (crossing.at.0 - upper.0) / (upper.1 - upper.0);
        let mid = s[a] + t * (s[b] - s[a]);
        (mid, mid - s[a], s[b] - mid)
    };
    let ground: Vec<_> = (a..=b)
        .map(|i| {
            jj_map::bridge::edges(map, i)
                .map(|edge| crate::terrain::ground_height_m(&map.terrain, edge[0], edge[2]))
        })
        .collect();
    // A deck has its own smooth profile, rather than copying the ground's
    // intersection blend into each edge (Dirt seed 16 produced a 22.5% ripple).
    // Both ends meet the real road edges; the deck stands its height over the lower road where that passes beneath (the
    // terrain routes the lower road a deck's height under the upper one, P1-FL15a). Ground under the plateau is a blend
    // of both roads' beds, so it is not the reference; the profile below still follows any ground above the cosine.
    let blend_at = |distance: f64| {
        let half = if distance < mid { half_lo } else { half_hi };
        let u =
            ((distance - mid).abs() - data.plateau_half_m).max(0.0) / (half - data.plateau_half_m);
        (1.0 + libm::cos(u.clamp(0.0, 1.0) * core::f64::consts::PI)) / 2.0
    };
    // The cosine leaves each foot level, but the road outside meets it at its own grade: a foot on a 10% climb was a
    // crease a car at speed took off from (seed 98's bot flew 0.9 s off a bridge's foot, br-cxqk/v28). Each foot's line
    // carries the outside road's grade inward, fading out over `DECK_FOOT_M` (`crate::terrain::deck_foot`).
    let n = pts.len();
    let y = |i: usize| map.route.points[i % n].y as f64 / 1000.0;
    let run = |i: usize, j: usize| {
        let (p, q) = (pts[i % n], pts[j % n]);
        libm::hypot(q.0 - p.0, q.1 - p.1).max(1e-6)
    };
    let (g_lo, g_hi) = (
        (y(a) - y(a + n - 2)) / (run(a + n - 2, a + n - 1) + run(a + n - 1, a)),
        (y(b + 2) - y(b)) / (run(b, b + 1) + run(b + 1, b + 2)),
    );
    let foot_line = |foot: f64, distance: f64| {
        if distance < mid {
            foot + crate::terrain::deck_foot(g_lo, distance - s[a])
        } else {
            foot + crate::terrain::deck_foot(g_hi, distance - s[b])
        }
    };
    // Where the deck passes over the lower road (its points within both half-widths and a margin of a lower point), its
    // underside clears that road by the deck's height less its thickness, ramp included: at a shallow crossing angle
    // the overlap runs past the plateau onto the cosine. Solve the cosine's top for each such point.
    let reach = |i: usize, j: usize| {
        let (p, q) = (&map.route.points[i], &map.route.points[j]);
        let near = (f64::from(p.width) + f64::from(q.width)) / 2000.0 + DECK_OVERLAP_MARGIN_M;
        libm::hypot(f64::from(p.x - q.x), f64::from(p.z - q.z)) / 1000.0 <= near
    };
    let lower_ix: Vec<usize> = (c..=d).collect();
    let top = (a..=b)
        .filter_map(|i| {
            let under = lower_ix
                .iter()
                .filter(|&&j| reach(i, j))
                .map(|&j| map.route.points[j].y as f64 / 1000.0)
                .fold(f64::NEG_INFINITY, f64::max);
            if !under.is_finite() {
                return None;
            }
            let foot_edges = if s[i] < mid { ground[0] } else { ground[b - a] };
            let foot = foot_line(
                foot_edges.iter().copied().fold(f64::NEG_INFINITY, f64::max),
                s[i],
            );
            let need = under + data.deck_height_m;
            let k = blend_at(s[i]);
            Some(if k > 1e-6 {
                foot + (need - foot) / k
            } else {
                need
            })
        })
        .fold(f64::NEG_INFINITY, f64::max)
        // Never below the upper road's own routed line at the plateau (the terrain leaves it on the span's points).
        .max(
            (a..=b)
                .filter(|&i| (s[i] - mid).abs() <= data.plateau_half_m)
                .map(|i| map.route.points[i].y as f64 / 1000.0)
                .fold(f64::NEG_INFINITY, f64::max),
        );
    for (i, &distance) in s.iter().enumerate().take(b + 1).skip(a) {
        let blend = blend_at(distance);
        let end = if distance < mid {
            ground[0]
        } else {
            ground[b - a]
        };
        // Taller natural hills can rise above a cosine approach between its endpoints. A deck must meet that road
        // rather than pass through the terrain: the car would drive on the hidden hill above its painted road and
        // height-aware gates. Keep the smooth raised profile wherever it clears the ground, and follow the actual
        // road edges where they are higher. The same grade validator and physical lap bank qualify this envelope.
        let [left, right] = std::array::from_fn(|edge| {
            let foot = foot_line(end[edge], distance);
            (foot + (top - foot) * blend).max(ground[i - a][edge])
        });
        let p = &mut map.route.points[i];
        p.y = mm((left + right) / 2.0);
        p.bank = libm::round(
            libm::atan((right - left) / (p.width as f64 / 1000.0)) * 18000.0
                / core::f64::consts::PI,
        ) as i16;
    }
    let q = &map.route.points[a];
    map.features.push(Feature {
        kind: FeatureKind::Bridge,
        pose: Pose {
            x: q.x,
            y: q.y,
            z: q.z,
            yaw: 0,
        },
        params: [
            ("upperFrom", a as i64),
            ("upperTo", b as i64),
            ("lowerFrom", c as i64),
            ("lowerTo", d as i64),
            ("thicknessMm", data.thickness_mm),
            ("barrierHeightMm", data.barrier_height_mm),
            ("barrierWidthMm", data.barrier_width_mm),
            ("clearanceMm", data.clearance_mm),
            ("maxGradeMilli", data.max_grade_milli),
        ]
        .into_iter()
        .map(|(k, v)| (k.into(), v))
        .collect(),
    });
}

/// How far before an overpass leap's kicker its graded run-in (level and climb) can begin, m: the loop-over's
/// `leapBeforeM` with margin.
const LEAP_RUN_IN_M: f64 = 160.0;

/// Keep each ordinary feature's full envelope away from both crossing straights.
/// Features remain eligible throughout the rest of every biome.
pub fn feature_ranges(map: &Map, ranges: &[(f64, f64, Density)]) -> Vec<(f64, f64, Density)> {
    let pts: Vec<_> = map
        .route
        .points
        .iter()
        .map(|p| (p.x as f64 / 1000.0, p.z as f64 / 1000.0))
        .collect();
    let (s, total) = arc_lengths(&pts);
    let mut out = ranges.to_vec();
    // A bridge's two roads, or an overpass leap's (br-xlvx.10.3: its upper road from its graded run-in, at most
    // `LEAP_RUN_IN_M` before the kicker, the ramp, gap and landing).
    let spans: Vec<(f64, f64)> = map
        .features
        .iter()
        .flat_map(|f| {
            let mut v = Vec::new();
            if let Some(d) = jj_map::bridge::BridgeDesign::of(f) {
                for span in [d.upper, d.lower] {
                    v.push((s[span.from as usize] - 30.0, s[span.to as usize] + 30.0));
                }
            } else if let Some(g) = jj_map::setpiece::GapLeap::of(f)
                && let Some((a, b)) = g.lower
            {
                v.push((
                    s[g.from as usize % pts.len()] - LEAP_RUN_IN_M,
                    s[g.to as usize % pts.len()] + 30.0,
                ));
                v.push((
                    s[a as usize % pts.len()] - 30.0,
                    s[b as usize % pts.len()] + 30.0,
                ));
            }
            v
        })
        .collect();
    for (lo, hi) in spans {
        let (lo, hi) = (lo.max(0.0), hi.min(total));
        out = out
            .into_iter()
            .flat_map(|(a, b, density)| {
                let mut v = Vec::new();
                if b <= lo || a >= hi {
                    v.push((a, b, density));
                } else {
                    if a < lo {
                        v.push((a, lo, density));
                    }
                    if b > hi {
                        v.push((hi, b, density));
                    }
                }
                v
            })
            .collect();
    }
    out
}

/// Existing kit placement sees XZ terrain, so keep furniture clear of the deck and
/// the underpass. This is geometric clearance, independent of counts.
pub fn clear_corridors(map: &mut Map, registry: &Registry) {
    let lines: Vec<Vec<_>> = map
        .features
        .iter()
        .filter_map(|f| {
            // A bridge's deck, or an overpass leap's upper road (br-xlvx.10.3): furniture beside the road above stood on
            // the road below.
            let upper = if let Some(d) = jj_map::bridge::BridgeDesign::of(f) {
                d.upper
            } else {
                let g = jj_map::setpiece::GapLeap::of(f).filter(|g| g.lower.is_some())?;
                jj_map::Span {
                    from: g.from,
                    to: g.to,
                }
            };
            Some(
                jj_map::bridge::indices(map, upper)?
                    .iter()
                    .map(|&i| {
                        let p = &map.route.points[i];
                        (p.x as f64 / 1000.0, p.z as f64 / 1000.0)
                    })
                    .collect(),
            )
        })
        .collect();
    if lines.is_empty() {
        return;
    }
    let clear = |pose: Pose, id: &str, params: &jj_map::Params| {
        let reach = registry
            .get(id)
            .and_then(|p| p.footprint(params))
            .map(|fp| crate::scatter::reach_m(&fp))
            .unwrap_or(0.0);
        lines.iter().all(|line| {
            distance_to_loop(line, (pose.x as f64 / 1000.0, pose.z as f64 / 1000.0))
                > 6.0 + reach + 0.35
        })
    };
    map.dressing.retain(|d| {
        d.kit_piece == "outback_bitumen/centre-line" || clear(d.pose, &d.kit_piece, &d.params)
    });
    map.props.retain(|p| clear(p.pose, &p.kit_piece, &p.params));
}
