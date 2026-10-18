//! The arena's field (P1-M-arena-features): what stands on the floor inside the spawn ring. The owner asked for the race
//! tracks' kind of variety in the derby: jumps to fly, relief to bounce over and something to ram round.
//!
//! - **Jumps**: table-tops (an up-ramp to a flat table and a gentler down-ramp, so a car meets either end as a launch) and
//!   kickers (a short ramp with a steep back). Set roughly tangential round the middle, so cars circling the island or
//!   cutting across after a rival meet them.
//! - **Relief**: mounds and shallow dips, smooth cosine bumps.
//! - **Island or spine**: a squat red rock (`rocks/dome`, solid) at the middle, or three in a line (a spine) on the bigger
//!   floors. Low (at most [`MAX_ISLAND_H_M`]) so it hides nobody from the Overview.
//!
//! Everything is height in the terrain grid (1.25 m cells in an arena, so a lip is one cell wide) except the rocks, which
//! are dressing. Jumps and rocks keep a [`LANE_M`] lane round their footprints (mounds and dips, which are driven over,
//! keep [`BUMP_PAD_M`]), so every part of the floor stays reachable; the relief limits (`jj_map::arena::limits`) hold every slope and height, so nothing traps or hides a
//! car. Sizes and counts follow the floor's area (any N). `f64` and `libm` only: identical natively and in WASM.

use jj_map::arena::limits::{FLAT_RIM_M, MAX_RELIEF_SLOPE, MAX_RISE_CM};

use crate::seed::Rng;

/// The field ends this far inside the flat rim, m (the rim starts [`FLAT_RIM_M`] in from the foot of the bank).
pub const FIELD_GAP_M: f64 = 0.5;
/// A clear lane at least this wide between any two pieces' footprints, and round the rocks, m.
pub const LANE_M: f64 = 3.0;
/// A mound or dip is driven over, not round: it keeps only this much (each side) off its neighbours, m.
pub const BUMP_PAD_M: f64 = 0.5;
/// The island's rocks stand at most this tall, m: the Overview looks down at about 60 degrees, so 2.5 m shades about
/// 1.4 m behind it, less than a car's length or width.
pub const MAX_ISLAND_H_M: f64 = 2.5;
/// The steepest any piece is built (rise over run), under the validator's [`MAX_RELIEF_SLOPE`] with room for the grid's
/// centimetre rounding.
const BUILD_SLOPE: f64 = 0.55;
const _: () = assert!(BUILD_SLOPE < MAX_RELIEF_SLOPE);
/// A mound's crest and a dip's rim bend no tighter than this (1/m): over a car's half-wheelbase (1.35 m) the ground
/// falls away 9 cm, inside its belly's clearance.
const MAX_CREST_CURVATURE: f64 = 0.1;
/// A table-top's launch and landing slopes (rise over run).
const UP_SLOPE: f64 = 0.22;
const DOWN_SLOPE: f64 = 0.15;
/// A kicker's slopes, both ways.
const KICKER_SLOPE: f64 = 0.23;
/// Floor area per jump and per mound or dip, m² of field.
const AREA_PER_JUMP_M2: f64 = 500.0;
const AREA_PER_RELIEF_M2: f64 = 350.0;
/// Placement tries per piece.
const TRIES: usize = 80;

/// What a piece of relief is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReliefKind {
    TableTop,
    Kicker,
    Mound,
    Dip,
}

impl ReliefKind {
    pub fn is_jump(self) -> bool {
        matches!(self, ReliefKind::TableTop | ReliefKind::Kicker)
    }

    pub fn name(self) -> &'static str {
        match self {
            ReliefKind::TableTop => "table-top",
            ReliefKind::Kicker => "kicker",
            ReliefKind::Mound => "mound",
            ReliefKind::Dip => "dip",
        }
    }
}

/// One piece of relief, in metres (heights above the floor; a dip's is negative).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Relief {
    pub kind: ReliefKind,
    /// The middle of the piece.
    pub x: f64,
    pub z: f64,
    /// The direction up its launch ramp (unit vector; jumps only).
    pub dir: [f64; 2],
    /// Lip height (a jump), crest height (a mound) or depth as a negative height (a dip).
    pub height: f64,
    /// A jump's up-ramp, table and down-ramp (or back) lengths along `dir`.
    pub up: f64,
    pub table: f64,
    pub down: f64,
    /// A jump's flat half-width and its side slope's run; a mound's or dip's radius in `half`.
    pub half: f64,
    pub side: f64,
}

