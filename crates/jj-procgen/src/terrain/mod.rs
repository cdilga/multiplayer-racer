//! Terrain (P1-M03c, rebuilt landscape-first by P1-FL15a / R132).
//!
//! - **The landscape comes first.** [`landforms`] places each biome's big landforms (Olgas domes, ridges, mesas with a
//!   breakaway edge, gullies) at 10-60 m along the route, over broad swells scaled so the route spans the biome's
//!   relief. Some straddle the road, some frame it from beside, some stand further out.
//! - **The road is routed over and through it.** The profile is the highest one at or below the landscape (sampled
//!   across the road's width) whose grade stays inside the biome's limit, damped in tight corners by `f = 1 - |κ|·half`
//!   (the inner edge of a corner is shorter than the centerline), then relaxed where its vertical curvature is too sharp.
//!   It climbs the swells and gentle landforms and cuts through steep ones: cuttings and gorges with walls both sides.
//! - **Banking** follows the signed plan curvature (positive bank = the left edge is lower, a left turn), is smoothed and
//!   rate-limited so the road's edges never get steeper than the grade budget, and is stored on the route points.
//! - **Off-road heights** are an inverse-distance blend of every nearby route point's tilted bed plane (so two road
//!   parts that pass close ramp smoothly between them, and a hairpin's interior has no cliff), meeting the landscape past
//!   a shoulder: small differences over a gentle drivable blend, big ones at the biome's batter, so the side reads as a
//!   wall (R133).
//!
//! Output is integer (centimetre heights, millimetre route `y`, centidegree bank); the maths is `libm` and plain `f64`
//! operations in a fixed order, so the bytes are identical natively and in WASM. The stream is `Streams::terrain`.

pub mod landforms;

use jj_map::{Biome, Map, Terrain};

use crate::assemble::arc_lengths;
use crate::seed::Rng;

/// Share of the biome's grade limit the centerline profile always gets (inner edge included), however the bank changes.
pub const PROFILE_GRADE_SHARE: f64 = 0.6;
/// Share of the grade limit the road's edges may use, profile and bank together (the rest absorbs quantisation and the
/// relaxation's small overshoots).
pub const EDGE_GRADE_SHARE: f64 = 0.85;
/// Share the bank's change of cross slope may add at an edge. The rest absorbs centimetre quantisation.
pub const BANK_GRADE_SHARE: f64 = 0.25;
/// Share of the curvature limit the profile may use (the rest absorbs the damping's kinks and quantisation).
pub const CURVATURE_SHARE: f64 = 0.8;
/// A corner this tight (radius 1/κ, m) gets the biome's full bank.
pub const FULL_BANK_RADIUS_M: f64 = 40.0;
/// The road bed extends this many grid spacings past the road edge, so every vertex a road point's cell touches is bed.
const BED_SPACINGS: f64 = 1.5;
/// Extra distance past `bed + blend` that route points still reach, so no cell inside the blend has an empty sum.
const REACH_EXTRA_M: f64 = 8.0;
/// A corridor's walls are sampled this far from the centerline (m), and are this high above the road (m).
pub const CORRIDOR_SIDE_M: (f64, f64) = (8.0, 40.0);
pub const CORRIDOR_WALL_M: f64 = 6.0;
/// Fine ground detail on top of the landforms has this wavelength, m.
const DETAIL_WAVELENGTH_M: f64 = 35.0;
/// Rises up to this much meet the road over a drivable blend; a wall's batter takes over across the next `WALL_OVER_M`.
const WALL_FROM_M: f64 = 1.5;
const WALL_OVER_M: f64 = 3.0;
/// Rise over run of the gentle blend (about 17°: a car drives it).
const DRIVABLE_SLOPE: f64 = 0.3;
const MIN_BLEND_M: f64 = 5.0;
/// A flow beat's length (m) and its grade: room for the core's longest jump envelope (ramp, flight, landing).
const FLOW_LEN_M: f64 = 200.0;
const FLOW_GRADE: f64 = 0.03;
/// A course asking for this much short of a whole beat still gets it (a 0.85 km lap at 1 per km has one).
const FLOW_ROUND_UP: f64 = 0.2;
/// A flow beat this straight (total turn, rad) can hold a jump; straighter is no better than this.
const FLOW_MAX_TURN: f64 = 0.15;
/// Off-road ground steeper than this (rise over run, about 31°: the foot of a wall, where it creases) is rock.
const ROCK_SLOPE: f64 = 0.6;
/// Nothing straddles the road on the start corridor, the finish run-in, a crossing's upper span (± this) or where the
/// lower road passes under the deck.
const KEEP_OUT_START_M: f64 = 130.0;
const KEEP_OUT_END_M: f64 = 30.0;
const KEEP_OUT_CROSSING_M: f64 = 20.0;
const KEEP_OUT_UNDER_M: f64 = 60.0;
/// The lower road stays a deck's height under the upper road's crossing point this far either side of its own, m.
const UNDER_DECK_HALF_M: f64 = 15.0;
/// The upper road's own bed shapes the ground only this close to its span's ends, m.
const DECK_END_FADE_M: f64 = 25.0;
/// Share of the deck's grade limit its cosine may reach.
const DECK_GRADE_SHARE: f64 = 0.9;
/// The road is unbanked this far past the deck's span ends too, m.
const DECK_UNBANKED_M: f64 = 10.0;
/// Envelope then curvature relaxation, repeated until the curvature holds after the envelope.
const PROFILE_ROUNDS: usize = 20;
/// Share of the curvature limit the grade allowance may change by per metre ([`ramp`]).
const RAMP_SHARE: f64 = 0.5;
/// Routing again with taller swells when the road spans too little relief: at most this many times, each by at most
/// this factor.
const RELIEF_RETRIES: usize = 3;
const RELIEF_STEP_MAX: f64 = 1.25;
const SMOOTH_ITERATIONS: usize = 4000;
/// The relaxed neighbourhood widens by a point either side every this many iterations.
const SMOOTH_WIDEN_EVERY: usize = 100;

