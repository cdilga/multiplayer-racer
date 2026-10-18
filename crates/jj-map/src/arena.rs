//! The derby bowl (P1-M10): an arena is a `jj.map.v1` whose only world geometry beyond a flat floor is one `bowl` feature,
//! a revolved profile that keeps every car in by its shape alone (passive containment: no shrinking wall, no closing ring).
//!
//! The profile, seen from the centre outwards (heights above the floor):
//!
//! ```text
//!                      lip (flat top, `lipWidthMm`)
//!                  ┌──────────┐
//!                  │          │  outer face (down below the floor: the shell is closed, so nothing tunnels in)
//!      vertical    │
//!      top wall    │
//!                  │
//!           ______/  ← quarter-circle bank (`bankRadiusMm`), tangent to the floor and to the wall
//!   floor ─────
//! ```
//!
//! The floor runs into the bank tangentially and the bank into the wall tangentially, so the profile only ever curves one
//! way, up and over: no inverted concavity anywhere a car can reach (0.1's flat→wall join was a kink that caught cars).
//! The floor itself is the map's heightfield; the mesh starts at the foot of the bank. The floor is flat for
//! [`limits::FLAT_RIM_M`] in from the foot of the bank (the spawn ring and the run-up to the bank); inside that it may
//! carry relief (P1-M-arena-features: table-tops, kickers, mounds and dips), held to the relief limits below so nothing
//! traps a car or hides one from the Overview. The collider is exactly
//! [`bowl_mesh`]'s triangles and the renderer draws the same pieces. `f64` and `libm` only, so native and WASM agree to
//! the bit. Size follows the car count at preparation ([`floor_radius_for`]): never reshaped under cars.
//!
//! Params (integers, like every feature): `floorRadiusMm`, `bankRadiusMm`, `wallHeightCm`, `lipWidthMm`.

use crate::jump::JumpMesh;
use crate::model::{Feature, FeatureKind, Map};

/// Segments along the quarter-circle bank (3.75 degrees each).
pub const BANK_STEPS: usize = 24;
/// Longest triangle edge along the vertical wall, m.
const WALL_STEP_M: f64 = 2.0;
/// Chord length around the ring at the outer edge, m.
const RING_CHORD_M: f64 = 1.25;
/// How far below the floor the outer face reaches, m: a closed shell.
const SKIRT_M: f64 = 2.0;

/// Thresholds of the arena rules. DEFAULT values, TUNE at the derby playtests; a change is a data change with a fixture.
pub mod limits {
    /// The bank is at least this tight a circle (a car's wheelbase needs room to follow it).
    pub const MIN_BANK_RADIUS_MM: i64 = 6_000;
    pub const MAX_BANK_RADIUS_MM: i64 = 40_000;
    /// The floor is at least this wide.
    pub const MIN_FLOOR_RADIUS_MM: i64 = 12_000;
    /// The wall above the bank, cm. With the bank it must out-reach a boosted car's vertical climb off the bank top
    /// (the `bowl-containment` fixture is the proof).
    pub const MIN_WALL_HEIGHT_CM: i64 = 600;
    pub const MIN_LIP_WIDTH_MM: i64 = 1_500;
    /// The lip stands at least this far above the floor, cm: a car launched up at [`DESIGN_LAUNCH_UP_MPS`] from
    /// [`DESIGN_LAUNCH_LIFT_M`] above the floor peaks at 14 m, and the lip is a metre clear of that. Nothing in the first
    /// derby launches harder (the biggest jump in the game has a 3 m lip); the `bowl-containment` fixtures fly this envelope.
    pub const MIN_TOP_HEIGHT_CM: i64 = 1_500;
    pub const DESIGN_LAUNCH_UP_MPS: f64 = 14.0;
    pub const DESIGN_LAUNCH_LIFT_M: f64 = 4.0;
    /// Floor area per car at preparation (m²): the bowl grows with N, no cap.
    pub const FLOOR_AREA_PER_CAR_M2: f64 = 90.0;
    /// The smallest floor radius whatever N (m): eight cars still have room to run.
    pub const FLOOR_RADIUS_MIN_M: f64 = 18.0;
    /// The floor is flat (at the bowl's base height) this far in from the foot of the bank, m: the spawn ring and the
    /// run-up to the bank. Relief lives inside it.
    pub const FLAT_RIM_M: f64 = 10.0;
    /// The floor's relief stands at most this far above the base, cm: the Overview (P1-R11) looks down at about 60
    /// degrees, so a 2 m rise shades at most 2 / tan 60 = 1.2 m behind it, less than a car's width: no car hides.
    pub const MAX_RISE_CM: i64 = 200;
    /// A dip goes at most this far below the base, cm (with the slope limit, a car always drives out).
    pub const MAX_DIP_CM: i64 = 100;
    /// The steepest the relief gets between neighbouring height samples (rise over run): about 31 degrees, which a car
    /// drives up from rest, so no dip or pocket traps it.
    pub const MAX_RELIEF_SLOPE: f64 = 0.6;
}

