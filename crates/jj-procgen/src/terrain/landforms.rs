//! Landforms (P1-FL15a, R132): the big ground the road is routed over and through.
//!
//! Each biome's kit is data (`biomes.<id>.terrain.landforms` in `assets/profiles/generator.json`): rounded domes (the
//! Olgas), long ridges, flat-topped mesas with a breakaway edge, and gullies cut below the ground. They are placed along
//! the route from the terrain stream at a density per kilometre (never a count): some straddle the road (it will cut
//! through them), some stand beside it (they frame the corridor) and some stand further out (seen from afar). Broad
//! swells underlie them all.
//!
//! The field is evaluated analytically ([`Field::at`]) for the road profile and rasterised once onto the grid
//! ([`Field::raster`]). Positive landforms combine by maximum and gullies subtract by maximum, so overlaps never stack
//! into spikes.

use serde::{Deserialize, Serialize};

use crate::seed::Rng;

/// One landform kind's draw ranges. `[lo, hi]` pairs are uniform draws.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Kind {
    /// Placements per kilometre of route, anchored to it: through, beside or further out (0 = none).
    pub per_km: f64,
    /// Placements per square kilometre of the whole map, wherever they fall: the road is cut through any it meets.
    pub per_km2: f64,
    /// Height above the ground (a gully's depth below it), m.
    pub height_m: [f64; 2],
    /// Radius across its short axis, m.
    pub radius_m: [f64; 2],
    /// Long axis over short axis (1 = round).
    pub aspect: [f64; 2],
    /// Profile exponent: `h = H (1 - q²)^shape` (below 1 = steep sides, a rock dome; above 1 = a soft hill). Mesas use
    /// it as the breakaway's width as a share of the radius.
    pub shape: f64,
}

impl Kind {
    fn lerp(&self, to: &Self, t: f64) -> Self {
        let m = |a: f64, b: f64| a + (b - a) * t;
        let r = |a: [f64; 2], b: [f64; 2]| [m(a[0], b[0]), m(a[1], b[1])];
        Self {
            per_km: m(self.per_km, to.per_km),
            per_km2: m(self.per_km2, to.per_km2),
            height_m: r(self.height_m, to.height_m),
            radius_m: r(self.radius_m, to.radius_m),
            aspect: r(self.aspect, to.aspect),
            shape: m(self.shape, to.shape),
        }
    }

    /// Problems with the ranges, for the data validator.
    pub fn check(&self, path: &str, bad: &mut Vec<String>) {
        if !(self.per_km >= 0.0 && self.per_km.is_finite()) {
            bad.push(format!("{path}.perKm: must not be negative"));
        }
        if !(self.per_km2 >= 0.0 && self.per_km2.is_finite()) {
            bad.push(format!("{path}.perKm2: must not be negative"));
        }
        if self.per_km == 0.0 && self.per_km2 == 0.0 {
            return;
        }
        for (n, [lo, hi]) in [
            ("heightM", self.height_m),
            ("radiusM", self.radius_m),
            ("aspect", self.aspect),
        ] {
            if !(lo > 0.0 && hi >= lo && hi.is_finite()) {
                bad.push(format!("{path}.{n}: needs 0 < lo <= hi"));
            }
        }
        if self.aspect[0] < 1.0 {
            bad.push(format!(
                "{path}.aspect: below 1 (the radius is the short axis)"
            ));
        }
        if !(self.shape > 0.0 && self.shape.is_finite()) {
            bad.push(format!("{path}.shape: must be positive"));
        }
    }
}