/// A biome's terrain, as data. `max_grade` is rise over run along the road band (centerline and both edges);
/// `max_curvature` is 1/radius of the vertical profile; `max_bank_cdeg` is the largest road bank.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerrainParams {
    /// Peak-to-peak height of the broad swells along the route, m (landforms add to it; the grade limit may take some).
    pub relief_m: f64,
    /// Amplitude of the fine ground detail on top of the landforms, m.
    pub ground_relief_m: f64,
    /// Wavelength of the broad swells, m.
    pub wavelength_m: f64,
    pub max_grade: f64,
    pub max_curvature: f64,
    pub max_bank_cdeg: i16,
    /// The widest blend between the road bed and the landscape, m.
    pub blend_m: f64,
    pub landforms: landforms::Landforms,
}

/// The biome's terrain data (each biome's numbers live in its own `biome/<name>.rs`).
pub fn params(biome: Biome) -> TerrainParams {
    crate::biome::def(biome).data().terrain
}

impl TerrainParams {
    /// Blend toward `to` by `t` in 0..=1 (a transition between biomes).
    pub fn lerp(&self, to: &Self, t: f64) -> Self {
        let m = |a: f64, b: f64| a + (b - a) * t;
        Self {
            relief_m: m(self.relief_m, to.relief_m),
            ground_relief_m: m(self.ground_relief_m, to.ground_relief_m),
            wavelength_m: m(self.wavelength_m, to.wavelength_m),
            max_grade: m(self.max_grade, to.max_grade),
            max_curvature: m(self.max_curvature, to.max_curvature),
            max_bank_cdeg: libm::round(m(
                f64::from(self.max_bank_cdeg),
                f64::from(to.max_bank_cdeg),
            )) as i16,
            blend_m: m(self.blend_m, to.blend_m),
            landforms: self.landforms.lerp(&to.landforms, t),
        }
    }
}

/// Applies undulation to `map`: heights, route `y` and `bank`, and every dressing and prop pose's `y` (grounded).
/// Idempotent: it overwrites what an earlier call set.
pub fn undulate(map: &mut Map, rng: &mut Rng, p: &TerrainParams) {
    undulate_along(map, rng, &vec![*p; map.route.points.len()]);
}

/// [`undulate`] with a biome's parameters at every route point (`along[i]` for point `i`), for a route that crosses
/// biomes. Profile strength and its grade/curvature limits follow each point, so a gentle town stretch does not flatten
/// the rock climbs elsewhere. The whole closed profile uses the largest relief budget; the bank limit follows each
/// point; ground relief, wavelength and blend distance are
/// blended smoothly into the cells around the road by the same inverse-distance weights as the heights, so there is no
/// step where two biomes meet.
pub fn undulate_along(map: &mut Map, rng: &mut Rng, along: &[TerrainParams]) {
    undulate_along_crossing(
        map,
        rng,
        along,
        &[],
        &crate::tuning::GeneratorData::shipped().course.crossing,
    );
}