/// The floor radius (m) for `cars` cars at preparation: area per car, with a floor under it. Any N, no cap.
pub fn floor_radius_for(cars: usize) -> f64 {
    let r = libm::sqrt(cars as f64 * limits::FLOOR_AREA_PER_CAR_M2 / core::f64::consts::PI);
    libm::ceil(r.max(limits::FLOOR_RADIUS_MIN_M))
}

/// A bowl's design, read from a feature's params (metres).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BowlDesign {
    /// Centre of the bowl, m (x, z), and the floor's height.
    pub cx: f64,
    pub cz: f64,
    pub base_y: f64,
    pub floor_r: f64,
    pub bank_r: f64,
    pub wall_h: f64,
    pub lip_w: f64,
}

impl BowlDesign {
    /// The design of a `bowl` feature; `None` for other kinds and for missing params.
    pub fn of(f: &Feature) -> Option<Self> {
        if f.kind != FeatureKind::Bowl {
            return None;
        }
        let p = |k: &str| f.params.get(k).copied();
        Some(Self {
            cx: f64::from(f.pose.x) / 1000.0,
            cz: f64::from(f.pose.z) / 1000.0,
            base_y: f64::from(f.pose.y) / 1000.0,
            floor_r: p("floorRadiusMm")? as f64 / 1000.0,
            bank_r: p("bankRadiusMm")? as f64 / 1000.0,
            wall_h: p("wallHeightCm")? as f64 / 100.0,
            lip_w: p("lipWidthMm")? as f64 / 1000.0,
        })
    }

    /// Radius of the vertical wall's face, m: where the bank ends.
    pub fn wall_r(&self) -> f64 {
        self.floor_r + self.bank_r
    }

    /// Radius of the lip's outer edge, m.
    pub fn outer_r(&self) -> f64 {
        self.wall_r() + self.lip_w
    }

    /// Height of the lip above the floor, m.
    pub fn top_h(&self) -> f64 {
        self.bank_r + self.wall_h
    }

    /// The profile's corner points `(radius, height above the floor)` from the foot of the bank outwards: the bank's arc,
    /// the wall (split to short edges), the lip's outer edge and the foot of the outer face, below the floor.
    pub fn profile(&self) -> Vec<(f64, f64)> {
        let mut pts = Vec::with_capacity(BANK_STEPS + 8);
        for k in 0..=BANK_STEPS {
            let a = core::f64::consts::FRAC_PI_2 * k as f64 / BANK_STEPS as f64;
            pts.push((
                self.floor_r + self.bank_r * libm::sin(a),
                self.bank_r * (1.0 - libm::cos(a)),
            ));
        }
        // The arc's last point is on the wall's radius exactly (sin(pi/2) = 1 in libm).
        let wall_r = self.wall_r();
        if let Some(last) = pts.last_mut() {
            *last = (wall_r, self.bank_r);
        }
        let cuts = libm::ceil(self.wall_h / WALL_STEP_M).max(1.0) as usize;
        for k in 1..=cuts {
            pts.push((wall_r, self.bank_r + self.wall_h * k as f64 / cuts as f64));
        }
        pts.push((self.outer_r(), self.top_h()));
        pts.push((self.outer_r(), -SKIRT_M));
        pts
    }