/// A biome's landform kit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Landforms {
    pub domes: Kind,
    pub ridges: Kind,
    pub mesas: Kind,
    pub gullies: Kind,
    /// Share of placements the road runs through (the rest frame it from beside or stand further out).
    pub through: f64,
    /// Share of the remainder that stands well back from the road (the skyline).
    pub far: f64,
    /// Side slope (rise over run) where the ground meets the road across a big height difference: a cutting's wall or
    /// an embankment's batter. Small differences blend gently and stay drivable.
    pub batter: f64,
    /// Flat ground beside the road bed before any wall or batter starts, m.
    pub shoulder_m: f64,
    /// How far the road rides up toward the landscape's highs (0 = always the lowest line, cutting through every rise;
    /// 1 = the highest, on embankments over every dip): a share between the two grade-limited lines.
    pub fill: f64,
    /// How much of a landform's height the road's line climbs, m: beyond it the road cuts through (a gorge, a cutting).
    pub climb_m: f64,
    /// Share of the swells' relief that is one tilt across the course (the road climbs one side of the loop and runs down
    /// the other); the rest is broad noise. A town keeps it low: its ground stays level enough to build on between the
    /// hills its road climbs.
    pub tilt: f64,
    /// Flow beats per kilometre (R132): stretches where the road runs nearly level through the landscape, on the
    /// course's straightest parts, so the core's jumps, crests and set pieces have room.
    pub flow_per_km: f64,
    /// Share of a crossing deck's height the lower road dips under the upper one (1 on steep ground, so the deck rides at
    /// the upper road's level; 0 on flat ground, where the deck rises over level roads).
    pub underpass: f64,
}

impl Landforms {
    pub fn lerp(&self, to: &Self, t: f64) -> Self {
        let m = |a: f64, b: f64| a + (b - a) * t;
        Self {
            domes: self.domes.lerp(&to.domes, t),
            ridges: self.ridges.lerp(&to.ridges, t),
            mesas: self.mesas.lerp(&to.mesas, t),
            gullies: self.gullies.lerp(&to.gullies, t),
            through: m(self.through, to.through),
            far: m(self.far, to.far),
            batter: m(self.batter, to.batter),
            shoulder_m: m(self.shoulder_m, to.shoulder_m),
            fill: m(self.fill, to.fill),
            climb_m: m(self.climb_m, to.climb_m),
            tilt: m(self.tilt, to.tilt),
            flow_per_km: m(self.flow_per_km, to.flow_per_km),
            underpass: m(self.underpass, to.underpass),
        }
    }