/// A crossing's upper road is an explicit deck. Inside the lower road's bed its profile must not contribute to the
/// ground: blending both elevations there makes a narrow bump beneath the deck. Upper influence fades back in beyond
/// the lower shoulder so the rest of the terrain and the deck's approach ends remain continuous.
pub fn undulate_along_crossing(
    map: &mut Map,
    rng: &mut Rng,
    along: &[TerrainParams],
    crossings: &[crate::course::Crossing],
    deck: &crate::tuning::CrossingData,
) {
    let min = |f: &dyn Fn(&TerrainParams) -> f64| along.iter().map(f).fold(f64::INFINITY, f64::min);
    let p = &TerrainParams {
        relief_m: along.iter().map(|q| q.relief_m).fold(0.0, f64::max),
        max_grade: min(&|q| q.max_grade),
        max_curvature: min(&|q| q.max_curvature),
        blend_m: along.iter().map(|q| q.blend_m).fold(0.0, f64::max),
        ..along[0]
    };
    let uniform = along.windows(2).all(|w| w[0] == w[1]);
    let pts: Vec<(f64, f64)> = map
        .route
        .points
        .iter()
        .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
        .collect();
    let n = pts.len();
    let half = f64::from(map.route.points[0].width) / 2000.0;
    let (s, total) = arc_lengths(&pts);
    let ds: Vec<f64> = (0..n)
        .map(|i| {
            if i + 1 < n {
                s[i + 1] - s[i]
            } else {
                total - s[i]
            }
        })
        .collect();

    // Plan curvature, signed (+ = turning left), at each point, smoothed over a few points.
    let tangent = |i: usize| {
        let (a, b) = (pts[i], pts[(i + 1) % n]);
        let l = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
        ((b.0 - a.0) / l, (b.1 - a.1) / l)
    };
    let raw_k: Vec<f64> = (0..n)
        .map(|i| {
            let (t0, t1) = (tangent((i + n - 1) % n), tangent(i));
            let turn = libm::atan2(t1.0 * t0.1 - t1.1 * t0.0, t0.0 * t1.0 + t0.1 * t1.1);
            turn / ((ds[(i + n - 1) % n] + ds[i]) / 2.0).max(1e-9)
        })
        .collect();
    let kappa = circular_mean(&raw_k, 3);
    // Largest |κ| within the road's half width either side: the inner edge's worst squeeze.
    let reach = libm::ceil(half / (total / n as f64)) as usize + 1;
    let k_edge: Vec<f64> = (0..n)
        .map(|i| {
            (0..=2 * reach)
                .map(|j| kappa[(i + n + j - reach) % n].abs())
                .fold(0.0, f64::max)
        })
        .collect();
    // Slope damping per segment i (point i to i+1).
    let f: Vec<f64> = (0..n)
        .map(|i| {
            let k = k_edge[i].max(k_edge[(i + 1) % n]);
            (1.0 - k * half).clamp(0.05, 1.0)
        })
        .collect();

    // The landscape first (P1-FL15a): landforms placed along the route and the swells under them.
    // The upper deck's whole span rides its own profile, and the lower road passes under it mid-span: nothing straddles
    // the road there.
    let keep_out = |sv: f64| {
        sv < KEEP_OUT_START_M
            || sv > total - KEEP_OUT_END_M
            || crossings.iter().any(|c| {
                (sv > c.upper.0 - KEEP_OUT_CROSSING_M && sv < c.upper.1 + KEEP_OUT_CROSSING_M)
                    || (sv - c.at.1).abs() < KEEP_OUT_UNDER_M
            })
    };
    let route_pts: Vec<landforms::RoutePoint> = (0..n)
        .map(|i| {
            let (tx, tz) = tangent(i);
            landforms::RoutePoint {
                x: pts[i].0,
                z: pts[i].1,
                tx,
                tz,
                s: s[i],
            }
        })
        .collect();
    let field = landforms::Field::place(
        &route_pts,
        total,
        half,
        &|i| along[i].landforms,
        p.relief_m,
        p.wavelength_m,
        &keep_out,
        [
            f64::from(map.terrain.origin_x) / 1000.0,
            f64::from(map.terrain.origin_z) / 1000.0,
            f64::from(map.terrain.cols - 1) * f64::from(map.terrain.spacing) / 1000.0,
            f64::from(map.terrain.rows - 1) * f64::from(map.terrain.spacing) / 1000.0,
        ],
        along.iter().map(|q| q.landforms.tilt).sum::<f64>() / n as f64,
        rng,
    );
    // Then the road is routed over and through it: the lowest profile under the landscape (across the road's width)
    // whose grade stays inside the biome's limit. It climbs whatever it can and cuts through what it can't, so steep
    // landforms become cuttings and gorges with walls both sides.
    // The deck (`crossings::place`) follows the upper road with a cosine from its span's ends to its top; the cosine is
    // steeper than the road's own rise at its middle, so the road keeps its grade low enough there.
    // Each side's cosine is its own length (the steeper, shorter side decides).
    let deck_grade: Vec<((f64, f64), f64)> = crossings
        .iter()
        .map(|c| {
            let (lo, hi) = c.halves();
            let half_span = lo.min(hi);
            let ramp = (half_span - deck.plateau_half_m).max(1.0);
            (
                c.upper,
                DECK_GRADE_SHARE * deck.max_grade_milli as f64
                    / 1000.0
                    / core::f64::consts::FRAC_PI_2
                    * ramp
                    / half_span.max(1.0),
            )
        })
        .collect();
    // Bank (as tan of the angle): toward the corner, then rate-limited so the edges stay inside the grade budget.
    let target: Vec<f64> = (0..n)
        .map(|i| {
            let max_tan =
                libm::tan(f64::from(along[i].max_bank_cdeg) * core::f64::consts::PI / 18_000.0);
            // The deck's span is unbanked (its edges follow one cosine; a banked approach would kink them).
            let on_deck = deck_grade.iter().any(|(upper, _)| {
                s[i] >= upper.0 - DECK_UNBANKED_M && s[i] <= upper.1 + DECK_UNBANKED_M
            });
            if on_deck {
                0.0
            } else {
                max_tan * (kappa[i] * FULL_BANK_RADIUS_M).clamp(-1.0, 1.0)
            }
        })
        .collect();
    let rate = BANK_GRADE_SHARE * p.max_grade / half;
    let mut bank = target;
    for _ in 0..3 {
        for i in 0..2 * n {
            let (a, b) = (i % n, (i + 1) % n);
            let lim = rate * ds[a] * f[a];
            bank[b] = bank[b].clamp(bank[a] - lim, bank[a] + lim);
        }
        for i in (0..2 * n).rev() {
            let (a, b) = (i % n, (i + n - 1) % n);
            let lim = rate * ds[b] * f[b];
            bank[b] = bank[b].clamp(bank[a] - lim, bank[a] + lim);
        }
    }
    // The stored bank is what the heights use, so the route and the heightfield agree.
    let bank_cdeg: Vec<i16> = bank
        .iter()
        .map(|&t| libm::round(libm::atan(t) * 18_000.0 / core::f64::consts::PI) as i16)
        .collect();
    let bank: Vec<f64> = bank_cdeg
        .iter()
        .map(|&c| libm::tan(f64::from(c) * core::f64::consts::PI / 18_000.0))
        .collect();

    // The road's grade budget per segment: what the biome allows at its inner edge (damped by `f`), less what the
    // bank's change of cross slope takes there. Straights get nearly all of it; corner entries and exits less. Flow
    // beats (R132) run nearly level.
    // The biome's grade limit changes no faster than the road may bend ([`ramp`]): where a gentle biome meets a steep
    // one, a step in the limit asks for a grade change sharper than the curvature allows, the relaxation bleeds the
    // steep side's climb into the gentle side and the two never settle. One biome's limit is constant, so unchanged.
    let curvature_at = |i: usize| {
        CURVATURE_SHARE
            * along[(i + n - 1) % n]
                .max_curvature
                .min(along[i].max_curvature)
                .min(along[(i + 1) % n].max_curvature)
    };
    let grade_limit = ramp(
        (0..n)
            .map(|i| along[i].max_grade.min(along[(i + 1) % n].max_grade))
            .collect(),
        &ds,
        &(0..n).map(curvature_at).collect::<Vec<_>>(),
    );
    let budget = |flow: &[bool]| -> Vec<f64> {
        (0..n)
            .map(|i| {
                let limit = grade_limit[i];
                let twist = half * (bank[(i + 1) % n] - bank[i]).abs() / ds[i].max(1e-9);
                let road = (EDGE_GRADE_SHARE * limit * f[i] - twist)
                    .max(PROFILE_GRADE_SHARE * limit * f[i]);
                let road = if flow[i] { road.min(FLOW_GRADE) } else { road };
                deck_grade
                    .iter()
                    .filter(|(upper, _)| s[i] >= upper.0 && s[i] <= upper.1)
                    .fold(road, |road, &(_, limit)| road.min(limit))
            })
            .collect()
    };
    let curvature_limit: Vec<f64> = (0..n).map(curvature_at).collect();
    // A crossing's lower road dips a deck's height under the upper road's crossing point (an underpass in its own
    // cutting), so the deck (`crossings::place`) rides at the upper road's level instead of towering over it. The cap
    // holds near the lower crossing point and the envelope carries the dip out along the approaches at the road's grade.
    let nearest = |v: f64| {
        (0..n)
            .min_by(|&a, &b| (s[a] - v).abs().total_cmp(&(s[b] - v).abs()))
            .unwrap_or(0)
    };
    let under: Vec<(usize, Vec<usize>)> = crossings
        .iter()
        .map(|c| {
            let window = (0..n)
                .filter(|&i| {
                    let d = (s[i] - c.at.1).abs();
                    d.min(total - d) <= UNDER_DECK_HALF_M
                })
                .collect();
            (nearest(c.at.0), window)
        })
        .collect();
    let under_deck = |h: &mut [f64]| {
        for (top, window) in &under {
            // The steeper side decides: a deck rising over a flat lower road onto a steep upper road is too steep.
            let dip = window
                .first()
                .map_or(1.0, |&i| along[i].landforms.underpass)
                .max(along[*top].landforms.underpass);
            let cap = h[*top] - deck.deck_height_m * dip;
            for &i in window {
                h[i] = h[i].min(cap);
            }
        }
    };
    // The upper road takes the deck's own shape across its span: level over the plateau, a cosine to each end (as
    // `crossings::place` builds the deck), so deck, road and ground agree and no edge kinks between them.
    let deck_span: Vec<(usize, usize, f64, (f64, f64))> = crossings
        .iter()
        .map(|c| (nearest(c.upper.0), nearest(c.upper.1), c.at.0, c.halves()))
        .collect();
    let deck_profile = |h: &mut [f64]| {
        for &(a, b, mid, (half_lo, half_hi)) in &deck_span {
            let top = h[nearest(mid)];
            let (start, end) = (h[a], h[b]);
            for i in a..=b {
                let half_span = if s[i] < mid { half_lo } else { half_hi };
                let u = ((s[i] - mid).abs() - deck.plateau_half_m).max(0.0)
                    / (half_span - deck.plateau_half_m).max(1.0);
                let blend = (1.0 + libm::cos(u.clamp(0.0, 1.0) * core::f64::consts::PI)) / 2.0;
                let foot = if s[i] < mid { start } else { end };
                h[i] = foot + (top - foot) * blend;
            }
        }
    };
    let mut field = field;
    let mut h = Vec::new();
    for attempt in 0..=RELIEF_RETRIES {
        let target: Vec<f64> = (0..n)
            .map(|i| {
                let (tx, tz) = tangent(i);
                let (x, z) = pts[i];
                let climb = along[i].landforms.climb_m;
                (field.at_climbing(x, z, climb)
                    + field.at_climbing(x - tz * half, z + tx * half, climb)
                    + field.at_climbing(x + tz * half, z - tx * half, climb))
                    / 3.0
            })
            .collect();
        // The lowest grade-limited line under the landscape cuts through every rise; the highest over it rides every
        // dip on an embankment. The road runs between them by the biome's fill share (a mix of two lines inside the
        // grade limit is inside it too).
        // Flow beats on straight stretches, preferring the land's highest and lowest ground: a level run there costs
        // the course no relief.
        let flow = flow_windows(
            &s,
            &ds,
            &kappa,
            &target,
            total,
            &|i| along[i].landforms.flow_per_km,
            &keep_out,
        );
        let g = budget(&flow);
        let mut low = target.clone();
        envelope(&mut low, &g, &ds);
        let mut high: Vec<f64> = target.iter().map(|v| -v).collect();
        envelope(&mut high, &g, &ds);
        h = (0..n)
            .map(|i| low[i] + along[i].landforms.fill * (-high[i] - low[i]))
            .collect();
        // The deck's shape, the underpass's dip and the grade limit, then the curvature relaxed again, until the
        // relaxation has nothing left to do: a dip or a deck applied after it would leave a sag a car bounces out of.
        for _ in 0..PROFILE_ROUNDS {
            deck_profile(&mut h);
            under_deck(&mut h);
            envelope(&mut h, &g, &ds);
            if !smooth_curvature(&mut h, &ds, &curvature_limit) {
                break;
            }
        }
        // The envelope shaves the swells' peaks where they are steeper than the road may climb. If the road spans
        // too little of the biome's relief, the swells grow and the road is routed again.
        let lo = h.iter().copied().fold(f64::INFINITY, f64::min);
        let hi = h.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        if hi - lo >= p.relief_m || attempt == RELIEF_RETRIES {
            break;
        }
        field.scale_swells((p.relief_m / (hi - lo).max(1.0)).min(RELIEF_STEP_MAX));
    }
    // Bank sign (jj.map.v1 `bank`, centidegrees): positive leans the road toward its LEFT, i.e. the left edge is the
    // lower one, which is what a left-hand corner wants. "Left" is the left of travel; with the sim's handedness (+y up,
    // a car facing +z has +x on its left) that is the (tz, -tx) side of the tangent, and `lateral` in the validator's
    // `Near` (positive on (-tz, tx)) is the right. A right-hand corner gets a negative bank.
    for (i, q) in map.route.points.iter_mut().enumerate() {
        q.y = libm::round(h[i] * 1000.0) as i32;
        q.bank = bank_cdeg[i];
    }

    // Heightfield.
    let t = &map.terrain;
    let (cols, rows) = (t.cols as usize, t.rows as usize);
    let sp = f64::from(t.spacing) / 1000.0;
    let (ox, oz) = (
        f64::from(t.origin_x) / 1000.0,
        f64::from(t.origin_z) / 1000.0,
    );
    let bed = half + BED_SPACINGS * sp;
    let reach_m = bed + p.blend_m + REACH_EXTRA_M;
    let layer_weight: Vec<(Vec<Option<f64>>, Vec<f64>)> = crossings
        .iter()
        .map(|c| {
            let (upper, lower) = (c.upper, c.lower);
            // Inside its span the upper road is the deck (`crossings::place`): the ground there follows the lower road and
            // the landscape, not the upper road's bed (that would stand an embankment a deck's height high beside the
            // underpass). Its influence fades back in toward the span's ends, where the deck meets the ground.
            let upper: Vec<Option<f64>> = s
                .iter()
                .map(|&v| {
                    (v >= upper.0 && v <= upper.1)
                        .then(|| 1.0 - smooth((v - upper.0).min(upper.1 - v) / DECK_END_FADE_M))
                })
                .collect();
            let lower: Vec<usize> = s
                .iter()
                .enumerate()
                .filter_map(|(i, &v)| (v >= lower.0 && v <= lower.1).then_some(i))
                .collect();
            // Only cells inside the lower corridor can change an upper weight. Rasterise segment neighbourhoods instead
            // of searching every lower segment for every cell in the world (important for WASM preparation latency).
            let mut distances = vec![f64::INFINITY; cols * rows];
            let fade = bed + p.blend_m;
            for w in lower.windows(2) {
                let (a, b) = (pts[w[0]], pts[w[1]]);
                let (dx, dz) = (b.0 - a.0, b.1 - a.1);
                let c0 = libm::floor(((a.0.min(b.0) - fade - ox) / sp).max(0.0)) as usize;
                let c1 =
                    (libm::ceil(((a.0.max(b.0) + fade - ox) / sp).max(0.0)) as usize).min(cols - 1);
                let r0 = libm::floor(((a.1.min(b.1) - fade - oz) / sp).max(0.0)) as usize;
                let r1 =
                    (libm::ceil(((a.1.max(b.1) + fade - oz) / sp).max(0.0)) as usize).min(rows - 1);
                for r in r0..=r1 {
                    for c in c0..=c1 {
                        let (x, z) = (ox + c as f64 * sp, oz + r as f64 * sp);
                        let t = (((x - a.0) * dx + (z - a.1) * dz) / (dx * dx + dz * dz))
                            .clamp(0.0, 1.0);
                        let distance = (x - a.0 - t * dx).powi(2) + (z - a.1 - t * dz).powi(2);
                        let at = r * cols + c;
                        distances[at] = distances[at].min(distance);
                    }
                }
            }
            let cells: Vec<f64> = distances
                .into_iter()
                .map(|distance| {
                    let distance = libm::sqrt(distance);
                    let k = ((distance - bed) / p.blend_m).clamp(0.0, 1.0);
                    k * k * (3.0 - 2.0 * k)
                })
                .collect();
            (upper, cells)
        })
        .collect();
    // The road's grade at each point (central difference), for its bed plane.
    let slope: Vec<f64> = (0..n)
        .map(|i| (h[(i + 1) % n] - h[(i + n - 1) % n]) / (ds[i] + ds[(i + n - 1) % n]).max(1e-9))
        .collect();
    let kernel = |d2: f64| 1.0 / ((d2 + 1.0) * (d2 + 1.0) * (d2 + 1.0));
    let edge = kernel(reach_m * reach_m);
    let mut wsum = vec![0.0f64; cols * rows];
    let mut hsum = vec![0.0f64; cols * rows];
    let mut dmin = vec![f64::INFINITY; cols * rows];
    // Detail relief, batter, shoulder and blend per cell: the same weights, so biome changes are continuous.
    let mut gsum = vec![[0.0f64; 4]; if uniform { 0 } else { cols * rows }];
    for i in 0..n {
        let (px, pz) = pts[i];
        let (tx, tz) = tangent(i);
        // Unit vector toward the right of travel (+ lateral); the left edge is lower for positive bank.
        let (nx, nz) = (-tz, tx);
        let c0 = libm::floor(((px - reach_m - ox) / sp).max(0.0)) as usize;
        let c1 = (libm::ceil(((px + reach_m - ox) / sp).max(0.0)) as usize).min(cols - 1);
        let r0 = libm::floor(((pz - reach_m - oz) / sp).max(0.0)) as usize;
        let r1 = (libm::ceil(((pz + reach_m - oz) / sp).max(0.0)) as usize).min(rows - 1);
        for r in r0..=r1 {
            for c in c0..=c1 {
                let (x, z) = (ox + c as f64 * sp, oz + r as f64 * sp);
                let d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
                if d2 >= reach_m * reach_m {
                    continue;
                }
                let at = r * cols + c;
                // On a crossing's upper span, that crossing's lower road decides.
                let layer = layer_weight
                    .iter()
                    .find_map(|(upper, cells)| upper[i].map(|end| cells[at] * end))
                    .unwrap_or(1.0);
                if layer == 0.0 {
                    continue;
                }
                let w = (kernel(d2) - edge) * layer;
                // Carry the bank across the whole bed, including the vertices beyond the painted edge. Clamping
                // at the road's half-width flattens those vertices and bilinear sampling loses bank at the edge.
                let lateral = ((x - px) * nx + (z - pz) * nz).clamp(-bed, bed);
                // And the road's slope along it, out to its neighbours: a plane level along the road terraces a steep
                // climb into 2.5 m steps under this sharp kernel.
                let ahead = ((x - px) * tx + (z - pz) * tz).clamp(-ds[i], ds[i]);
                wsum[at] += w;
                hsum[at] += w * (h[i] + ahead * slope[i] + lateral * bank[i]);
                if !uniform {
                    let q = &along[i];
                    gsum[at][0] += w * q.ground_relief_m;
                    gsum[at][1] += w * q.landforms.batter;
                    gsum[at][2] += w * q.landforms.shoulder_m;
                    gsum[at][3] += w * q.blend_m;
                }
                dmin[at] = dmin[at].min(d2);
            }
        }
    }
    let nseed = rng.next_u64();
    let land = field.raster(cols, rows, ox, oz, sp);
    let mut heights = Vec::with_capacity(cols * rows);
    for r in 0..rows {
        for c in 0..cols {
            let at = r * cols + c;
            let (x, z) = (ox + c as f64 * sp, oz + r as f64 * sp);
            let (relief, batter, shoulder, blend) = if uniform || wsum[at] <= 0.0 {
                let l = &along[0].landforms;
                (along[0].ground_relief_m, l.batter, l.shoulder_m, p.blend_m)
            } else {
                let g = gsum[at];
                (
                    g[0] / wsum[at],
                    g[1] / wsum[at],
                    g[2] / wsum[at],
                    g[3] / wsum[at],
                )
            };
            let ground = land[at] + relief * fbm(nseed, x, z, DETAIL_WAVELENGTH_M);
            let v = if wsum[at] > 0.0 {
                let road = hsum[at] / wsum[at];
                // The ground meets the road past the shoulder: a small difference over a gentle, drivable blend; a big
                // one (a cutting through a landform, an embankment over a gully) at the biome's batter, so it reads
                // as a wall rather than a slope you might try.
                let rise = (ground - road).abs();
                let steep = smooth((rise - WALL_FROM_M) / WALL_OVER_M);
                let slope = DRIVABLE_SLOPE + (batter.max(DRIVABLE_SLOPE) - DRIVABLE_SLOPE) * steep;
                let width = (rise / slope).clamp(MIN_BLEND_M, blend);
                let k = smooth((libm::sqrt(dmin[at]) - bed - shoulder) / width);
                road + (ground - road) * k
            } else {
                ground
            };
            heights.push(libm::round(v * 100.0) as i16);
        }
    }
    // Nothing under the deck stands above it: across the upper span the ground within the upper road's bed is cut down
    // to that road's own profile (the deck clears it; a hill under the span would otherwise lift the deck over it).
    if !crossings.is_empty() {
        let mut ceiling = vec![f64::INFINITY; cols * rows];
        // Only past the end fade: near its ends the deck meets the upper road's own ground, which must stay put.
        for i in (0..n).filter(|&i| {
            crossings.iter().any(|c| {
                c.on_upper(s[i]) && (s[i] - c.upper.0).min(c.upper.1 - s[i]) >= DECK_END_FADE_M
            })
        }) {
            let (px, pz) = pts[i];
            let c0 = libm::floor(((px - bed - ox) / sp).max(0.0)) as usize;
            let c1 = (libm::ceil(((px + bed - ox) / sp).max(0.0)) as usize).min(cols - 1);
            let r0 = libm::floor(((pz - bed - oz) / sp).max(0.0)) as usize;
            let r1 = (libm::ceil(((pz + bed - oz) / sp).max(0.0)) as usize).min(rows - 1);
            for r in r0..=r1 {
                for c in c0..=c1 {
                    let (x, z) = (ox + c as f64 * sp, oz + r as f64 * sp);
                    if (x - px) * (x - px) + (z - pz) * (z - pz) <= bed * bed {
                        let at = r * cols + c;
                        ceiling[at] = ceiling[at].min(h[i]);
                    }
                }
            }
        }
        for (v, top) in heights.iter_mut().zip(&ceiling) {
            if top.is_finite() {
                *v = (*v).min(libm::round(top * 100.0) as i16);
            }
        }
    }
    map.terrain.heights = heights;
    // Walls read as rock: off-road cells steeper than `ROCK_SLOPE` (a cutting's or a gorge's face, a breakaway, a dome's
    // flank) are painted rock, so the renderer and the sim see the faces the road is cut through.
    let t = &mut map.terrain;
    let cell = |c: usize, r: usize| f64::from(t.heights[r * cols + c]) / 100.0;
    let steep: Vec<bool> = (0..cols * rows)
        .map(|at| {
            let (c, r) = (at % cols, at / cols);
            let (c0, c1) = (c.saturating_sub(1), (c + 1).min(cols - 1));
            let (r0, r1) = (r.saturating_sub(1), (r + 1).min(rows - 1));
            let gx = (cell(c1, r) - cell(c0, r)) / (sp * (c1 - c0).max(1) as f64);
            let gz = (cell(c, r1) - cell(c, r0)) / (sp * (r1 - r0).max(1) as f64);
            libm::hypot(gx, gz) > ROCK_SLOPE
        })
        .collect();
    for (surface, steep) in t.surfaces.iter_mut().zip(steep) {
        if steep && *surface == jj_map::Surface::OffTrack {
            *surface = jj_map::Surface::Rock;
        }
    }
    // Taller off-road terrain can extend below the old fixed kill plane. Keep every real ground cell above it, with
    // the same twenty-metre fall margin the flat assembler used. Ground contact must never itself be a wreck.
    let lowest = i32::from(*map.terrain.heights.iter().min().expect("terrain grid")) * 10;
    map.header.bounds.kill_y = (-20_000).min(lowest - 20_000);

    // The route describes the surface the car actually drives, including grid quantisation and layer blending.
    // Taller profiles amplify the small difference between the analytical curve and its heightfield. Project the
    // painted road/gates onto that ground; the crossing pass supplies the separate upper deck profile afterwards.
    for (i, q) in map.route.points.iter_mut().enumerate() {
        // Across a crossing's upper span the road is the deck: it keeps the profile it was routed on (the ground under
        // it follows the lower road and the landscape), and `crossings::place` builds the deck no lower than that.
        if crossings.iter().any(|c| c.on_upper(s[i])) {
            q.y = libm::round(h[i] * 1000.0) as i32;
            continue;
        }
        // Route poses are whole millimetres. Subtract the grid origin as integers so dressing that expands bounds
        // cannot change a half-millimetre rounding tie through floating-point cancellation in world coordinates.
        let t = &map.terrain;
        let coordinate = |v: i32, origin: i32, count: u32| {
            let spacing = i64::from(t.spacing);
            let offset =
                (i64::from(v) - i64::from(origin)).clamp(0, i64::from(count - 1) * spacing);
            let cell = offset.div_euclid(spacing);
            let fraction = offset.rem_euclid(spacing) as f64 / spacing as f64;
            (cell as usize, fraction)
        };
        let ((c, fc), (r, fr)) = (
            coordinate(q.x, t.origin_x, t.cols),
            coordinate(q.z, t.origin_z, t.rows),
        );
        q.y = libm::round(cell_height_m(t, c, r, fc, fr) * 1000.0) as i32;
    }

    // Everything placed stands on the ground.
    let terrain = map.terrain.clone();
    for pose in map
        .dressing
        .iter_mut()
        .map(|d| &mut d.pose)
        .chain(map.props.iter_mut().map(|q| &mut q.pose))
    {
        let y = ground_height_m(
            &terrain,
            f64::from(pose.x) / 1000.0,
            f64::from(pose.z) / 1000.0,
        );
        pose.y = libm::round(y * 1000.0) as i32;
    }
}