impl Relief {
    /// Length along `dir` (a jump) or diameter.
    pub fn length(&self) -> f64 {
        if self.kind.is_jump() {
            self.up + self.table + self.down
        } else {
            2.0 * self.half
        }
    }

    /// Local coordinates: along `dir` from the foot of the up-ramp, and across.
    fn local(&self, x: f64, z: f64) -> (f64, f64) {
        let (dx, dz) = (x - self.x, z - self.z);
        let [tx, tz] = self.dir;
        (dx * tx + dz * tz + self.length() / 2.0, -dx * tz + dz * tx)
    }

    /// The surface height above the floor at (x, z), m (0 outside the piece).
    pub fn height_at(&self, x: f64, z: f64) -> f64 {
        if !self.kind.is_jump() {
            let r = libm::hypot(x - self.x, z - self.z);
            if r >= self.half {
                return 0.0;
            }
            let c = libm::cos(core::f64::consts::FRAC_PI_2 * r / self.half);
            return self.height * c * c;
        }
        let (u, lat) = self.local(x, z);
        let len = self.length();
        if u <= 0.0 || u >= len {
            return 0.0;
        }
        let h = self.height;
        let along = if u < self.up {
            h * u / self.up
        } else if u <= self.up + self.table {
            h
        } else {
            h * (len - u) / self.down
        };
        let across = h * ((self.half + self.side - libm::fabs(lat)) / self.side).clamp(0.0, 1.0);
        along.min(across)
    }

    /// Whether (x, z) is within the piece's footprint grown by `pad` m.
    pub fn covers(&self, x: f64, z: f64, pad: f64) -> bool {
        if !self.kind.is_jump() {
            return libm::hypot(x - self.x, z - self.z) <= self.half + pad;
        }
        let (u, lat) = self.local(x, z);
        u >= -pad && u <= self.length() + pad && libm::fabs(lat) <= self.half + self.side + pad
    }
}

/// One of the island's rocks: centre, radius and height, m.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rock {
    pub x: f64,
    pub z: f64,
    pub r: f64,
    pub h: f64,
}

/// The field: its radius, the island's rocks and the relief.
#[derive(Clone, Debug, PartialEq)]
pub struct Field {
    pub radius: f64,
    pub rocks: Vec<Rock>,
    pub relief: Vec<Relief>,
}

impl Field {
    /// The floor's height above the base at (x, z), m: the pieces don't overlap, so it's the one there.
    pub fn height_at(&self, x: f64, z: f64) -> f64 {
        self.relief.iter().map(|p| p.height_at(x, z)).sum()
    }

    /// The jump whose footprint holds (x, z), if any.
    pub fn jump_at(&self, x: f64, z: f64) -> Option<&Relief> {
        self.relief
            .iter()
            .find(|p| p.kind.is_jump() && p.covers(x, z, 0.0))
    }

    pub fn count(&self, kind: ReliefKind) -> usize {
        self.relief.iter().filter(|p| p.kind == kind).count()
    }
}

/// The field radius for a floor of `floor_r` m.
pub fn radius_for(floor_r: f64) -> f64 {
    floor_r - FLAT_RIM_M - FIELD_GAP_M
}

/// Rounds to `step`.
fn snap(v: f64, step: f64) -> f64 {
    libm::round(v / step) * step
}

/// Occupancy cells, m.
const CELL_M: f64 = 0.5;

/// An occupancy grid over the field: the cells pieces (with half a lane each side, and a cell's diagonal more so a gap
/// between samples can't hide an overlap) already hold.
struct Taken {
    half: i64,
    cells: Vec<bool>,
    radius: f64,
}

impl Taken {
    fn new(radius: f64) -> Self {
        let half = libm::ceil(radius / CELL_M) as i64 + 1;
        let side = (2 * half + 1) as usize;
        Self {
            half,
            cells: vec![false; side * side],
            radius,
        }
    }

