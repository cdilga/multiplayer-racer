//! Plan-view route geometry for the validator: arc length, nearest point, lateral offset, footprints. Millimetres as
//! `f64` (IEEE maths is identical natively and in WASM, so validation decides alike everywhere).

use crate::kit::Footprint;
use crate::model::{Pose, Route};

#[derive(Clone, Copy, Debug)]
pub struct Near {
    /// Arc length along the route to the nearest point.
    pub s: f64,
    /// Signed distance from the centerline; positive on the (−tz, tx) side of the tangent.
    pub lateral: f64,
    /// Half the drivable width there.
    pub half: f64,
}

pub struct RouteGeom {
    pts: Vec<(f64, f64)>,
    half: Vec<f64>,
    /// Cumulative arc length at each point; one more entry (the closing point) on a closed route.
    s: Vec<f64>,
    closed: bool,
    pub total: f64,
}

impl RouteGeom {
    pub fn new(route: &Route) -> Self {
        let pts: Vec<(f64, f64)> = route
            .points
            .iter()
            .map(|p| (f64::from(p.x), f64::from(p.z)))
            .collect();
        let half: Vec<f64> = route
            .points
            .iter()
            .map(|p| f64::from(p.width) / 2.0)
            .collect();
        let n = pts.len();
        let segs = if route.closed { n } else { n.saturating_sub(1) };
        let mut s = vec![0.0];
        for i in 0..segs {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            s.push(s[i] + (b.0 - a.0).hypot(b.1 - a.1));
        }
        let total = *s.last().unwrap_or(&0.0);
        Self {
            pts,
            half,
            s,
            closed: route.closed,
            total,
        }
    }

    fn segs(&self) -> usize {
        self.s.len() - 1
    }

    /// Arc length at centerline point `i`.
    pub fn s_of(&self, i: usize) -> f64 {
        self.s.get(i).copied().unwrap_or(self.total)
    }

    pub fn nearest(&self, x: f64, z: f64) -> Near {
        let n = self.pts.len();
        // Seed an upper bound with the projection closest in max-coordinate distance. This cheap
        // pass avoids evaluating software hypot for every successively closer segment on a long
        // route. The bound is an actual candidate's hypot, not an approximation to the answer.
        let mut closest = (f64::INFINITY, f64::INFINITY);
        let mut closest_max = f64::INFINITY;
        for i in 0..self.segs() {
            let (a, b) = (self.pts[i], self.pts[(i + 1) % n]);
            let (dx, dz) = (b.0 - a.0, b.1 - a.1);
            let len2 = dx * dx + dz * dz;
            if len2 == 0.0 {
                continue;
            }
            let t = (((x - a.0) * dx + (z - a.1) * dz) / len2).clamp(0.0, 1.0);
            let delta = (x - (a.0 + t * dx), z - (a.1 + t * dz));
            let max = delta.0.abs().max(delta.1.abs());
            if max < closest_max {
                closest_max = max;
                closest = delta;
            }
        }
        let mut bound = closest.0.hypot(closest.1);
        let mut best = Near {
            s: 0.0,
            lateral: f64::INFINITY,
            half: 0.0,
        };
        let mut best_d = f64::INFINITY;
        for i in 0..self.segs() {
            let (a, b) = (self.pts[i], self.pts[(i + 1) % n]);
            let (dx, dz) = (b.0 - a.0, b.1 - a.1);
            let len2 = dx * dx + dz * dz;
            if len2 == 0.0 {
                continue;
            }
            let t = (((x - a.0) * dx + (z - a.1) * dz) / len2).clamp(0.0, 1.0);
            let (px, pz) = (a.0 + t * dx, a.1 + t * dz);
            // Either coordinate alone is a lower bound on the Euclidean distance. Keep the exact hypot
            // comparison (and its first-segment tie break) for every candidate that can still win; distant
            // projections need no software hypot/FMA in WASM.
            if (x - px).abs() > bound || (z - pz).abs() > bound {
                continue;
            }
            let d = (x - px).hypot(z - pz);
            if d < best_d {
                best_d = d;
                bound = bound.min(d);
                let len = len2.sqrt();
                let (tx, tz) = (dx / len, dz / len);
                let lateral = (x - px) * -tz + (z - pz) * tx;
                let half = self.half[i] + t * (self.half[(i + 1) % n] - self.half[i]);
                best = Near {
                    s: self.s[i] + t * len,
                    lateral,
                    half,
                };
            }
        }
        best
    }