/// How deep the road runs in the landscape at each route point, m: on each side the highest ground
/// [`CORRIDOR_SIDE_M`] out from the centerline, the lower of the two sides, less the road's height. A corridor (a cutting
/// or a gorge, walls both sides) is where this is at least [`CORRIDOR_WALL_M`].
pub fn corridor_depth_m(map: &Map) -> Vec<f64> {
    let p = &map.route.points;
    let n = p.len();
    (0..n)
        .map(|i| {
            let (a, b) = (&p[i], &p[(i + 1) % n]);
            let (x, z) = (f64::from(a.x) / 1000.0, f64::from(a.z) / 1000.0);
            let (dx, dz) = (f64::from(b.x - a.x) / 1000.0, f64::from(b.z - a.z) / 1000.0);
            let l = libm::hypot(dx, dz).max(1e-9);
            let (nx, nz) = (-dz / l, dx / l);
            let side = |sign: f64| {
                (0..=8)
                    .map(|k| {
                        CORRIDOR_SIDE_M.0
                            + (CORRIDOR_SIDE_M.1 - CORRIDOR_SIDE_M.0) * f64::from(k) / 8.0
                    })
                    .map(|d| ground_height_m(&map.terrain, x + sign * nx * d, z + sign * nz * d))
                    .fold(f64::NEG_INFINITY, f64::max)
            };
            side(1.0).min(side(-1.0)) - f64::from(a.y) / 1000.0
        })
        .collect()
}