    /// How many points of [`profile`](Self::profile) belong to the inside (the bank and the wall, up to the lip's inner
    /// edge): the part a car touches, and the part whose curvature must not invert.
    pub fn inner_len(&self) -> usize {
        let cuts = libm::ceil(self.wall_h / WALL_STEP_M).max(1.0) as usize;
        BANK_STEPS + 1 + cuts
    }

    /// The surface height above the floor (m) at plan-view radius `r` for the inside of the bowl: 0 on the floor, the
    /// bank's circle, then the wall's top height from the wall outwards (the wall itself is vertical).
    pub fn height_at(&self, r: f64) -> f64 {
        if r <= self.floor_r {
            0.0
        } else if r < self.wall_r() {
            let x = r - self.floor_r;
            self.bank_r - libm::sqrt((self.bank_r * self.bank_r - x * x).max(0.0))
        } else {
            self.top_h()
        }
    }

    /// The bank's slope angle (radians, 0 on the floor, pi/2 at the wall) at radius `r`.
    pub fn slope_angle(&self, r: f64) -> f64 {
        if r <= self.floor_r {
            0.0
        } else if r >= self.wall_r() {
            core::f64::consts::FRAC_PI_2
        } else {
            libm::asin(((r - self.floor_r) / self.bank_r).clamp(0.0, 1.0))
        }
    }

    /// Ring segments around the bowl: a chord of about [`RING_CHORD_M`] at the outer edge, a multiple of four.
    pub fn ring_segments(&self) -> usize {
        let n = libm::ceil(2.0 * core::f64::consts::PI * self.outer_r() / RING_CHORD_M) as usize;
        n.div_ceil(4) * 4
    }
}

/// The bowl as one closed triangle mesh (positions in metres): a ring of vertices per profile point, each profile edge a
/// strip of triangles wound so their normals face out of the solid (into the arena on the bank and wall, up on the lip,
/// outwards on the outer face). The sim collides with exactly these triangles and the renderer draws them.
pub fn bowl_mesh(_map: &Map, f: &Feature) -> Option<JumpMesh> {
    let d = BowlDesign::of(f)?;
    let profile = d.profile();
    let n = d.ring_segments();
    let mut verts: Vec<[f64; 3]> = Vec::with_capacity(profile.len() * n);
    for &(r, h) in &profile {
        for j in 0..n {
            let a = 2.0 * core::f64::consts::PI * j as f64 / n as f64;
            verts.push([
                d.cx + r * libm::cos(a),
                d.base_y + h,
                d.cz + r * libm::sin(a),
            ]);
        }
    }
    let mut tris: Vec<[u32; 3]> = Vec::with_capacity((profile.len() - 1) * n * 2);
    for i in 0..profile.len() - 1 {
        let ((r0, h0), (r1, h1)) = (profile[i], profile[i + 1]);
        // The solid is to the right of the profile's direction, so the outward normal is its left: (-dh, dr).
        let (dr, dh) = (r1 - r0, h1 - h0);
        for j in 0..n {
            let j1 = (j + 1) % n;
            let a = 2.0 * core::f64::consts::PI * (j as f64 + 0.5) / n as f64;
            let want = [-dh * libm::cos(a), dr, -dh * libm::sin(a)];
            let v = |ring: usize, k: usize| (ring * n + k) as u32;
            for tri in [
                [v(i, j), v(i + 1, j), v(i, j1)],
                [v(i, j1), v(i + 1, j), v(i + 1, j1)],
            ] {
                let [p, q, r] = tri.map(|k| verts[k as usize]);
                let (u, w) = (
                    [q[0] - p[0], q[1] - p[1], q[2] - p[2]],
                    [r[0] - p[0], r[1] - p[1], r[2] - p[2]],
                );
                let cross = [
                    u[1] * w[2] - u[2] * w[1],
                    u[2] * w[0] - u[0] * w[2],
                    u[0] * w[1] - u[1] * w[0],
                ];
                let dot = cross[0] * want[0] + cross[1] * want[1] + cross[2] * want[2];
                tris.push(if dot >= 0.0 {
                    tri
                } else {
                    [tri[0], tri[2], tri[1]]
                });
            }
        }
    }
    Some((verts, tris))
}