    fn cells(&self) -> impl Iterator<Item = (usize, f64, f64)> + '_ {
        let side = 2 * self.half + 1;
        (0..side * side).map(move |k| {
            let (i, j) = (k / side - self.half, k % side - self.half);
            (k as usize, i as f64 * CELL_M, j as f64 * CELL_M)
        })
    }

    /// Whether `covers` fits: its footprint grown by `pad` holds no taken cell and its own footprint stays inside the field.
    fn fits(&self, pad: f64, covers: impl Fn(f64, f64, f64) -> bool) -> bool {
        self.cells().all(|(k, x, z)| {
            let inside = libm::hypot(x, z) <= self.radius;
            (!covers(x, z, pad) || !self.cells[k]) && (inside || !covers(x, z, 0.0))
        })
    }

    /// Marks `covers`'s footprint grown by `pad` (and a cell more) as taken.
    fn take(&mut self, pad: f64, covers: impl Fn(f64, f64, f64) -> bool) {
        let marks: Vec<usize> = self
            .cells()
            .filter(|&(_, x, z)| covers(x, z, pad + CELL_M))
            .map(|(k, _, _)| k)
            .collect();
        for k in marks {
            self.cells[k] = true;
        }
    }
}

/// A jump of `kind` drawn at `scale` (1 = full size) facing `dir` at (x, z).
fn draw_jump(rng: &mut Rng, kind: ReliefKind, scale: f64) -> Relief {
    let (height, up, table, down, half) = match kind {
        ReliefKind::TableTop => {
            // A 12 degree kick to a 0.8-1.3 m table and an 8 degree way down. A car flies neutral (R14: its attitude is
            // the lip's), so the two slopes together (20 degrees) keep a landing on the far ramp inside the judge's
            // OK band (25), and one on the table or the floor beyond nearer clean. From the other end it's the same
            // jump the other way round.
            let h = snap(rng.range(0.8, 1.3) * scale.max(0.75), 0.1);
            (
                h,
                snap(h / UP_SLOPE, 0.25),
                snap(rng.range(2.0, 4.0) * scale, 0.5),
                snap(h / DOWN_SLOPE, 0.25),
                snap(rng.range(2.5, 3.5) * scale, 0.25),
            )
        }
        _ => {
            // A kicker: short and punchy, a 13 degree launch to a short deck and the same way down (a car stopped on any
            // crease keeps its wheels down: a peaked kicker high-centred one).
            let h = snap(rng.range(0.6, 0.9), 0.1);
            (
                h,
                snap(h / KICKER_SLOPE, 0.25),
                snap(rng.range(1.5, 2.5), 0.5),
                snap(h / KICKER_SLOPE, 0.25),
                snap(rng.range(2.0, 2.5) * scale.max(0.8), 0.25),
            )
        }
    };
    Relief {
        kind,
        x: 0.0,
        z: 0.0,
        dir: [1.0, 0.0],
        height,
        up,
        table,
        down,
        half,
        side: snap(height / 0.45, 0.25),
    }
}