/// The ground height (m) at world `(x, z)` m, bilinear on the heightfield the way the car drives it (clamped to the
/// grid's edge).
pub fn ground_height_m(t: &Terrain, x: f64, z: f64) -> f64 {
    // Split the world-grid fraction before subtracting the grid origin. Moving bounds by whole cells (e.g. new
    // roadside dressing) must not change interpolation or a feature's millimetre rounding tie on the same road.
    let coordinate = |world_m: f64, origin: i32, count: u32| {
        let origin = i64::from(origin);
        let spacing = i64::from(t.spacing);
        let world = world_m * 1000.0 / f64::from(t.spacing);
        let whole = libm::floor(world);
        let fraction = world - whole - origin.rem_euclid(spacing) as f64 / spacing as f64;
        let carry = libm::floor(fraction);
        let cell = whole - origin.div_euclid(spacing) as f64 + carry;
        if cell < 0.0 {
            (0, 0.0)
        } else if cell >= f64::from(count - 1) {
            ((count - 1) as usize, 0.0)
        } else {
            (cell as usize, fraction - carry)
        }
    };
    let ((c, fc), (r, fr)) = (
        coordinate(x, t.origin_x, t.cols),
        coordinate(z, t.origin_z, t.rows),
    );
    cell_height_m(t, c, r, fc, fr)
}

