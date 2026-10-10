//! Sharp jump geometry (br-gw74.7.1): a tabletop jump is not written into the 2.5 m height grid, which rounds a 4 m
//! wide ramp's lip into a hump. Instead the feature's parameters describe exact geometry that the sim collides with
//! (convex pieces) and the renderer draws (the same pieces): a kicker ramp, a table at lip height and a landing ramp
//! back down to the ground, all measured above the natural ground the grid carries. A jump whose params carry
//! `sharp = 1` has this geometry; older hand-made jumps (no `sharp`) are still baked into the grid.
//!
//! Frame: the pose's route point is `u = 0`; `u` runs along the route (the polyline, so a gentle bend inside the
//! envelope is followed) and `lat` to the left of the direction of travel. Heights are metres above the ground.
//! `f64` and `libm` only, so native and WASM agree to the bit.

use crate::model::{Feature, FeatureKind, Map, Terrain};

/// Sideways slope at the edge of the ramp, table and landing ramp: height falls to the ground over this distance, so a
/// car that leaves the line drives off the edge instead of dropping off a wall.
pub const EDGE_SLOPE_M: f64 = 1.5;
/// Slice spacing along the curved ramp, m.
const RAMP_STEP_M: f64 = 0.25;

/// The sharp jump's design, read from a feature's params.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct JumpDesign {
    /// Ramp length, m.
    pub ramp_m: f64,
    /// Ramp's flat width at the top, m.
    pub ramp_w: f64,
    /// Height of the lip (and the table), m.
    pub lip: f64,
    /// Table length, m.
    pub table_m: f64,
    /// Table and landing ramp flat width, m.
    pub land_w: f64,
    /// Landing ramp horizontal run, m (lip over the down slope).
    pub down_m: f64,
    /// Length of the concave transition at the ramp's foot, m: the ground curves up into the ramp's slope over it
    /// (a parabola), so a car's nose never meets a kink.
    pub blend_m: f64,
}

impl JumpDesign {
    /// The design of a sharp jump, `None` for other features and for older jumps baked into the grid.
    pub fn of(f: &Feature) -> Option<Self> {
        if f.kind != FeatureKind::Jump {
            return None;
        }
        let get = |k: &str| f.params.get(k).copied();
        if get("sharp")? != 1 {
            return None;
        }
        let m = |k: &str| get(k).map(|v| v as f64 / 1000.0);
        let lip = get("lipHeightCm")? as f64 / 100.0;
        Some(Self {
            ramp_m: m("rampLengthMm")?,
            ramp_w: m("rampWidthMm")?,
            lip,
            table_m: m("tableLengthMm")?,
            land_w: m("landingWidthMm")?,
            down_m: lip / m("downSlopeMilli")?,
            blend_m: m("blendMm")?,
        })
    }

    /// The ramp's slope at the lip over its mean slope (a straight wedge is 1): what the launch angle gains from the
    /// blend at the foot.
    pub fn exit_slope_factor(&self) -> f64 {
        self.ramp_m / (self.ramp_m - self.blend_m / 2.0)
    }

    /// Total length of ramp, table and landing ramp, m.
    pub fn length_m(&self) -> f64 {
        self.ramp_m + self.table_m + self.down_m
    }

    /// Height along the centerline (m) before any edge slope: the kicker, the table, the landing ramp.
    pub fn profile(&self, u: f64) -> f64 {
        if u < 0.0 || u > self.length_m() {
            0.0
        } else if u <= self.ramp_m {
            let (l, a) = (self.ramp_m, self.blend_m);
            let slope = self.lip / (l - a / 2.0);
            if u < a {
                slope * u * u / (2.0 * a)
            } else {
                slope * (u - a / 2.0)
            }
        } else if u <= self.ramp_m + self.table_m {
            self.lip
        } else {
            self.lip * (1.0 - (u - self.ramp_m - self.table_m) / self.down_m)
        }
    }

    /// The edge factor (1 inside the flat width `w`, 0 at the foot of the side slope) at `lat`.
    pub fn side(w: f64, lat: f64) -> f64 {
        ((w / 2.0 + EDGE_SLOPE_M - libm::fabs(lat)) / EDGE_SLOPE_M).clamp(0.0, 1.0)
    }

