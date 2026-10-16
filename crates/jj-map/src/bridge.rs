//! Grade-separated crossings (R124, br-xlvx.3). The terrain remains the lower layer. A bridge is an explicit closed
//! deck and two solid edge barriers following the upper route span, never a raised heightfield cell.
//!
//! Integer feature params: `upperFrom`, `upperTo`, `lowerFrom`, `lowerTo` (inclusive route spans, wrapping on a closed
//! route); `thicknessMm`, `barrierHeightMm`, `barrierWidthMm`, `clearanceMm`, `maxGradeMilli`. Surface heights and
//! banks come from the route's actual data. The sim and renderer must use the same triangles.

use crate::jump::JumpMesh;
use crate::model::{Feature, FeatureKind, Map, Span, Surface};

/// Material for every triangle, in the exact order of `bridge_mesh`. The wheel's
/// hit collider selects grip, so the road beneath cannot change a deck's material.
pub fn triangle_surfaces(map: &Map, f: &Feature) -> Option<Vec<Surface>> {
    let ix = indices(map, BridgeDesign::of(f)?.upper)?;
    let mut out = Vec::new();
    for _ in 0..3 {
        for &i in &ix[..ix.len() - 1] {
            out.extend([map.route.points[i].surface; 8]);
        }
        out.extend([map.route.points[ix[0]].surface; 2]);
        out.extend([map.route.points[*ix.last()?].surface; 2]);
    }
    // Each pier: a closed box, six faces.
    out.extend(core::iter::repeat_n(
        Surface::Rock,
        piers(map, &BridgeDesign::of(f)?, &ix).len() * 12,
    ));
    Some(out)
}

/// Piers hold the deck up where it stands clear of the ground: a square column under each edge every `PIER_EVERY`
/// route points, from just below the ground to the deck's underside. None where the deck is within `PIER_MIN_M` of the
/// ground, and none within the lower road's half-width plus `PIER_CLEAR_M` of it, so the underpass stays open. Each is
/// (centre x, z, foot y, head y), m.
pub fn piers(map: &Map, d: &BridgeDesign, ix: &[usize]) -> Vec<[f64; 4]> {
    let Some(lower) = indices(map, d.lower) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (k, &i) in ix.iter().enumerate() {
        if k < PIER_END || k + PIER_END >= ix.len() || (k - PIER_END) % PIER_EVERY != 0 {
            continue;
        }
        let [left, right] = edges(map, i);
        for (edge, other) in [(left, right), (right, left)] {
            let width = libm::hypot(other[0] - edge[0], other[2] - edge[2]).max(1e-9);
            let (x, z) = (
                edge[0] + (other[0] - edge[0]) / width * PIER_INSET_M,
                edge[2] + (other[2] - edge[2]) / width * PIER_INSET_M,
            );
            let head = edge[1] - d.thickness_m;
            let ground = crate::jump::ground_height_m(&map.terrain, x, z);
            if head - ground < PIER_MIN_M {
                continue;
            }
            let open = lower.iter().all(|&j| {
                let q = &map.route.points[j];
                let reach = f64::from(q.width) / 2000.0 + PIER_CLEAR_M;
                libm::hypot(f64::from(q.x) / 1000.0 - x, f64::from(q.z) / 1000.0 - z) > reach
            });
            if open {
                out.push([x, z, ground - PIER_SINK_M, head]);
            }
        }
    }
    out
}

/// Pier spacing (route points), how far from each span end the first stands (route points), its half-width, how far
/// inside the deck edge it stands, the least deck height it holds up, its clearance from the lower road and how deep it
/// sinks into the ground, m.
const PIER_EVERY: usize = 8;
const PIER_END: usize = 4;
const PIER_HALF_M: f64 = 0.4;
const PIER_INSET_M: f64 = 1.2;
const PIER_MIN_M: f64 = 1.0;
const PIER_CLEAR_M: f64 = 2.5;
const PIER_SINK_M: f64 = 0.3;