/// FNV-1a over every bowl mesh's vertex bits and indices: the evidence that the collider's triangles are bit-identical
/// natively and in WASM (`libm` and IEEE `f64` only), pinned in the arena goldens.
pub fn mesh_fingerprint(map: &Map) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    let mut eat = |bytes: &[u8]| {
        for &b in bytes {
            h = (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for f in &map.features {
        if let Some((verts, tris)) = bowl_mesh(map, f) {
            for v in &verts {
                v.iter().for_each(|c| eat(&c.to_bits().to_le_bytes()));
            }
            for t in &tris {
                t.iter().for_each(|i| eat(&i.to_le_bytes()));
            }
        }
    }
    h
}

/// What is wrong with a `bowl` feature's own numbers, as `(what, detail)` pairs: the arena rules the validator applies
/// (profile shape, containment height, footprint inside the bounds, the floor flat near the bank and its relief inside
/// the limits). Empty when the bowl is sound.
pub fn problems(map: &Map, f: &Feature) -> Vec<String> {
    use limits::*;
    let mut bad = Vec::new();
    let get = |k: &str| f.params.get(k).copied();
    let (Some(floor), Some(bank), Some(wall), Some(lip)) = (
        get("floorRadiusMm"),
        get("bankRadiusMm"),
        get("wallHeightCm"),
        get("lipWidthMm"),
    ) else {
        return vec![
            "a bowl needs floorRadiusMm, bankRadiusMm, wallHeightCm and lipWidthMm".into(),
        ];
    };
    if floor < MIN_FLOOR_RADIUS_MM {
        bad.push(format!(
            "floor radius {floor} mm, minimum {MIN_FLOOR_RADIUS_MM}"
        ));
    }
    if !(MIN_BANK_RADIUS_MM..=MAX_BANK_RADIUS_MM).contains(&bank) {
        bad.push(format!(
            "bank radius {bank} mm, allowed {MIN_BANK_RADIUS_MM}..={MAX_BANK_RADIUS_MM}"
        ));
    }
    if wall < MIN_WALL_HEIGHT_CM {
        bad.push(format!(
            "wall {wall} cm tall, minimum {MIN_WALL_HEIGHT_CM}: a car could leave over the top"
        ));
    }
    if lip < MIN_LIP_WIDTH_MM {
        bad.push(format!(
            "lip {lip} mm wide, minimum {MIN_LIP_WIDTH_MM}: a thin top lets a car tunnel through"
        ));
    }
    if bank / 10 + wall < MIN_TOP_HEIGHT_CM {
        bad.push(format!(
            "lip {} cm above the floor, minimum {MIN_TOP_HEIGHT_CM}: a car launched up at {DESIGN_LAUNCH_UP_MPS} m/s could clear it",
            bank / 10 + wall
        ));
    }
    let Some(d) = BowlDesign::of(f) else {
        return bad;
    };
    if !bad.is_empty() {
        return bad;
    }
    // The profile turns one way only (up and over) from the foot of the bank to the lip's inner edge: no inverted
    // concavity, no kink steeper than the arc's own step.
    let pts = d.profile();
    let mut last_turn = 0.0f64;
    for (i, w) in pts[..d.inner_len()].windows(3).enumerate() {
        let (a, b) = (
            (w[1].0 - w[0].0, w[1].1 - w[0].1),
            (w[2].0 - w[1].0, w[2].1 - w[1].1),
        );
        let cross = a.0 * b.1 - a.1 * b.0;
        let turn = libm::atan2(cross, a.0 * b.0 + a.1 * b.1);
        if turn < -1e-9 {
            bad.push(format!(
                "the profile curves the wrong way at point {}",
                i + 1
            ));
        }
        last_turn = last_turn.max(turn);
    }
    if last_turn > core::f64::consts::FRAC_PI_2 / BANK_STEPS as f64 * 1.05 {
        bad.push("the profile has a kink steeper than the bank's own step".into());
    }
    // The footprint sits inside the bounds, and the floor under the bowl is flat at the bowl's base height.
    let b = map.header.bounds;
    let out_mm = ((d.outer_r() * 1000.0) as i64) + 1;
    let (cx, cz) = (i64::from(f.pose.x), i64::from(f.pose.z));
    if cx - out_mm < i64::from(b.min_x)
        || cx + out_mm > i64::from(b.max_x)
        || cz - out_mm < i64::from(b.min_z)
        || cz + out_mm > i64::from(b.max_z)
    {
        bad.push("the bowl's outer edge leaves the map bounds".into());
    }
    let t = &map.terrain;
    let want = (f64::from(f.pose.y) / 10.0) as i32;
    let sp = f64::from(t.spacing) / 1000.0;
    let cols = t.cols as usize;
    let at = |row: usize, col: usize| {
        let x = f64::from(t.origin_x) / 1000.0 + col as f64 * sp - d.cx;
        let z = f64::from(t.origin_z) / 1000.0 + row as f64 * sp - d.cz;
        libm::hypot(x, z)
    };
    let (mut rim, mut tall, mut deep, mut steep) = (false, None, None, None);
    for row in 0..t.rows as usize {
        for col in 0..cols {
            let r = at(row, col);
            if r > d.floor_r + sp {
                continue;
            }
            let h = i32::from(t.heights[row * cols + col]);
            if r >= d.floor_r - FLAT_RIM_M {
                rim |= h != want;
                continue;
            }
            let rel = i64::from(h - want);
            if rel > MAX_RISE_CM {
                tall = Some(tall.unwrap_or(0).max(rel));
            }
            if -rel > MAX_DIP_CM {
                deep = Some(deep.unwrap_or(0).max(-rel));
            }
            // The slope to the next sample along each axis.
            for (r2, c2) in [(row + 1, col), (row, col + 1)] {
                if r2 >= t.rows as usize || c2 >= cols {
                    continue;
                }
                let dh = f64::from((i32::from(t.heights[r2 * cols + c2]) - h).abs()) / 100.0;
                if dh / sp > MAX_RELIEF_SLOPE {
                    steep = Some(steep.unwrap_or(0.0f64).max(dh / sp));
                }
            }
        }
    }
    if rim {
        bad.push(format!(
            "the floor isn't flat at the bowl's base height within {FLAT_RIM_M} m of the bank"
        ));
    }
    if let Some(cm) = tall {
        bad.push(format!(
            "the floor rises {cm} cm, maximum {MAX_RISE_CM}: it could hide a car from the Overview"
        ));
    }
    if let Some(cm) = deep {
        bad.push(format!(
            "the floor dips {cm} cm, maximum {MAX_DIP_CM}: a pit could trap a car"
        ));
    }
    if let Some(s) = steep {
        bad.push(format!(
            "the floor's relief is {s:.2} steep, maximum {MAX_RELIEF_SLOPE}: a car could be trapped or tripped"
        ));
    }
    bad
}