    /// The surface height above the ground (m) at `u` along the jump and `lat` from the centerline.
    pub fn height(&self, u: f64, lat: f64) -> f64 {
        let w = if u <= self.ramp_m {
            self.ramp_w
        } else {
            self.land_w
        };
        self.profile(u) * Self::side(w, lat)
    }
}

/// The terrain's height (m) at (x, z), bilinear over the grid (the ground a jump stands on).
pub fn ground_height_m(t: &Terrain, x: f64, z: f64) -> f64 {
    let sp = f64::from(t.spacing) / 1000.0;
    let c = ((x - f64::from(t.origin_x) / 1000.0) / sp).clamp(0.0, f64::from(t.cols - 1));
    let r = ((z - f64::from(t.origin_z) / 1000.0) / sp).clamp(0.0, f64::from(t.rows - 1));
    let (c0, r0) = (libm::floor(c) as usize, libm::floor(r) as usize);
    let (c1, r1) = (
        (c0 + 1).min(t.cols as usize - 1),
        (r0 + 1).min(t.rows as usize - 1),
    );
    let (fc, fr) = (c - c0 as f64, r - r0 as f64);
    let g = |cc: usize, rr: usize| f64::from(t.heights[rr * t.cols as usize + cc]) / 100.0;
    let top = g(c0, r0) + (g(c1, r0) - g(c0, r0)) * fc;
    let bot = g(c0, r1) + (g(c1, r1) - g(c0, r1)) * fc;
    top + (bot - top) * fr
}

/// A point on the route polyline `u` metres beyond route point `base`: position (m) and unit tangent. An open route's
/// end extends straight on.
fn along(map: &Map, base: usize, u: f64) -> ([f64; 2], [f64; 2]) {
    let pts = &map.route.points;
    let n = pts.len();
    let p = |i: usize| {
        let q = &pts[i % n];
        [f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0]
    };
    let (mut i, mut rest) = (base, u.max(0.0));
    loop {
        let open_end = !map.route.closed && i + 1 >= n;
        let (a, b) = if open_end {
            (p(n - 2), p(n - 1))
        } else {
            (p(i), p(i + 1))
        };
        let len = libm::hypot(b[0] - a[0], b[1] - a[1]).max(1e-9);
        if open_end || rest <= len || i > base + n {
            let t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
            let o = if open_end { b } else { a };
            return ([o[0] + t[0] * rest, o[1] + t[1] * rest], t);
        }
        rest -= len;
        i += 1;
    }
}

/// How far (m) the surface of a sharp jump stands above the ground at (x, z): 0 outside the jump's footprint. For
/// placing anything that stands on the road (props, dressing) on the jump instead of inside it.
pub fn height_above_ground_m(route: &crate::model::Route, f: &Feature, x: f64, z: f64) -> f64 {
    let Some(d) = JumpDesign::of(f) else {
        return 0.0;
    };
    let pts = &route.points;
    let n = pts.len();
    let base = nearest_point(route, f);
    let reach = d.land_w / 2.0 + EDGE_SLOPE_M;
    let (mut run, mut best) = (0.0, (f64::INFINITY, 0.0, 0.0));
    let mut i = base;
    while run <= d.length_m() && (route.closed || i + 1 < n) && i < base + n {
        let (a, b) = (&pts[i % n], &pts[(i + 1) % n]);
        let (ax, az) = (f64::from(a.x) / 1000.0, f64::from(a.z) / 1000.0);
        let (dx, dz) = (f64::from(b.x) / 1000.0 - ax, f64::from(b.z) / 1000.0 - az);
        let len = libm::hypot(dx, dz).max(1e-9);
        let (tx, tz) = (dx / len, dz / len);
        let (px, pz) = (x - ax, z - az);
        let along = (px * tx + pz * tz).clamp(0.0, len);
        let lat = -px * tz + pz * tx;
        let off = libm::hypot(px - along * tx, pz - along * tz);
        if off < best.0 {
            best = (off, run + along, lat);
        }
        run += len;
        i += 1;
    }
    if best.0 > reach {
        return 0.0;
    }
    d.height(best.1, best.2)
}

/// The route point nearest a feature's pose.
fn base_index(map: &Map, f: &Feature) -> usize {
    nearest_point(&map.route, f)
}