    /// Position and unit tangent at arc length `s` (wrapping on a closed route, clamped otherwise).
    pub fn at(&self, s: f64) -> ((f64, f64), (f64, f64), f64) {
        let n = self.pts.len();
        let s = if self.closed && self.total > 0.0 {
            s.rem_euclid(self.total)
        } else {
            s.clamp(0.0, self.total)
        };
        let i = match self.s.binary_search_by(|v| v.total_cmp(&s)) {
            Ok(i) => i.min(self.segs().saturating_sub(1)),
            Err(i) => i.saturating_sub(1).min(self.segs().saturating_sub(1)),
        };
        let (a, b) = (self.pts[i], self.pts[(i + 1) % n]);
        let len = (b.0 - a.0).hypot(b.1 - a.1).max(1e-9);
        let t = ((s - self.s[i]) / len).clamp(0.0, 1.0);
        let half = self.half[i] + t * (self.half[(i + 1) % n] - self.half[i]);
        (
            (a.0 + t * (b.0 - a.0), a.1 + t * (b.1 - a.1)),
            ((b.0 - a.0) / len, (b.1 - a.1) / len),
            half,
        )
    }

    /// True when arc length `s` lies in `[from, to]`, going forward from `from` (wrapping on a closed route).
    pub fn in_range(&self, s: f64, from: f64, to: f64) -> bool {
        if !self.closed || self.total <= 0.0 {
            return s >= from && s <= to;
        }
        let w = |v: f64| v.rem_euclid(self.total);
        let (s, from, len) = (w(s), w(from), to - from);
        if len >= self.total {
            return true;
        }
        (s - from).rem_euclid(self.total) <= len
    }

    /// Smallest half width sampled along `[from, to]` every 1 m.
    pub fn min_half(&self, from: f64, to: f64) -> f64 {
        let steps = (((to - from) / 1000.0).ceil() as usize).max(1);
        (0..=steps)
            .map(|k| self.at(from + (to - from) * k as f64 / steps as f64).2)
            .fold(f64::INFINITY, f64::min)
    }

    pub fn point(&self, i: usize) -> (f64, f64) {
        self.pts[i]
    }

    pub fn closed(&self) -> bool {
        self.closed
    }
}