/// Safety envelopes, not limits on the number of crossings or participants. Generated crossings additionally earn
/// their grades/clearance through running fixtures.
pub mod limits {
    pub const MIN_CLEARANCE_MM: i64 = 3_000;
    pub const MIN_THICKNESS_MM: i64 = 200;
    pub const MIN_BARRIER_HEIGHT_MM: i64 = 600;
    pub const MIN_BARRIER_WIDTH_MM: i64 = 200;
    pub const MAX_GRADE_MILLI: i64 = 200;
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BridgeDesign {
    pub upper: Span,
    pub lower: Span,
    pub thickness_m: f64,
    pub barrier_h: f64,
    pub barrier_w: f64,
    pub clearance_m: f64,
    pub max_grade: f64,
}

impl BridgeDesign {
    pub fn of(f: &Feature) -> Option<Self> {
        if f.kind != FeatureKind::Bridge {
            return None;
        }
        let p = |key: &str| f.params.get(key).copied();
        let index = |key| p(key).and_then(|v| u32::try_from(v).ok());
        Some(Self {
            upper: Span {
                from: index("upperFrom")?,
                to: index("upperTo")?,
            },
            lower: Span {
                from: index("lowerFrom")?,
                to: index("lowerTo")?,
            },
            thickness_m: p("thicknessMm")? as f64 / 1000.0,
            barrier_h: p("barrierHeightMm")? as f64 / 1000.0,
            barrier_w: p("barrierWidthMm")? as f64 / 1000.0,
            clearance_m: p("clearanceMm")? as f64 / 1000.0,
            max_grade: p("maxGradeMilli")? as f64 / 1000.0,
        })
    }
}

pub fn indices(map: &Map, span: Span) -> Option<Vec<usize>> {
    let n = map.route.points.len();
    let (a, b) = (span.from as usize, span.to as usize);
    if a >= n || b >= n || a == b || (!map.route.closed && a > b) {
        return None;
    }
    let count = (b + n - a) % n + 1;
    Some((0..count).map(|i| (a + i) % n).collect())
}

/// The actual left/right road edges at a route point, including bank; the side uses both neighbours, as the ribbon
/// renderer does, so consecutive sections share vertices even through a bend.
pub fn edges(map: &Map, i: usize) -> [[f64; 3]; 2] {
    let r = &map.route;
    let n = r.points.len();
    let a = &r.points[if r.closed {
        (i + n - 1) % n
    } else {
        i.saturating_sub(1)
    }];
    let b = &r.points[if r.closed {
        (i + 1) % n
    } else {
        (i + 1).min(n - 1)
    }];
    let (dx, dz) = (
        f64::from(b.x) - f64::from(a.x),
        f64::from(b.z) - f64::from(a.z),
    );
    let len = libm::hypot(dx, dz).max(1.0);
    let q = &r.points[i];
    let half = f64::from(q.width) / 2000.0;
    let bank = libm::tan(f64::from(q.bank) * core::f64::consts::PI / 18_000.0);
    [1.0, -1.0].map(|side| {
        [
            f64::from(q.x) / 1000.0 + side * dz / len * half,
            f64::from(q.y) / 1000.0 - side * bank * half,
            f64::from(q.z) / 1000.0 - side * dx / len * half,
        ]
    })
}

/// Closed, shared-vertex prisms: the deck and two continuous barriers, with end caps only at the span's ends.
pub fn bridge_mesh(map: &Map, f: &Feature) -> Option<JumpMesh> {
    let d = BridgeDesign::of(f)?;
    let ix = indices(map, d.upper)?;
    if d.thickness_m <= 0.0 || d.barrier_h <= 0.0 || d.barrier_w <= 0.0 {
        return None;
    }
    let mut verts = Vec::new();
    let mut tris = Vec::new();
    for beam in 0..3 {
        let start = verts.len() as u32;
        for &i in &ix {
            let [left, right] = edges(map, i);
            let (l, r, depth) = if beam == 0 {
                (left, right, d.thickness_m)
            } else {
                let (edge, sign) = if beam == 1 {
                    (left, 1.0)
                } else {
                    (right, -1.0)
                };
                let width = f64::from(map.route.points[i].width) / 1000.0;
                let offset = [
                    sign * (left[0] - right[0]) / width * d.barrier_w,
                    sign * (left[2] - right[2]) / width * d.barrier_w,
                ];
                let outer = [edge[0] + offset[0], edge[1], edge[2] + offset[1]];
                let (l, r) = if beam == 1 {
                    (outer, edge)
                } else {
                    (edge, outer)
                };
                (
                    [l[0], l[1] + d.barrier_h, l[2]],
                    [r[0], r[1] + d.barrier_h, r[2]],
                    d.barrier_h,
                )
            };
            verts.extend([l, r, [l[0], l[1] - depth, l[2]], [r[0], r[1] - depth, r[2]]]);
        }
        let mut quad = |a, b, c, e| {
            tris.extend([[a, b, c], [a, c, e]]);
        };
        for k in 0..ix.len() - 1 {
            let a = start + k as u32 * 4;
            quad(a + 1, a + 5, a + 4, a);
            quad(a + 2, a + 6, a + 7, a + 3);
            quad(a, a + 4, a + 6, a + 2);
            quad(a + 1, a + 3, a + 7, a + 5);
        }
        let end = start + (ix.len() as u32 - 1) * 4;
        quad(start, start + 2, start + 3, start + 1);
        quad(end, end + 1, end + 3, end + 2);
    }
    for [x, z, foot, head] in piers(map, &d, &ix) {
        let a = verts.len() as u32;
        for y in [foot, head] {
            verts.extend([
                [x - PIER_HALF_M, y, z - PIER_HALF_M],
                [x + PIER_HALF_M, y, z - PIER_HALF_M],
                [x + PIER_HALF_M, y, z + PIER_HALF_M],
                [x - PIER_HALF_M, y, z + PIER_HALF_M],
            ]);
        }
        let mut quad = |p: u32, q: u32, r: u32, e: u32| {
            tris.extend([[a + p, a + q, a + r], [a + p, a + r, a + e]]);
        };
        quad(0, 1, 2, 3);
        quad(4, 7, 6, 5);
        quad(0, 4, 5, 1);
        quad(1, 5, 6, 2);
        quad(2, 6, 7, 3);
        quad(3, 7, 4, 0);
    }
    Some((verts, tris))
}

pub fn problems(map: &Map, f: &Feature) -> Vec<String> {
    let Some(d) = BridgeDesign::of(f) else {
        return vec!["missing or invalid crossing params".into()];
    };
    let mut out = Vec::new();
    for (name, min) in [
        ("clearanceMm", limits::MIN_CLEARANCE_MM),
        ("thicknessMm", limits::MIN_THICKNESS_MM),
        ("barrierHeightMm", limits::MIN_BARRIER_HEIGHT_MM),
        ("barrierWidthMm", limits::MIN_BARRIER_WIDTH_MM),
    ] {
        if f.params[name] < min {
            out.push(format!("{name} must be at least {min}"));
        }
    }
    if f.params["maxGradeMilli"] <= 0 || f.params["maxGradeMilli"] > limits::MAX_GRADE_MILLI {
        out.push(format!(
            "maxGradeMilli must be in 1..={}",
            limits::MAX_GRADE_MILLI
        ));
    }
    let (Some(upper), Some(lower)) = (indices(map, d.upper), indices(map, d.lower)) else {
        out.push("crossing spans must be distinct valid route spans".into());
        return out;
    };
    if upper.iter().any(|i| lower.contains(i)) {
        out.push("upper and lower route spans must be disjoint".into());
        return out;
    }
    if map.terrain.cols >= 2
        && map.terrain.rows >= 2
        && map.terrain.spacing > 0
        && map.terrain.heights.len() == map.terrain.cols as usize * map.terrain.rows as usize
    {
        for &i in [upper.first().unwrap(), upper.last().unwrap()] {
            let connected_deck = map.features.iter().any(|other| {
                other != f
                    && BridgeDesign::of(other)
                        .and_then(|other| indices(map, other.upper))
                        .is_some_and(|ix| ix.contains(&i))
            });
            if connected_deck {
                continue;
            }
            for edge in edges(map, i) {
                let ground = crate::jump::ground_height_m(&map.terrain, edge[0], edge[2]);
                if (edge[1] - ground).abs() > 0.1 {
                    out.push(format!(
                        "upper endpoint {i} does not meet the ground or another deck"
                    ));
                    break;
                }
            }
        }
    }
    for pair in upper.windows(2) {
        let (a, b) = (&map.route.points[pair[0]], &map.route.points[pair[1]]);
        let run = libm::hypot(
            f64::from(b.x) - f64::from(a.x),
            f64::from(b.z) - f64::from(a.z),
        );
        let ea = edges(map, pair[0]);
        let eb = edges(map, pair[1]);
        if run <= 0.0
            || (0..2)
                .any(|side| (eb[side][1] - ea[side][1]).abs() > d.max_grade * run / 1000.0 + 0.002)
        {
            out.push(format!(
                "upper segment {} exceeds its maximum edge grade",
                pair[0]
            ));
        }
    }
    let mut overlaps = 0;
    let mut clearance = f64::INFINITY;
    for u in upper.windows(2) {
        for l in lower.windows(2) {
            for mut roof in road_triangles(map, u[0], u[1]) {
                for p in &mut roof {
                    p[1] -= d.thickness_m;
                }
                for road in road_triangles(map, l[0], l[1]) {
                    let poly = intersect(&roof.map(xz), &road.map(xz));
                    if poly.len() < 3 || area(&poly).abs() < 1e-8 {
                        continue;
                    }
                    overlaps += 1;
                    for &p in &poly {
                        clearance = clearance.min(height(&roof, p) - height(&road, p));
                    }
                    // Check the real lower heightfield too: route data cannot declare clearance through solid ground.
                    // Both cell diagonals are tested, conservatively covering Rapier's triangle orientation and the
                    // renderer's bilinear road ribbon. Each linear difference is extremal at a clipped polygon vertex.
                    let t = &map.terrain;
                    if t.cols < 2
                        || t.rows < 2
                        || t.spacing == 0
                        || t.heights.len() != t.cols as usize * t.rows as usize
                    {
                        continue;
                    }
                    let sp = f64::from(t.spacing) / 1000.0;
                    let (ox, oz) = (
                        f64::from(t.origin_x) / 1000.0,
                        f64::from(t.origin_z) / 1000.0,
                    );
                    let bound = |axis: usize, max: bool, origin: f64, n: u32| {
                        let p = poly
                            .iter()
                            .map(|p| p[axis])
                            .reduce(if max { f64::max } else { f64::min })
                            .unwrap();
                        (libm::floor((p - origin) / sp).max(0.0) as usize).min(n as usize - 2)
                    };
                    for r in bound(1, false, oz, t.rows)..=bound(1, true, oz, t.rows) {
                        for c in bound(0, false, ox, t.cols)..=bound(0, true, ox, t.cols) {
                            let v = |cc: usize, rr: usize| {
                                [
                                    ox + cc as f64 * sp,
                                    f64::from(t.heights[rr * t.cols as usize + cc]) / 100.0,
                                    oz + rr as f64 * sp,
                                ]
                            };
                            let [a, b, c, e] = [v(c, r), v(c + 1, r), v(c, r + 1), v(c + 1, r + 1)];
                            for ground in [[a, c, b], [c, e, b], [a, c, e], [a, e, b]] {
                                for p in intersect(&poly, &ground.map(xz)) {
                                    clearance =
                                        clearance.min(height(&roof, p) - height(&ground, p));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if overlaps == 0 {
        out.push("declared route spans do not cross beneath the deck".into());
    } else if clearance + 0.002 < d.clearance_m {
        out.push(format!(
            "lower-road clearance {clearance:.3}m is below declared {:.3}m",
            d.clearance_m
        ));
    }
    out
}

fn road_triangles(map: &Map, a: usize, b: usize) -> [[[f64; 3]; 3]; 2] {
    let [al, ar] = edges(map, a);
    let [bl, br] = edges(map, b);
    [[ar, br, bl], [ar, bl, al]]
}

fn xz(p: [f64; 3]) -> [f64; 2] {
    [p[0], p[2]]
}
fn cross(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}
fn area(poly: &[[f64; 2]]) -> f64 {
    (0..poly.len())
        .map(|i| {
            let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
            a[0] * b[1] - a[1] * b[0]
        })
        .sum()
}
/// Convex polygon clipping in the map plane; no fixed vertex/count budget.
fn intersect(subject: &[[f64; 2]], clip: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let mut poly = subject.to_vec();
    let sign = area(clip).signum();
    for i in 0..clip.len() {
        let (a, b) = (clip[i], clip[(i + 1) % clip.len()]);
        let old = std::mem::take(&mut poly);
        if old.is_empty() {
            break;
        }
        for j in 0..old.len() {
            let (s, e) = (old[j], old[(j + 1) % old.len()]);
            let (ds, de) = (cross(a, b, s) * sign, cross(a, b, e) * sign);
            let (si, ei) = (ds >= -1e-9, de >= -1e-9);
            if si != ei {
                let t = ds / (ds - de);
                poly.push([s[0] + t * (e[0] - s[0]), s[1] + t * (e[1] - s[1])]);
            }
            if ei {
                poly.push(e);
            }
        }
    }
    poly
}
fn height(tri: &[[f64; 3]; 3], p: [f64; 2]) -> f64 {
    let [a, b, c] = tri.map(xz);
    let den = cross(a, b, c);
    if den.abs() < 1e-12 {
        return tri.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
    }
    let w = [
        cross(b, c, p) / den,
        cross(c, a, p) / den,
        cross(a, b, p) / den,
    ];
    (0..3).map(|i| w[i] * tri[i][1]).sum()
}