    pub fn check(&self, path: &str, bad: &mut Vec<String>) {
        for (n, k) in [
            ("domes", &self.domes),
            ("ridges", &self.ridges),
            ("mesas", &self.mesas),
            ("gullies", &self.gullies),
        ] {
            k.check(&format!("{path}.{n}"), bad);
        }
        for (n, v) in [
            ("through", self.through),
            ("far", self.far),
            ("fill", self.fill),
            ("tilt", self.tilt),
            ("underpass", self.underpass),
        ] {
            if !(0.0..=1.0).contains(&v) {
                bad.push(format!("{path}.{n}: outside 0..1"));
            }
        }
        if !(self.batter > 0.0 && self.batter.is_finite()) {
            bad.push(format!("{path}.batter: must be positive"));
        }
        if !(self.flow_per_km >= 0.0 && self.flow_per_km.is_finite()) {
            bad.push(format!("{path}.flowPerKm: must not be negative"));
        }
        if !(self.climb_m >= 0.0 && self.climb_m.is_finite()) {
            bad.push(format!("{path}.climbM: must not be negative"));
        }
        if !(self.shoulder_m >= 0.0 && self.shoulder_m.is_finite()) {
            bad.push(format!("{path}.shoulderM: must not be negative"));
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    /// `H (1 - q²)^shape`: domes and ridges.
    Dome,
    /// Flat top, a breakaway edge `shape × radius` wide.
    Mesa,
    /// A channel below the ground, `H (1 - q²)^shape` deep.
    Gully,
}

/// One placed landform.
#[derive(Clone, Copy, Debug)]
pub struct Landform {
    pub shape: Shape,
    pub x: f64,
    pub z: f64,
    /// Unit vector along the long axis.
    pub ax: (f64, f64),
    /// Semi-axes (long, short), m.
    pub a: f64,
    pub b: f64,
    pub height: f64,
    pub exponent: f64,
    /// Outline wobble: two harmonics' amplitudes and phases.
    pub wobble: [f64; 4],
    /// Route arc length it was placed from, and whether the road runs through it.
    pub s: f64,
    pub through: bool,
}

const WOBBLE: f64 = 0.12;
/// The cutting every lap is sure of stands at least this far above what the road climbs, m.
const GUARANTEED_CUT_M: f64 = 10.0;
/// Its bend is judged, and kept clear of the keep-outs, this far either side, m.
const GUARANTEED_BEND_M: f64 = 40.0;
/// The tilt carries on past the route's extremes by this share of its span, then levels off.
const TILT_BEYOND: f64 = 0.3;
/// Area placements walk the map in tiles this size, m.
const AREA_TILE_M: f64 = 100.0;
/// An area placement stays this far clear of the start corridor and crossings, m (past its reach and the road's half).
const AREA_GUARD_M: f64 = 10.0;

impl Landform {
    /// The largest distance from the centre the landform reaches.
    pub fn reach(&self) -> f64 {
        self.a * (1.0 + 2.0 * WOBBLE)
    }

    /// Height contribution at `(x, z)` (positive; a gully's is its depth).
    pub fn at(&self, x: f64, z: f64) -> f64 {
        let (dx, dz) = (x - self.x, z - self.z);
        let u = dx * self.ax.0 + dz * self.ax.1;
        let v = -dx * self.ax.1 + dz * self.ax.0;
        let (ua, vb) = (u / self.a, v / self.b);
        let r2 = ua * ua + vb * vb;
        let lim = (1.0 + 2.0 * WOBBLE) * (1.0 + 2.0 * WOBBLE);
        if r2 >= lim {
            return 0.0;
        }
        let th = libm::atan2(vb, ua);
        let w = 1.0
            + self.wobble[0] * libm::sin(2.0 * th + self.wobble[1])
            + self.wobble[2] * libm::sin(3.0 * th + self.wobble[3]);
        let q = libm::sqrt(r2) / w;
        if q >= 1.0 {
            return 0.0;
        }
        match self.shape {
            Shape::Dome | Shape::Gully => self.height * libm::pow(1.0 - q * q, self.exponent),
            Shape::Mesa => {
                // Breakaway: steep near the rim, a short talus apron at its foot.
                let e = self.exponent.clamp(0.02, 1.0);
                let k = ((1.0 - q) / e).clamp(0.0, 1.0);
                let rim = k * k * (3.0 - 2.0 * k);
                self.height * (0.85 * libm::pow(rim, 0.6) + 0.15 * (1.0 - q))
            }
        }
    }
}

/// Which of a kit's kinds a placement pass reads.
type Pick = fn(&Landforms) -> Kind;

/// The landforms around a route plus the broad swells under them.
#[derive(Clone, Debug)]
pub struct Field {
    pub landforms: Vec<Landform>,
    swell_seed: u64,
    swell_wavelength: f64,
    /// The swells' noise range along the route (its lowest value and span), for normalising.
    noise: (f64, f64),
    /// The tilt: a unit direction and the route's lowest projection on it and span.
    tilt: ((f64, f64), f64, f64),
    tilt_share: f64,
    swell_gain: f64,
}

/// Where a route point is, for placement: position, unit tangent and arc length.
pub struct RoutePoint {
    pub x: f64,
    pub z: f64,
    pub tx: f64,
    pub tz: f64,
    pub s: f64,
}

impl Field {
    /// Places each kind along the route by its density at the point (`kit(i)` is the kit at route point `i`), and
    /// scales the swells so the route spans `relief_m` of them. `keep_out(s)` is true where nothing may straddle the
    /// road (the start corridor and a crossing); a through draw there stands beside instead. `half` is half the road's
    /// width.
    #[allow(clippy::too_many_arguments)]
    pub fn place(
        route: &[RoutePoint],
        total: f64,
        half: f64,
        kit: &dyn Fn(usize) -> Landforms,
        relief_m: f64,
        wavelength_m: f64,
        keep_out: &dyn Fn(f64) -> bool,
        area: [f64; 4],
        tilt_share: f64,
        rng: &mut Rng,
    ) -> Self {
        let n = route.len();
        let draw = |kind: &Kind, rng: &mut Rng| {
            let height = rng.range(kind.height_m[0], kind.height_m[1]);
            let b = rng.range(kind.radius_m[0], kind.radius_m[1]);
            let a = b * rng.range(kind.aspect[0], kind.aspect[1]);
            let yaw = rng.range(0.0, core::f64::consts::TAU);
            let wobble = [
                rng.range(0.0, WOBBLE),
                rng.range(0.0, core::f64::consts::TAU),
                rng.range(0.0, WOBBLE / 2.0),
                rng.range(0.0, core::f64::consts::TAU),
            ];
            (height, a, b, (libm::cos(yaw), libm::sin(yaw)), wobble)
        };
        let mut landforms = Vec::new();
        // Each kind accumulates its own density along the route and places when it passes the next draw.
        let kinds: [(Shape, Pick); 4] = [
            (Shape::Dome, |l| l.domes),
            (Shape::Dome, |l| l.ridges),
            (Shape::Mesa, |l| l.mesas),
            (Shape::Gully, |l| l.gullies),
        ];
        let mut due: [f64; 4] = core::array::from_fn(|_| rng.range(0.2, 1.0));
        let mut acc = [0.0f64; 4];
        let mut through_acc = [1.0f64; 4];
        for i in 0..n {
            let ds = if i + 1 < n {
                route[i + 1].s - route[i].s
            } else {
                total - route[i].s
            };
            let l = kit(i);
            for (k, (shape, pick)) in kinds.iter().enumerate() {
                let kind = pick(&l);
                acc[k] += kind.per_km * ds / 1000.0;
                if acc[k] < due[k] {
                    continue;
                }
                acc[k] -= due[k];
                due[k] = rng.range(0.6, 1.4);
                let p = &route[i];
                let (height, a, b, ax, wobble) = draw(&kind, rng);
                // Roles by share, not by chance: every lap's first placement past the start goes through the road.
                let role = if keep_out(p.s) {
                    1.0
                } else {
                    through_acc[k] += l.through;
                    if through_acc[k] >= 1.0 {
                        through_acc[k] -= 1.0;
                        0.0
                    } else {
                        1.0
                    }
                };
                let side = if rng.unit() < 0.5 { -1.0 } else { 1.0 };
                // Distance from the centre to its outline along the road's normal, for a beside placement.
                let ext = {
                    let (nx, nz) = (-p.tz, p.tx);
                    let u = nx * ax.0 + nz * ax.1;
                    let v = -nx * ax.1 + nz * ax.0;
                    1.0 / libm::sqrt((u / a) * (u / a) + (v / b) * (v / b))
                };
                let through = *shape == Shape::Gully || role < 0.5;
                let offset = if through {
                    // Off-centre, so one wall is usually higher than the other.
                    side * rng.range(0.0, 0.3) * ext
                } else if rng.unit() < l.far {
                    side * (ext + half + rng.range(40.0, 110.0))
                } else {
                    side * (ext * rng.range(0.75, 1.05) + half + rng.range(2.0, 12.0))
                };
                if *shape == Shape::Gully && keep_out(p.s) {
                    continue;
                }
                landforms.push(Landform {
                    shape: *shape,
                    x: p.x - p.tz * offset,
                    z: p.z + p.tx * offset,
                    ax,
                    a,
                    b,
                    height,
                    exponent: kind.shape,
                    wobble,
                    s: p.s,
                    through,
                });
            }
        }
        // Every lap runs through at least one long cutting: the leading kind of the biome, lying along the road at its
        // sharpest open bend, standing `GUARANTEED_CUT_M` above what the road climbs.
        {
            // The sharpest bend with open road either side: set pieces take the long straights, and a cutting on a
            // bend is a blind corner through rock.
            let step = (total / n as f64).max(1e-9);
            let reach = libm::ceil(GUARANTEED_BEND_M / step) as usize;
            let turn = |i: usize| {
                let (a, b) = (&route[(i + n - reach) % n], &route[(i + reach) % n]);
                libm::fabs(libm::atan2(
                    a.tx * b.tz - a.tz * b.tx,
                    a.tx * b.tx + a.tz * b.tz,
                ))
            };
            let best = (0..n)
                .filter(|&i| (0..=2 * reach).all(|k| !keep_out(route[(i + n + k - reach) % n].s)))
                .fold(None::<(usize, f64)>, |best, i| match best {
                    Some((_, t)) if t >= turn(i) => best,
                    _ => Some((i, turn(i))),
                })
                .map(|(i, _)| i);
            if let Some(i) = best {
                let l = kit(i);
                // The widest kind the biome has (mesas, domes), drawn round: a bend through it stays walled.
                if let Some((shape, kind)) = kinds
                    .iter()
                    .take(3)
                    .map(|(shape, pick)| (*shape, pick(&l)))
                    .filter(|(_, kind)| kind.per_km > 0.0 || kind.per_km2 > 0.0)
                    .fold(None::<(Shape, Kind)>, |best, c| match best {
                        Some(b) if b.1.radius_m[1] >= c.1.radius_m[1] => Some(b),
                        _ => Some(c),
                    })
                {
                    let (height, _, b, _, wobble) = draw(&kind, rng);
                    let (a, b) = (b.max(kind.radius_m[1]), b.max(kind.radius_m[1]));
                    let height = height.max(l.climb_m + GUARANTEED_CUT_M);
                    let p = &route[i];
                    landforms.push(Landform {
                        shape,
                        x: p.x,
                        z: p.z,
                        ax: (p.tx, p.tz),
                        a,
                        b,
                        height,
                        exponent: kind.shape,
                        wobble,
                        s: p.s,
                        through: true,
                    });
                }
            }
        }
        // Then the whole map, tile by tile, at each tile's nearest biome's area density: the road meets these wherever
        // they happen to fall and is cut through them, unless they'd cover the start corridor or a crossing.
        let guarded: Vec<(f64, f64)> = route
            .iter()
            .filter(|p| keep_out(p.s))
            .map(|p| (p.x, p.z))
            .collect();
        let [ox, oz, w, d] = area;
        let (tiles_x, tiles_z) = (
            libm::ceil(w / AREA_TILE_M) as usize,
            libm::ceil(d / AREA_TILE_M) as usize,
        );
        let mut due: [f64; 4] = core::array::from_fn(|_| rng.range(0.2, 1.0));
        let mut acc = [0.0f64; 4];
        for tz in 0..tiles_z {
            for tx in 0..tiles_x {
                let (cx, cz) = (
                    ox + (tx as f64 + 0.5) * AREA_TILE_M,
                    oz + (tz as f64 + 0.5) * AREA_TILE_M,
                );
                let near = (0..n)
                    .min_by(|&i, &j| {
                        let di = (route[i].x - cx) * (route[i].x - cx)
                            + (route[i].z - cz) * (route[i].z - cz);
                        let dj = (route[j].x - cx) * (route[j].x - cx)
                            + (route[j].z - cz) * (route[j].z - cz);
                        di.total_cmp(&dj)
                    })
                    .unwrap_or(0);
                let l = kit(near);
                for (k, (shape, pick)) in kinds.iter().enumerate() {
                    let kind = pick(&l);
                    acc[k] += kind.per_km2 * AREA_TILE_M * AREA_TILE_M / 1e6;
                    if acc[k] < due[k] {
                        continue;
                    }
                    acc[k] -= due[k];
                    due[k] = rng.range(0.6, 1.4);
                    let (height, a, b, ax, wobble) = draw(&kind, rng);
                    let (x, z) = (
                        cx + rng.range(-0.5, 0.5) * AREA_TILE_M,
                        cz + rng.range(-0.5, 0.5) * AREA_TILE_M,
                    );
                    let clear = a * (1.0 + 2.0 * WOBBLE) + half + AREA_GUARD_M;
                    if guarded
                        .iter()
                        .any(|&(gx, gz)| (gx - x) * (gx - x) + (gz - z) * (gz - z) < clear * clear)
                    {
                        continue;
                    }
                    landforms.push(Landform {
                        shape: *shape,
                        x,
                        z,
                        ax,
                        a,
                        b,
                        height,
                        exponent: kind.shape,
                        wobble,
                        s: route[near].s,
                        through: false,
                    });
                }
            }
        }
        // The swells: the land tilts across the course (the road climbs one side of the loop and runs down the other,
        // so even a short lap spans the biome's relief inside its grade), with broad noise over it.
        let range = |f: &dyn Fn(&RoutePoint) -> f64| {
            let v: Vec<f64> = route.iter().map(f).collect();
            let lo = v.iter().copied().fold(f64::INFINITY, f64::min);
            let hi = v.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            (lo, (hi - lo).max(1e-6))
        };
        let jitter = rng.range(0.0, core::f64::consts::PI / 8.0);
        let tilt = (0..8)
            .map(|k| {
                let a = jitter + f64::from(k) * core::f64::consts::PI / 8.0;
                let d = (libm::cos(a), libm::sin(a));
                let (lo, span) = range(&|p| p.x * d.0 + p.z * d.1);
                // Spread of the route along it: a figure eight's lobes, or a long course's ends, lie apart on it.
                let mean = route.iter().map(|p| p.x * d.0 + p.z * d.1).sum::<f64>() / n as f64;
                let spread = route
                    .iter()
                    .map(|p| (p.x * d.0 + p.z * d.1 - mean) * (p.x * d.0 + p.z * d.1 - mean))
                    .sum::<f64>();
                (d, lo, span, spread)
            })
            .fold(None::<((f64, f64), f64, f64, f64)>, |best, c| match best {
                Some(b) if b.3 >= c.3 => Some(b),
                _ => Some(c),
            })
            .map(|(d, lo, span, _)| (d, lo, span))
            .expect("eight directions");
        let tilt = if rng.unit() < 0.5 {
            tilt
        } else {
            let ((dx, dz), lo, span) = tilt;
            ((-dx, -dz), -(lo + span), span)
        };
        let swell_seed = rng.next_u64();
        let mut field = Self {
            landforms,
            swell_seed,
            swell_wavelength: wavelength_m,
            noise: (0.0, 1.0),
            tilt,
            tilt_share,
            swell_gain: relief_m,
        };
        field.noise = range(&|p| field.noise_at(p.x, p.z));
        // Tilt and noise partly cancel: scale their sum so the route spans `relief_m` of it.
        let (_, span) = range(&|p| field.swell(p.x, p.z));
        field.swell_gain *= relief_m / span;
        field
    }

    fn noise_at(&self, x: f64, z: f64) -> f64 {
        let w = self.swell_wavelength;
        super::value_noise(self.swell_seed, x / w, z / w)
            + 0.35 * super::value_noise(self.swell_seed ^ 0x5bd1, 2.1 * x / w, 2.1 * z / w)
    }

    /// Scales the swells' relief by `k` (the route's lowest swell stays where it is).
    pub fn scale_swells(&mut self, k: f64) {
        self.swell_gain *= k;
    }

    fn swell(&self, x: f64, z: f64) -> f64 {
        let ((dx, dz), lo, span) = self.tilt;
        let t = ((x * dx + z * dz - lo) / span).clamp(-TILT_BEYOND, 1.0 + TILT_BEYOND);
        let v = (self.noise_at(x, z) - self.noise.0) / self.noise.1;
        self.swell_gain * (self.tilt_share * t + (1.0 - self.tilt_share) * v)
    }

    /// The ground height of the landscape at `(x, z)`, m.
    pub fn at(&self, x: f64, z: f64) -> f64 {
        self.at_climbing(x, z, f64::INFINITY)
    }

    /// [`Field::at`] with each landform's rise above the swells capped at `climb` m: the land the road's line follows.
    pub fn at_climbing(&self, x: f64, z: f64, climb: f64) -> f64 {
        let (mut up, mut down) = (0.0f64, 0.0f64);
        for l in &self.landforms {
            let r = l.reach();
            if (x - l.x).abs() >= r || (z - l.z).abs() >= r {
                continue;
            }
            let h = l.at(x, z);
            if l.shape == Shape::Gully {
                down = down.max(h);
            } else {
                up = up.max(h);
            }
        }
        self.swell(x, z) + up.min(climb) - down
    }

    /// [`Field::at`] at every grid vertex (row-major), without testing every landform at every cell.
    pub fn raster(&self, cols: usize, rows: usize, ox: f64, oz: f64, sp: f64) -> Vec<f64> {
        let mut up = vec![0.0f64; cols * rows];
        let mut down = vec![0.0f64; cols * rows];
        for l in &self.landforms {
            let r = l.reach();
            let c0 = libm::floor(((l.x - r - ox) / sp).max(0.0)) as usize;
            let r0 = libm::floor(((l.z - r - oz) / sp).max(0.0)) as usize;
            let c1 = (libm::ceil(((l.x + r - ox) / sp).max(0.0)) as usize).min(cols - 1);
            let r1 = (libm::ceil(((l.z + r - oz) / sp).max(0.0)) as usize).min(rows - 1);
            for rr in r0..=r1 {
                for cc in c0..=c1 {
                    let h = l.at(ox + cc as f64 * sp, oz + rr as f64 * sp);
                    let at = rr * cols + cc;
                    if l.shape == Shape::Gully {
                        down[at] = down[at].max(h);
                    } else {
                        up[at] = up[at].max(h);
                    }
                }
            }
        }
        (0..cols * rows)
            .map(|at| {
                let (c, r) = (at % cols, at / cols);
                self.swell(ox + c as f64 * sp, oz + r as f64 * sp) + up[at] - down[at]
            })
            .collect()
    }
}