fn cell_height_m(t: &Terrain, c0: usize, r0: usize, fc: f64, fr: f64) -> f64 {
    let (c1, r1) = (
        (c0 + 1).min(t.cols as usize - 1),
        (r0 + 1).min(t.rows as usize - 1),
    );
    let g = |cc: usize, rr: usize| f64::from(t.heights[rr * t.cols as usize + cc]) / 100.0;
    let top = g(c0, r0) + (g(c1, r0) - g(c0, r0)) * fc;
    let bot = g(c0, r1) + (g(c1, r1) - g(c0, r1)) * fc;
    top + (bot - top) * fr
}

fn smooth(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The largest profile at or below `h` whose rise per segment stays inside `g[i] · ds[i]` (a lower envelope on the
/// closed loop: two passes each way reach every point from every other).
fn envelope(h: &mut [f64], g: &[f64], ds: &[f64]) {
    let n = h.len();
    for _ in 0..2 {
        for i in 0..2 * n {
            let (a, b) = (i % n, (i + 1) % n);
            h[b] = h[b].min(h[a] + g[a] * ds[a]);
        }
        for i in (0..2 * n).rev() {
            let (a, b) = ((i + 1) % n, i % n);
            h[b] = h[b].min(h[a] + g[b] * ds[b]);
        }
    }
}

/// `g` lowered so it changes by at most half of `limit` (per metre) from one point to the next, round the loop.
fn ramp(mut g: Vec<f64>, ds: &[f64], limit: &[f64]) -> Vec<f64> {
    let n = g.len();
    for _ in 0..2 {
        for i in 0..2 * n {
            let (a, b) = (i % n, (i + 1) % n);
            g[b] = g[b].min(g[a] + RAMP_SHARE * limit[b] * ds[a]);
        }
        for i in (0..2 * n).rev() {
            let (a, b) = ((i + 1) % n, i % n);
            g[b] = g[b].min(g[a] + RAMP_SHARE * limit[b] * ds[b]);
        }
    }
    g
}

/// Relaxes the points whose vertical curvature exceeds `limit` (and their neighbours) until none does. Returns whether
/// it changed anything.
fn smooth_curvature(h: &mut [f64], ds: &[f64], limit: &[f64]) -> bool {
    let n = h.len();
    let bad_at = |h: &[f64], i: usize| {
        let p = (i + n - 1) % n;
        let k = ((h[(i + 1) % n] - h[i]) / ds[i] - (h[i] - h[p]) / ds[p]).abs()
            / ((ds[i] + ds[p]) / 2.0);
        k > limit[i]
    };
    // Each iteration moves only the points near a bad one, and a point's curvature reads only its neighbours, so only
    // those points and their neighbours are judged again (br-cxqk: a full scan per iteration was most of the terrain's
    // time). The same points move to the same values as a full scan's.
    let mut bad_list: Vec<usize> = (0..n).filter(|&i| bad_at(h, i)).collect();
    let mut changed = false;
    let (mut near, mut seen) = (vec![false; n], vec![false; n]);
    let (mut near_list, mut moved, mut judged) = (Vec::new(), Vec::new(), Vec::new());
    for iteration in 0..SMOOTH_ITERATIONS {
        if bad_list.is_empty() {
            return changed;
        }
        changed = true;
        // A wide violation (a deep cutting's shoulders) relaxes slowly point by point: the neighbourhood that is
        // relaxed with each bad point widens as the iterations go on.
        let reach = 1 + iteration / SMOOTH_WIDEN_EVERY;
        near_list.clear();
        for &i in &bad_list {
            for k in 0..=2 * reach {
                let j = (i + n + k - reach) % n;
                if !near[j] {
                    near[j] = true;
                    near_list.push(j);
                }
            }
        }
        moved.clear();
        moved.extend(
            near_list
                .iter()
                .map(|&i| (i, (h[(i + n - 1) % n] + 2.0 * h[i] + h[(i + 1) % n]) / 4.0)),
        );
        for &(i, v) in &moved {
            h[i] = v;
            near[i] = false;
        }
        judged.clear();
        for &i in bad_list.iter().chain(&near_list) {
            for j in [(i + n - 1) % n, i, (i + 1) % n] {
                if !seen[j] {
                    seen[j] = true;
                    judged.push(j);
                }
            }
        }
        bad_list.clear();
        for &j in &judged {
            seen[j] = false;
            if bad_at(h, j) {
                bad_list.push(j);
            }
        }
    }
    changed
}

/// The flow beats: windows of `FLOW_LEN_M` on the straightest stretches clear of the keep-outs, as many whole beats as
/// the density along the course asks for, each `FLOW_LEN_M` clear of the next. True inside one.
fn flow_windows(
    s: &[f64],
    ds: &[f64],
    kappa: &[f64],
    height: &[f64],
    total: f64,
    per_km: &dyn Fn(usize) -> f64,
    keep_out: &dyn Fn(f64) -> bool,
) -> Vec<bool> {
    let n = s.len();
    let mut flow = vec![false; n];
    let wanted: f64 = (0..n).map(|i| per_km(i) * ds[i] / 1000.0).sum();
    if wanted <= 0.0 {
        return flow;
    }
    // Whole beats only: a sprint lap too short for one keeps its climb (its set piece carries the stunt).
    let count = libm::floor(wanted + FLOW_ROUND_UP) as usize;
    let len = (libm::ceil(FLOW_LEN_M / (total / n as f64)) as usize).min(n);
    let lo = height.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = height.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let mid = (lo + hi) / 2.0;
    // Each start's window: straight enough for a jump first, then the most extreme ground (a level run at the course's
    // top or bottom costs no relief), then the straightest. None where it touches a keep-out.
    let mut candidates: Vec<(bool, f64, f64, usize)> = (0..n)
        .filter_map(|i| {
            let (mut turn, mut sum) = (0.0, 0.0);
            for k in 0..len {
                let j = (i + k) % n;
                if keep_out(s[j]) {
                    return None;
                }
                turn += (kappa[j] * ds[j]).abs();
                sum += height[j];
            }
            let extreme = (sum / len as f64 - mid).abs() / ((hi - lo) / 2.0).max(1e-9);
            Some((turn > FLOW_MAX_TURN, -extreme, turn, i))
        })
        .collect();
    candidates.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then(if a.0 {
                a.2.total_cmp(&b.2)
            } else {
                a.1.total_cmp(&b.1)
            })
            .then(a.3.cmp(&b.3))
    });
    let mut starts: Vec<usize> = Vec::new();
    for (_, _, _, i) in candidates {
        if starts.len() == count {
            break;
        }
        let apart = starts.iter().all(|&j| {
            let d = (s[i] - s[j]).abs();
            d.min(total - d) >= 2.0 * FLOW_LEN_M
        });
        if apart {
            starts.push(i);
        }
    }
    for i in starts {
        for k in 0..len {
            flow[(i + k) % n] = true;
        }
    }
    flow
}

