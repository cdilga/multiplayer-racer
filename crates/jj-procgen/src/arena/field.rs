//! The arena's field (P1-M-arena-features): what stands on the floor inside the spawn ring. The owner asked for the race
//! tracks' kind of variety in the derby: jumps to fly, relief to bounce over and something to ram round.
//!
//! - **The crossover** (br-bhkz.4, owner 2026-11-17: "the jumps were really not good enough"): the centrepiece of every
//!   arena. Two launch ramps face each other across the middle, joined by a deck, and the island's two rocks stand either
//!   side of the deck as a gate. A car launches off either ramp, flies the deck between the rocks and comes down on the
//!   far ramp's back or the floor beyond; two cars from opposite ends meet in the air. A slow car lands on the deck and
//!   drives off the far end: nothing to fall into.
//! - **Jumps**: table-tops (a launch ramp to a flat table and a gentler ramp down, so a car meets either end as a launch)
//!   and kickers (short, the same launch both ways). Set roughly tangential round the middle, the first two in the room
//!   either side of the gate, so cars circling the island or cutting across after a rival meet them.
//! - **Relief**: mounds and shallow dips, smooth cosine bumps.
//! - **The island**: the gate's two squat red rocks (`rocks/dome`, solid). Low (at most [`MAX_ISLAND_H_M`]) so they hide
//!   nobody from the Overview.
//!
//! Launches are sized from measured flights (`docs/evidence/br-bhkz.4/jumps.md`): a 20 degree ramp to a 1.5-2 m lip flies
//! a Cruz 1.0-1.5 s at 12-24 m/s and lands it on its wheels. A lip is a crease a stopped car has to drive off: up to
//! [`LAUNCH_SLOPE`] with flat deck beyond it a car drives off any way; a sharper or a peaked one high-centres it, which
//! is why no ramp here is steeper and every lip has a deck.
//!
//! Everything is height in the terrain grid (1.25 m cells in an arena, so a lip is one cell wide) except the rocks, which
//! are dressing. Jumps and rocks keep a [`LANE_M`] lane round their footprints (mounds and dips, which are driven over,
//! keep [`BUMP_PAD_M`]; the gate's rocks stand against the crossover's deck, one piece with it), so every part of the
//! floor stays reachable; the relief limits (`jj_map::arena::limits`) hold every slope and height, so nothing traps or
//! hides a car. Sizes and counts follow the floor's area (any N). `f64` and `libm` only: identical natively and in WASM.

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
/// The launch ramps' slope (rise over run), 19.8 degrees: the crossover's and a kicker's both ways, and a table-top's
/// steep end. Measured (`docs/evidence/br-bhkz.4/jumps.md`): a stopped Cruz astride a lip this sharp, with deck beyond
/// it, drives off either way at any angle to the grid; at 0.40 it high-centres. Steeper also flies no longer: the ramp's
/// foot costs more speed than the angle gives back.
pub const LAUNCH_SLOPE: f64 = 0.36;
/// A table-top's gentle end, 15.6 degrees: the same jump the other way round, lower and longer.
const GENTLE_SLOPE: f64 = 0.28;
/// A jump's side slopes, 24 degrees.
const SIDE_SLOPE: f64 = 0.45;
/// The flat beyond a lip is at least this long, m: a car is never astride two creases.
const MIN_DECK_M: f64 = 2.5;
/// The crossover's deck, m: the gate's rocks (6 m across) stand beside its middle, with a metre of deck clear of them at
/// each end, where a car can still turn off sideways.
pub const GATE_DECK_M: f64 = 8.0;
/// The crossover's deck is this wide each side of its line, m: the gate between the rocks is twice it.
pub const GATE_HALF_M: f64 = 3.5;
/// The gate's rocks: the kit's smallest footprint.
const GATE_ROCK_R_M: f64 = 3.0;
/// Floor area per jump (beside the crossover) and per mound or dip, m² of field. A full-size table-top with its lanes
/// takes about 400 m² (the old hops took half that, and stood one to 500 m²).
const AREA_PER_JUMP_M2: f64 = 750.0;
const AREA_PER_RELIEF_M2: f64 = 350.0;
/// Placement tries per piece.
const TRIES: usize = 80;

/// What a piece of relief is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReliefKind {
    /// The centrepiece: a launch ramp at each end of a deck that runs between the island's two rocks.
    Crossover,
    TableTop,
    Kicker,
    Mound,
    Dip,
}

impl ReliefKind {
    pub fn is_jump(self) -> bool {
        matches!(
            self,
            ReliefKind::Crossover | ReliefKind::TableTop | ReliefKind::Kicker
        )
    }