fn nearest_point(route: &crate::model::Route, f: &Feature) -> usize {
    let d = |i: usize| {
        let q = &route.points[i];
        let (dx, dz) = (i64::from(q.x - f.pose.x), i64::from(q.z - f.pose.z));
        dx * dx + dz * dz
    };
    (0..route.points.len()).min_by_key(|&i| d(i)).unwrap_or(0)
}

/// The surface point of a sharp jump (x, y, z in metres) at `u` and `lat`: ground plus the design's height.
pub fn surface_point(map: &Map, f: &Feature, d: &JumpDesign, u: f64, lat: f64) -> [f64; 3] {
    let (c, t) = along(map, base_index(map, f), u);
    let (x, z) = (c[0] - t[1] * lat, c[1] + t[0] * lat);
    [x, ground_height_m(&map.terrain, x, z) + d.height(u, lat), z]
}

/// A sharp jump as one triangle mesh (positions in metres, counter-clockwise from above): cross-sections every 25 cm up
/// the ramp, then the table and the landing ramp. A cross-section is four points, the flat top's two edges and the foot
/// of each sloped side; the table also gets a front skirt down to the ground at the lip, where it is wider than the
/// ramp. The sim collides with exactly these triangles and the renderer draws them.
pub fn jump_mesh(map: &Map, f: &Feature) -> Option<(Vec<[f64; 3]>, Vec<[u32; 3]>)> {
    let d = JumpDesign::of(f)?;
    let base = base_index(map, f);
    let mut verts: Vec<[f64; 3]> = Vec::new();
    let mut tris: Vec<[u32; 3]> = Vec::new();
    let section = |u: f64, w: f64, verts: &mut Vec<[f64; 3]>| -> u32 {
        let first = verts.len() as u32;
        let (c, t) = along(map, base, u);
        for lat in [
            -w / 2.0 - EDGE_SLOPE_M,
            -w / 2.0,
            w / 2.0,
            w / 2.0 + EDGE_SLOPE_M,
        ] {
            let (x, z) = (c[0] - t[1] * lat, c[1] + t[0] * lat);
            let g = ground_height_m(&map.terrain, x, z);
            verts.push([x, g + d.profile(u) * JumpDesign::side(w, lat), z]);
        }
        first
    };
    let strip = |a: u32, b: u32, verts: &Vec<[f64; 3]>, tris: &mut Vec<[u32; 3]>| {
        for j in 0..3 {
            let (a0, a1, b0, b1) = (a + j, a + j + 1, b + j, b + j + 1);
            for tri in [[a0, b0, a1], [a1, b0, b1]] {
                let [p, q, r] = tri.map(|i| verts[i as usize]);
                let ny = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
                tris.push(if ny >= 0.0 {
                    tri
                } else {
                    [tri[0], tri[2], tri[1]]
                });
            }
        }
    };
    let steps = libm::ceil(d.ramp_m / RAMP_STEP_M) as usize;
    let mut prev = section(0.0, d.ramp_w, &mut verts);
    for k in 1..=steps {
        let u = d.ramp_m * k as f64 / steps as f64;
        let next = section(u, d.ramp_w, &mut verts);
        strip(prev, next, &verts, &mut tris);
        prev = next;
    }
    let (t0, t1) = (d.ramp_m, d.ramp_m + d.table_m);
    let mut prev = section(t0, d.land_w, &mut verts);
    // The front skirt: the table's first section dropped to the ground, so the wider table has a wall at the lip.
    let skirt = verts.len() as u32;
    for j in 0..4 {
        let v = verts[(prev + j) as usize];
        let g = ground_height_m(&map.terrain, v[0], v[2]);
        verts.push([v[0], g, v[2]]);
    }
    for j in 0..3 {
        let (a0, a1, b0, b1) = (prev + j, prev + j + 1, skirt + j, skirt + j + 1);
        tris.push([a0, b0, a1]);
        tris.push([a1, b0, b1]);
    }
    for u in [t1, d.length_m()] {
        let next = section(u, d.land_w, &mut verts);
        strip(prev, next, &verts, &mut tris);
        prev = next;
    }
    Some((verts, tris))
}