/// Mean over `±w` neighbours on a closed loop.
fn circular_mean(v: &[f64], w: usize) -> Vec<f64> {
    let n = v.len();
    (0..n)
        .map(|i| (0..=2 * w).map(|j| v[(i + n + j - w) % n]).sum::<f64>() / (2 * w + 1) as f64)
        .collect()
}

fn hash2(seed: u64, x: i64, z: i64) -> f64 {
    let mut h = seed
        ^ (x as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ (z as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    h ^= h >> 33;
    h = h.wrapping_mul(0xFF51_AFD7_ED55_8CCD);
    h ^= h >> 33;
    h = h.wrapping_mul(0xC4CE_B9FE_1A85_EC53);
    h ^= h >> 33;
    (h >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
}

/// Smooth value noise in [-1, 1].
fn value_noise(seed: u64, x: f64, z: f64) -> f64 {
    let (xi, zi) = (libm::floor(x), libm::floor(z));
    let (fx, fz) = (x - xi, z - zi);
    let sm = |t: f64| t * t * (3.0 - 2.0 * t);
    let (sx, sz) = (sm(fx), sm(fz));
    let (xi, zi) = (xi as i64, zi as i64);
    let (a, b) = (hash2(seed, xi, zi), hash2(seed, xi + 1, zi));
    let (c, d) = (hash2(seed, xi, zi + 1), hash2(seed, xi + 1, zi + 1));
    let top = a + (b - a) * sx;
    let bot = c + (d - c) * sx;
    top + (bot - top) * sz
}

/// Three-octave fBm value noise, amplitude about 1.
fn fbm(seed: u64, x: f64, z: f64, wavelength: f64) -> f64 {
    let mut sum = 0.0;
    let (mut amp, mut freq) = (1.0, 1.0 / wavelength);
    for o in 0..3u64 {
        sum += amp * value_noise(seed.wrapping_add(o * 7919), x * freq, z * freq);
        amp *= 0.5;
        freq *= 2.0;
    }
    sum / 1.75
}