/// The field for a floor of `floor_r` m, from `rng`.
pub fn generate(rng: &mut Rng, floor_r: f64) -> Field {
    use core::f64::consts::{PI, TAU};
    let radius = radius_for(floor_r);
    let area = PI * radius * radius;
    let mut taken = Taken::new(radius);
    // The island: one rock in the middle, or on a bigger floor (a seeded half of them) a spine of three in a line.
    let spine = radius >= 24.0 && rng.unit() < 0.5;
    let rocks: Vec<Rock> = if spine {
        let r = snap(rng.range(3.0, 3.5), 0.25);
        let a = rng.range(0.0, PI);
        let step = 1.4 * r;
        (-1..=1)
            .map(|k| Rock {
                x: f64::from(k) * step * libm::cos(a),
                z: f64::from(k) * step * libm::sin(a),
                r,
                h: snap(rng.range(1.6, 2.2) + if k == 0 { 0.3 } else { 0.0 }, 0.1),
            })
            .collect()
    } else {
        let a = rng.range(0.0, TAU);
        let off = rng.range(0.0, 1.0);
        vec![Rock {
            x: snap(off * libm::cos(a), 0.25),
            z: snap(off * libm::sin(a), 0.25),
            r: snap(2.5 + 0.06 * radius, 0.25),
            h: snap(rng.range(1.8, MAX_ISLAND_H_M), 0.1),
        }]
    };
    for rock in &rocks {
        taken.take(LANE_M / 2.0, |x, z, pad| {
            libm::hypot(x - rock.x, z - rock.z) <= rock.r + pad
        });
    }
    let island = rocks
        .iter()
        .map(|r| libm::hypot(r.x, r.z) + r.r)
        .fold(0.0, f64::max);

    let mut relief = Vec::new();
    // Jumps, tangential round the middle (either way round), a little off.
    let jumps = ((area / AREA_PER_JUMP_M2) as usize).max(2);
    for k in 0..jumps {
        let kind = if k == 0 || rng.unit() < 0.65 {
            ReliefKind::TableTop
        } else {
            ReliefKind::Kicker
        };
        let mut placed = false;
        for scale in [1.0, 0.85, 0.7] {
            let mut j = draw_jump(rng, kind, scale);
            for _ in 0..TRIES {
                let a = rng.range(0.0, TAU);
                let reach = j.half + j.side;
                let lo = island + LANE_M + reach;
                let hi = radius - reach;
                if hi <= lo {
                    break;
                }
                let rho = rng.range(lo, hi);
                let turn = if rng.unit() < 0.5 { 1.0 } else { -1.0 };
                let h = a + turn * PI / 2.0 + rng.range(-0.3, 0.3);
                j.x = snap(rho * libm::cos(a), 0.25);
                j.z = snap(rho * libm::sin(a), 0.25);
                j.dir = [libm::cos(h), libm::sin(h)];
                if taken.fits(LANE_M / 2.0, |x, z, pad| j.covers(x, z, pad)) {
                    taken.take(LANE_M / 2.0, |x, z, pad| j.covers(x, z, pad));
                    relief.push(j);
                    placed = true;
                    break;
                }
            }
            if placed {
                break;
            }
        }
    }
    // Mounds and dips anywhere left.
    let bumps = ((area / AREA_PER_RELIEF_M2) as usize).max(2);
    for k in 0..bumps {
        let dip = k % 2 == 1 || rng.unit() < 0.3;
        // Broad and low: a car's belly clears the crest (and a dip's rim), see MAX_CREST_CURVATURE.
        let (kind, half, height) = if dip {
            (
                ReliefKind::Dip,
                snap(rng.range(5.0, 7.0), 0.25),
                -snap(rng.range(0.3, 0.6), 0.05),
            )
        } else {
            (
                ReliefKind::Mound,
                snap(rng.range(5.5, 7.5), 0.25),
                snap(rng.range(0.4, 0.7), 0.05),
            )
        };
        'sizes: for scale in [1.0, 0.8, 0.65, 0.55] {
            let half = snap(half * scale, 0.25);
            // A cos² bump's crest (and a dip's rim) bends at H/2 (pi/R)²: held under MAX_CREST_CURVATURE so a car
            // stopped on it still has its wheels down (a 0.7 m mound 4 m across high-centred one). Its steepest is
            // pi H / 2R, far under the slope limit.
            let most = (2.0 * MAX_CREST_CURVATURE * half * half / (PI * PI))
                .min(2.0 * half * BUILD_SLOPE / PI);
            let height = snap(height.clamp(-most, most), 0.05);
            let mut m = Relief {
                kind,
                x: 0.0,
                z: 0.0,
                dir: [1.0, 0.0],
                height,
                up: 0.0,
                table: 0.0,
                down: 0.0,
                half,
                side: 0.0,
            };
            for _ in 0..TRIES {
                let a = rng.range(0.0, TAU);
                let lo = island + LANE_M + half;
                let hi = radius - half;
                if hi <= lo {
                    break;
                }
                let rho = libm::sqrt(rng.range(lo * lo, hi * hi));
                m.x = snap(rho * libm::cos(a), 0.25);
                m.z = snap(rho * libm::sin(a), 0.25);
                if taken.fits(BUMP_PAD_M, |x, z, pad| m.covers(x, z, pad)) {
                    taken.take(BUMP_PAD_M, |x, z, pad| m.covers(x, z, pad));
                    relief.push(m);
                    break 'sizes;
                }
            }
        }
    }
    debug_assert!(
        relief
            .iter()
            .all(|p| p.height * 100.0 <= MAX_RISE_CM as f64)
    );
    Field {
        radius,
        rocks,
        relief,
    }
}