    pub fn name(self) -> &'static str {
        match self {
            ReliefKind::Crossover => "crossover",
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

    /// A circle round (x, z) that holds the whole footprint grown by `pad`: no point outside it is `covers`ed.
    fn reach(&self, pad: f64) -> f64 {
        if !self.kind.is_jump() {
            return self.half + pad;
        }
        libm::hypot(self.length() / 2.0 + pad, self.half + self.side + pad)
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

    /// The cells within `reach` m (a cell more, for rounding) of (cx, cz): every cell a footprint inside that circle can
    /// cover. A cell outside it is covered by nothing that `fits`/`take` ask about, so scanning only these is the same
    /// answer as scanning the whole grid (which cost ~13 min for a 1000-car bowl at the tests' opt-level).
    fn cells_near(
        &self,
        (cx, cz, reach): (f64, f64, f64),
    ) -> impl Iterator<Item = (usize, f64, f64)> + '_ {
        let side = 2 * self.half + 1;
        let span = |c: f64| {
            let lo = (libm::floor((c - reach) / CELL_M) as i64 - 1).max(-self.half);
            let hi = (libm::ceil((c + reach) / CELL_M) as i64 + 1).min(self.half);
            lo..=hi
        };
        let (is, js) = (span(cx), span(cz));
        is.flat_map(move |i| js.clone().map(move |j| (i, j)))
            .map(move |(i, j)| {
                let k = (i + self.half) * side + (j + self.half);
                (k as usize, i as f64 * CELL_M, j as f64 * CELL_M)
            })
    }

    /// Whether `covers` fits: its footprint grown by `pad` holds no taken cell and its own footprint stays inside the field.
    /// `near` is (x, z, reach): a circle holding that grown footprint.
    fn fits(
        &self,
        pad: f64,
        near: (f64, f64, f64),
        covers: impl Fn(f64, f64, f64) -> bool,
    ) -> bool {
        self.cells_near(near).all(|(k, x, z)| {
            let inside = libm::hypot(x, z) <= self.radius;
            (!covers(x, z, pad) || !self.cells[k]) && (inside || !covers(x, z, 0.0))
        })
    }

    /// Marks `covers`'s footprint grown by `pad` (and a cell more) as taken. `near` holds that footprint, as for `fits`.
    fn take(&mut self, pad: f64, near: (f64, f64, f64), covers: impl Fn(f64, f64, f64) -> bool) {
        let marks: Vec<usize> = self
            .cells_near(near)
            .filter(|&(_, x, z)| covers(x, z, pad + CELL_M))
            .map(|(k, _, _)| k)
            .collect();
        for k in marks {
            self.cells[k] = true;
        }
    }
}

/// Rounds up to `step`: a ramp's run, so its slope is never over the one asked for.
fn snap_up(v: f64, step: f64) -> f64 {
    libm::ceil(v / step - 1e-9) * step
}

/// A jump of `kind` drawn at `scale` (1 = full size), at the origin facing +x.
fn draw_jump(rng: &mut Rng, kind: ReliefKind, scale: f64) -> Relief {
    let (height, up, table, down, half) = match kind {
        ReliefKind::TableTop => {
            // A 20 degree launch to a 1.4-2 m table and a 15.6 degree way down: from the other end it's the same jump
            // lower and longer. A car flies neutral (R14: its attitude is the lip's, eased a little as its tail leaves),
            // and at arena speeds either flight carries past the far ramp to the floor, where that lands OK.
            let h = snap(rng.range(1.4, 2.0) * scale, 0.1);
            (
                h,
                snap_up(h / LAUNCH_SLOPE, 0.25),
                snap(rng.range(3.0, 5.0) * scale, 0.5).max(MIN_DECK_M),
                snap_up(h / GENTLE_SLOPE, 0.25),
                snap(rng.range(2.5, 3.25) * scale, 0.25).max(2.25),
            )
        }
        _ => {
            // A kicker: short and punchy, the launch slope both ways off a short deck (a car stopped on either crease
            // keeps its wheels down: a peaked kicker high-centred one).
            let h = snap(rng.range(1.2, 1.6) * scale, 0.1);
            let run = snap_up(h / LAUNCH_SLOPE, 0.25);
            (
                h,
                run,
                snap(rng.range(MIN_DECK_M, 3.0), 0.5),
                run,
                snap(rng.range(2.25, 2.75), 0.25),
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
        side: snap_up(height / SIDE_SLOPE, 0.25),
    }
}

/// The crossover through (x, z) along `axis` (radians) for a field of `radius` m, and the gate's two rocks: one either
/// side of the deck's middle, against its edge.
fn draw_crossover(rng: &mut Rng, radius: f64, x: f64, z: f64, axis: f64) -> (Relief, [Rock; 2]) {
    // Lips of 1.5-1.8 m, and 1.7-2 m where the floor has the run-up for them.
    let h = snap(
        rng.range(1.5, 1.8) + if radius >= 26.0 { 0.2 } else { 0.0 },
        0.1,
    );
    let run = snap_up(h / LAUNCH_SLOPE, 0.25);
    let dir = [libm::cos(axis), libm::sin(axis)];
    let ramp = Relief {
        kind: ReliefKind::Crossover,
        x,
        z,
        dir,
        height: h,
        up: run,
        table: GATE_DECK_M,
        down: run,
        half: GATE_HALF_M,
        side: snap_up(h / SIDE_SLOPE, 0.25),
    };
    // The rocks stand over the deck: a wall beside a car on it, and beside one flying it.
    let off = GATE_HALF_M + GATE_ROCK_R_M;
    let rock = |sign: f64, h: f64| Rock {
        x: x - sign * dir[1] * off,
        z: z + sign * dir[0] * off,
        r: GATE_ROCK_R_M,
        h,
    };
    let tall = |rng: &mut Rng| snap(rng.range(h + 0.3, MAX_ISLAND_H_M), 0.1).min(MAX_ISLAND_H_M);
    let (a, b) = (tall(rng), tall(rng));
    (ramp, [rock(1.0, a), rock(-1.0, b)])
}

/// The field for a floor of `floor_r` m, from `rng`.
pub fn generate(rng: &mut Rng, floor_r: f64) -> Field {
    use core::f64::consts::{PI, TAU};
    let radius = radius_for(floor_r);
    let area = PI * radius * radius;
    let mut taken = Taken::new(radius);
    // The centrepiece: the crossover through the middle (a little off it, at any angle) and its gate.
    let (cx, cz) = {
        let a = rng.range(0.0, TAU);
        let off = rng.range(0.0, 1.0);
        (
            snap(off * libm::cos(a), 0.25),
            snap(off * libm::sin(a), 0.25),
        )
    };
    let axis = rng.range(0.0, PI);
    let (crossover, gate) = draw_crossover(rng, radius, cx, cz, axis);
    let rocks = gate.to_vec();
    // One piece: the rocks' lanes and the crossover's are taken together (the rocks stand against the deck).
    let near = (
        crossover.x,
        crossover.z,
        crossover.reach(LANE_M / 2.0 + CELL_M),
    );
    taken.take(LANE_M / 2.0, near, |x, z, pad| crossover.covers(x, z, pad));
    for rock in &rocks {
        let near = (rock.x, rock.z, rock.r + LANE_M / 2.0 + CELL_M);
        taken.take(LANE_M / 2.0, near, |x, z, pad| {
            libm::hypot(x - rock.x, z - rock.z) <= rock.r + pad
        });
    }
    // Its run-ups, which are its landings the other way: the floor before each ramp stays clear to the field's edge, as
    // wide as the gate (no jump across the way in, no dip to unsettle a car before the ramp).
    let whole = (crossover.x, crossover.z, 2.0 * radius);
    taken.take(0.0, whole, |x, z, pad| {
        let (u, lat) = crossover.local(x, z);
        (u < 0.0 || u > crossover.length()) && libm::fabs(lat) <= GATE_HALF_M + pad
    });
    // The gate's reach from the middle: no jump is tried nearer than a lane off it (the occupancy grid holds the rest).
    let island = GATE_HALF_M + 2.0 * GATE_ROCK_R_M;

    let mut relief = vec![crossover];
    // Jumps, tangential round the middle (either way round), a little off. The first two go in the room either side of
    // the gate, where a small floor has it.
    let jumps = ((area / AREA_PER_JUMP_M2) as usize).max(2);
    for k in 0..jumps {
        let kind = if k == 0 || rng.unit() < 0.65 {
            ReliefKind::TableTop
        } else {
            ReliefKind::Kicker
        };
        let mut placed = false;
        for scale in [1.0, 0.85, 0.7, 0.6] {
            let mut j = draw_jump(rng, kind, scale);
            for _ in 0..TRIES {
                let a = if k < 2 {
                    axis + PI / 2.0 + PI * k as f64 + rng.range(-0.25, 0.25)
                } else {
                    rng.range(0.0, TAU)
                };
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
                let near = (j.x, j.z, j.reach(LANE_M / 2.0 + CELL_M));
                if taken.fits(LANE_M / 2.0, near, |x, z, pad| j.covers(x, z, pad)) {
                    taken.take(LANE_M / 2.0, near, |x, z, pad| j.covers(x, z, pad));
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
                // Anywhere the occupancy grid has room (a bump keeps only its pad off the crossover's ramps).
                let lo = half + BUMP_PAD_M;
                let hi = radius - half;
                if hi <= lo {
                    break;
                }
                let rho = libm::sqrt(rng.range(lo * lo, hi * hi));
                m.x = snap(rho * libm::cos(a), 0.25);
                m.z = snap(rho * libm::sin(a), 0.25);
                let near = (m.x, m.z, m.reach(BUMP_PAD_M + CELL_M));
                if taken.fits(BUMP_PAD_M, near, |x, z, pad| m.covers(x, z, pad)) {
                    taken.take(BUMP_PAD_M, near, |x, z, pad| m.covers(x, z, pad));
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