/// Sample points covering a footprint at a pose (corners, edge midpoints and centre; or a ring for a circle).
pub fn footprint_points(fp: &Footprint, pose: &Pose) -> Vec<(f64, f64)> {
    let (x0, z0) = (f64::from(pose.x), f64::from(pose.z));
    let yaw = f64::from(pose.yaw) / 100.0 * core::f64::consts::PI / 180.0;
    let (c, s) = (yaw.cos(), yaw.sin());
    let local: Vec<(f64, f64)> = match *fp {
        Footprint::Rect { x, z, .. } => {
            let (hx, hz) = (x / 2.0, z / 2.0);
            [
                (-1.0, -1.0),
                (1.0, -1.0),
                (1.0, 1.0),
                (-1.0, 1.0),
                (0.0, -1.0),
                (1.0, 0.0),
                (0.0, 1.0),
                (-1.0, 0.0),
                (0.0, 0.0),
            ]
            .iter()
            .map(|(a, b)| (a * hx, b * hz))
            .collect()
        }
        Footprint::Circle { radius, .. } => {
            let mut v: Vec<(f64, f64)> = (0..8)
                .map(|k| f64::from(k) * core::f64::consts::FRAC_PI_4)
                .map(|a| (radius * a.cos(), radius * a.sin()))
                .collect();
            v.push((0.0, 0.0));
            v
        }
    };
    local
        .into_iter()
        .map(|(lx, lz)| (x0 + lx * c - lz * s, z0 + lx * s + lz * c))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Original exhaustive implementation: a regression oracle for ordering and IEEE rounding.
    fn exhaustive(g: &RouteGeom, x: f64, z: f64) -> Near {
        let n = g.pts.len();
        let mut best = Near {
            s: 0.0,
            lateral: f64::INFINITY,
            half: 0.0,
        };
        let mut best_d = f64::INFINITY;
        for i in 0..g.segs() {
            let (a, b) = (g.pts[i], g.pts[(i + 1) % n]);
            let (dx, dz) = (b.0 - a.0, b.1 - a.1);
            let len2 = dx * dx + dz * dz;
            if len2 == 0.0 {
                continue;
            }
            let t = (((x - a.0) * dx + (z - a.1) * dz) / len2).clamp(0.0, 1.0);
            let (px, pz) = (a.0 + t * dx, a.1 + t * dz);
            let d = (x - px).hypot(z - pz);
            if d < best_d {
                best_d = d;
                let len = len2.sqrt();
                let (tx, tz) = (dx / len, dz / len);
                best = Near {
                    s: g.s[i] + t * len,
                    lateral: (x - px) * -tz + (z - pz) * tx,
                    half: g.half[i] + t * (g.half[(i + 1) % n] - g.half[i]),
                };
            }
        }
        best
    }

    #[test]
    fn nearest_bound_matches_exhaustive_bits_across_generated_routes() {
        for seed in 0..16 {
            let points = (0..129)
                .map(|i| {
                    let a = i as f64 * 0.05;
                    let radius = 10_000.0 + ((i * 37 + seed * 91) % 1000) as f64;
                    (radius * a.cos(), radius * a.sin())
                })
                .collect::<Vec<_>>();
            for closed in [false, true] {
                let mut s = vec![0.0];
                let count = if closed {
                    points.len()
                } else {
                    points.len() - 1
                };
                for i in 0..count {
                    let (a, b) = (points[i], points[(i + 1) % points.len()]);
                    s.push(s[i] + (b.0 - a.0).hypot(b.1 - a.1));
                }
                let g = RouteGeom {
                    half: (0..points.len()).map(|i| 2000.0 + i as f64).collect(),
                    pts: points.clone(),
                    total: *s.last().unwrap(),
                    s,
                    closed,
                };
                for x in -10..=10 {
                    for z in -10..=10 {
                        let (x, z) = (x as f64 * 1273.125, z as f64 * 1719.75);
                        let actual = g.nearest(x, z);
                        let expected = exhaustive(&g, x, z);
                        assert_eq!(
                            [
                                actual.s.to_bits(),
                                actual.lateral.to_bits(),
                                actual.half.to_bits()
                            ],
                            [
                                expected.s.to_bits(),
                                expected.lateral.to_bits(),
                                expected.half.to_bits()
                            ],
                            "seed {seed}, closed {closed}, ({x}, {z})"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn nearest_keeps_equal_distance_order_and_interpolated_widths() {
        // An asymmetric-width rectangle with a duplicate point (zero-length segment).
        let g = RouteGeom {
            pts: vec![
                (-10.0, -5.0),
                (10.0, -5.0),
                (10.0, 5.0),
                (-10.0, 5.0),
                (-10.0, 5.0),
            ],
            half: vec![2.0, 4.0, 6.0, 8.0, 8.0],
            s: vec![0.0, 20.0, 30.0, 50.0, 50.0, 60.0],
            closed: true,
            total: 60.0,
        };
        for (x, z, s, lateral, half) in [
            (0.0, 0.0, 10.0, 5.0, 3.0), // Equal top/bottom: first segment wins.
            (0.0, -5.0, 10.0, 0.0, 3.0),
            (0.0, 5.0, 40.0, 0.0, 7.0),
            (10.0, 0.0, 25.0, 0.0, 5.0),
            (-10.0, 0.0, 55.0, 0.0, 5.0),
            (15.0, 9.0, 30.0, -5.0, 6.0), // Shared endpoint: first adjacent segment wins.
            (1e9, 0.0, 20.0, 5.0, 4.0), // Rounded distances tie here too; don't change to squared distances.
        ] {
            let near = g.nearest(x, z);
            assert_eq!(
                (near.s, near.lateral, near.half),
                (s, lateral, half),
                "({x}, {z})"
            );
        }
    }
}
