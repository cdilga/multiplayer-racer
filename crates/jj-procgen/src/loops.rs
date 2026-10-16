//! Loops in generated maps (br-xlvx.6.4, R124: "longer, higher, crossings, loops"). A vertical loop (jj-map
//! `looping`) takes a long straight: the road runs straight for `runInM` into its entry, the deck carries the car up and
//! over, and comes down at its exit `shift` metres to one side (so the two decks clear each other), from where the road
//! eases back onto its old line over `backM`.
//!
//! Two steps, either side of the terrain:
//! - [`jog`], on the course's centreline before the map is assembled: picks a site on a beat straight and moves the
//!   points from the entry to the exit onto the diagonal under the deck and the next `backM` onto the eased return. The
//!   road bed, surfaces and biomes are then laid along the jogged line like any other.
//! - [`place`], on the assembled map: cuts the ground under the loop's footprint down to a ramp from its entry to its
//!   exit wherever it stands higher (refusing a cut deeper than `maxReliefM`), stands the route and everything placed on it, takes gates and recovery off
//!   the loop's span and adds the Loop feature, checked against its contract.
//!
//! The small features keep clear of a loop's straight ([`clear_of`]) and the roadside furniture off its footprint
//! ([`clear_footprints`]).

use std::collections::BTreeMap;
use std::sync::OnceLock;

use jj_map::looping::{self, LoopDesign};
use jj_map::model::{Feature, FeatureKind, Map, Pose, Span};
use serde::Deserialize;

use crate::assemble::{arc_lengths, mm};
use crate::seed::Rng;
use crate::terrain::ground_height_m;

const SHIPPED: &str = include_str!("../../../assets/profiles/loops.json");

/// assets/profiles/loops.json.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoopData {
    #[serde(rename = "//", default)]
    pub note: String,
    pub per_lap: u32,
    pub radius_m: [f64; 2],
    pub run_out_radii: [f64; 2],
    pub shift_m: [f64; 2],
    pub run_in_m: f64,
    pub back_m: f64,
    pub max_relief_m: f64,
    pub thickness_m: f64,
    pub barrier_height_m: f64,
    pub barrier_width_m: f64,
    pub segments: u32,
    pub min_speed_mps: f64,
}

/// The shipped data, parsed once.
pub fn shipped() -> &'static LoopData {
    static DATA: OnceLock<LoopData> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(SHIPPED).expect("assets/profiles/loops.json parses"))
}

/// A loop's site on the jogged centreline: its entry and exit points, radius and signed sideways shift (m, + left).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Site {
    pub entry: usize,
    pub exit: usize,
    pub radius_m: f64,
    pub shift_m: f64,
}

/// A placed loop's stretch of road along the lap, m: its run-in to the end of its return.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub from_s: f64,
    pub to_s: f64,
}

/// Points of a candidate straight may stray this far off its line, m.
const STRAIGHT_TOL_M: f64 = 0.75;
/// The ground under the deck is cut this far below its lowest point there, m.
const DECK_CLEAR_M: f64 = 0.5;
/// A cut's sides rise this much per metre out (about 35 degrees).
const BANK_SLOPE: f64 = 0.7;
/// Roadside furniture keeps this far off a loop's footprint, m.
const FURNITURE_CLEAR_M: f64 = 2.0;

fn sub(a: (f64, f64), b: (f64, f64)) -> (f64, f64) {
    (a.0 - b.0, a.1 - b.1)
}

fn dot(a: (f64, f64), b: (f64, f64)) -> f64 {
    a.0 * b.0 + a.1 * b.1
}

/// The closest the decks may sit to each other's line, m (jj-map looping's clearance rule).
fn least_shift(half_width: f64, data: &LoopData) -> f64 {
    2.0 * (half_width + data.barrier_width_m)
        + looping::limits::MIN_SIDE_CLEARANCE_MM as f64 / 1000.0
}

/// Picks up to `data.per_lap` loop sites on `spans` (arc-length stretches of `centerline`, the course's beat straights)
/// and jogs the centreline for each. Returns the sites and why candidates were turned down (R90).
pub fn jog(
    centerline: &mut [(f64, f64)],
    spans: &[(f64, f64)],
    width_m: f64,
    rng: &mut Rng,
    data: &LoopData,
) -> (Vec<Site>, BTreeMap<String, u32>) {
    let mut sites = Vec::new();
    let mut rejects: BTreeMap<String, u32> = BTreeMap::new();
    let n = centerline.len();
    if data.per_lap == 0 || n < 16 {
        return (sites, rejects);
    }
    let (s, total) = arc_lengths(centerline);
    let index_at = |target: f64| s.iter().position(|&v| v >= target);
    let mut order: Vec<(f64, (f64, f64))> = spans.iter().map(|&sp| (rng.unit(), sp)).collect();
    order.sort_by(|a, b| a.0.total_cmp(&b.0));
    for (_, (lo, hi)) in order {
        if sites.len() >= data.per_lap as usize {
            break;
        }
        let mut reject = |why: &str| *rejects.entry(why.to_string()).or_default() += 1;
        let radius = rng.range(data.radius_m[0], data.radius_m[1]);
        let run_out = radius * rng.range(data.run_out_radii[0], data.run_out_radii[1]);
        let shift = rng
            .range(data.shift_m[0], data.shift_m[1])
            .max(least_shift(width_m / 2.0, data));
        let side = if rng.unit() < 0.5 { 1.0 } else { -1.0 };
        let need = data.run_in_m + run_out + data.back_m;
        // A straight across the lap's seam would jog the start corridor.
        if lo < 0.0 || hi > total || hi - lo < need {
            reject("short");
            continue;
        }
        let s_entry = lo + data.run_in_m + rng.unit() * (hi - lo - need);
        let (Some(a), Some(e), Some(b)) = (
            index_at(s_entry - data.run_in_m),
            index_at(s_entry),
            index_at(s_entry + run_out + data.back_m),
        ) else {
            reject("short");
            continue;
        };
        if a == 0 || b + 1 >= n {
            reject("seam");
            continue;
        }
        let (pa, pe) = (centerline[a], centerline[e]);
        let len = dot(sub(pe, pa), sub(pe, pa)).sqrt();
        if len < 1e-6 {
            reject("short");
            continue;
        }
        let f = ((pe.0 - pa.0) / len, (pe.1 - pa.1) / len);
        // jj-map looping's frame: left = up × forward.
        let left = (f.1, -f.0);
        if (a..=b).any(|k| dot(sub(centerline[k], pe), left).abs() > STRAIGHT_TOL_M) {
            reject("bent");
            continue;
        }
        let along: Vec<f64> = (e..=b).map(|k| dot(sub(centerline[k], pe), f)).collect();
        let Some(x) = along.iter().position(|&v| v >= run_out).map(|k| e + k) else {
            reject("short");
            continue;
        };
        let run_out = along[x - e];
        let lateral = |u: f64| {
            if u <= run_out {
                side * shift * u / run_out
            } else {
                let t = ((u - run_out) / data.back_m).min(1.0);
                side * shift * (1.0 + libm::cos(core::f64::consts::PI * t)) / 2.0
            }
        };
        for (k, &u) in (e..=b).zip(&along) {
            let l = lateral(u);
            centerline[k] = (pe.0 + f.0 * u + left.0 * l, pe.1 + f.1 * u + left.1 * l);
        }
        sites.push(Site {
            entry: e,
            exit: x,
            radius_m: radius,
            shift_m: side * shift,
        });
    }
    (sites, rejects)
}

/// The loop's contract params for a site.
fn params_of(site: &Site, data: &LoopData) -> BTreeMap<String, i64> {
    [
        ("entry", site.entry as i64),
        ("exit", site.exit as i64),
        ("radiusMm", i64::from(mm(site.radius_m))),
        ("thicknessMm", i64::from(mm(data.thickness_m))),
        ("barrierHeightMm", i64::from(mm(data.barrier_height_m))),
        ("barrierWidthMm", i64::from(mm(data.barrier_width_m))),
        ("segments", i64::from(data.segments)),
        ("minSpeedMms", i64::from(mm(data.min_speed_mps))),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

/// A loop's plan footprint in its frame: along the road from its entry and sideways (+ left), m.
struct Footprint {
    e: [f64; 3],
    forward: [f64; 2],
    left: [f64; 2],
    along: (f64, f64),
    lateral: (f64, f64),
    y_exit: f64,
    run_out: f64,
}

impl Footprint {
    fn of(map: &Map, d: &LoopDesign) -> Option<Self> {
        let fr = looping::frame(map, d)?;
        let reach = fr.half_width + d.barrier_w;
        Some(Self {
            e: fr.e,
            forward: fr.forward,
            left: fr.left,
            along: (0.0, fr.run_out),
            lateral: (fr.shift.min(0.0) - reach, fr.shift.max(0.0) + reach),
            y_exit: fr.y_exit,
            run_out: fr.run_out,
        })
    }

    /// How far (x, z) lies outside the footprint, m (0 inside), and the flat ground's height there.
    fn at(&self, x: f64, z: f64) -> (f64, f64) {
        let (dx, dz) = (x - self.e[0], z - self.e[2]);
        let u = dx * self.forward[0] + dz * self.forward[1];
        let v = dx * self.left[0] + dz * self.left[1];
        let out = |w: f64, (lo, hi): (f64, f64)| (lo - w).max(w - hi).max(0.0);
        let (ou, ov) = (out(u, self.along), out(v, self.lateral));
        let t = (u / self.run_out).clamp(0.0, 1.0);
        (
            libm::hypot(ou, ov),
            self.e[1] + (self.y_exit - self.e[1]) * t,
        )
    }
}

/// Lays each site's loop into the assembled `map` (whose centreline [`jog`] made). Returns the loops placed and why
/// sites were turned down (R90).
pub fn place(
    map: &mut Map,
    sites: &[Site],
    data: &LoopData,
) -> (Vec<Placed>, BTreeMap<String, u32>) {
    let mut placed = Vec::new();
    let mut rejects: BTreeMap<String, u32> = BTreeMap::new();
    let n = map.route.points.len();
    let pts: Vec<(f64, f64)> = map
        .route
        .points
        .iter()
        .map(|p| (f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0))
        .collect();
    let (s, _) = arc_lengths(&pts);
    for site in sites {
        let params = params_of(site, data);
        let Some(d) = LoopDesign::of_params(&params) else {
            continue;
        };
        if site.exit + 2 >= n {
            *rejects.entry("seam".into()).or_default() += 1;
            continue;
        }
        let before = (map.terrain.clone(), map.route.clone());
        // The ground at the ends, as the road lies on it now, sets the deck's ends.
        let Some(fp) = Footprint::of(map, &d) else {
            *rejects.entry("frame".into()).or_default() += 1;
            continue;
        };
        if !earthworks(map, &fp, &d, data.max_relief_m) {
            (map.terrain, map.route) = before;
            *rejects.entry("relief".into()).or_default() += 1;
            continue;
        }
        let q = map.route.points[site.entry];
        let feature = Feature {
            kind: FeatureKind::Loop,
            pose: Pose {
                x: q.x,
                y: q.y,
                z: q.z,
                yaw: 0,
            },
            params,
        };
        map.route
            .gates
            .retain(|g| g.finish || !(g.at as usize > site.entry && (g.at as usize) < site.exit));
        map.route.recovery = without(&map.route.recovery, site.entry, site.exit);
        let problems = looping::problems(map, &feature.params);
        if !problems.is_empty() {
            (map.terrain, map.route) = before;
            *rejects.entry("contract".into()).or_default() += 1;
            continue;
        }
        map.features.push(feature);
        placed.push(Placed {
            from_s: s[site.entry] - data.run_in_m,
            to_s: s[site.exit] + data.back_m,
        });
    }
    if !placed.is_empty() {
        regrounded(map);
    }
    (placed, rejects)
}

/// Cuts the ground clear of the loop: under every stretch of deck (barriers included) it goes down to just below the
/// deck's lowest point there, never below the ramp from the entry's height to the exit's (where the deck lies on the
/// road it is the road), and the cut's sides bank back up to the old ground at [`BANK_SLOPE`]. Dips stay (the deck
/// stands over them). The route stands on the new ground. False (and nothing worth keeping) when a cut would go deeper
/// than `max_relief_m`.
fn earthworks(map: &mut Map, fp: &Footprint, d: &LoopDesign, max_relief_m: f64) -> bool {
    let Some(fr) = looping::frame(map, d) else {
        return false;
    };
    let secs = looping::sections(&fr, d);
    let t = &map.terrain;
    let (cols, rows) = (t.cols as usize, t.rows as usize);
    let sp = f64::from(t.spacing) / 1000.0;
    let (ox, oz) = (
        f64::from(t.origin_x) / 1000.0,
        f64::from(t.origin_z) / 1000.0,
    );
    let cell = |x: f64, z: f64| {
        (
            libm::floor((x - ox) / sp).max(0.0) as usize,
            libm::floor((z - oz) / sp).max(0.0) as usize,
        )
    };
    // The lowest the deck comes over each cell it passes over (its plan between two sections).
    let reach = fr.half_width + d.barrier_w;
    let mut ceiling: BTreeMap<usize, f64> = BTreeMap::new();
    for w in secs.windows(2) {
        let mut corners = Vec::with_capacity(4);
        let mut low = f64::INFINITY;
        for sec in w {
            for side in [1.0, -1.0] {
                let edge = [
                    sec.c[0] + sec.side[0] * reach * side,
                    sec.c[1] + sec.side[1] * reach * side,
                    sec.c[2] + sec.side[2] * reach * side,
                ];
                corners.push((edge[0], edge[2]));
                for off in [0.0, -d.thickness_m, d.barrier_h] {
                    low = low.min(edge[1] + sec.normal[1] * off);
                }
            }
        }
        // Round the quad: the first section's left and right edges, then the second's right and left.
        let quad = [corners[0], corners[1], corners[3], corners[2]];
        let (x0, x1) = quad
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| {
                (a.min(p.0), b.max(p.0))
            });
        let (z0, z1) = quad
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| {
                (a.min(p.1), b.max(p.1))
            });
        let ((c0, r0), (c1, r1)) = (cell(x0, z0), cell(x1, z1));
        for r in r0..=(r1 + 1).min(rows - 1) {
            for c in c0..=(c1 + 1).min(cols - 1) {
                let p = (ox + c as f64 * sp, oz + r as f64 * sp);
                if inside(&quad, p) {
                    let v = ceiling.entry(r * cols + c).or_insert(f64::INFINITY);
                    *v = v.min(low - DECK_CLEAR_M);
                }
            }
        }
    }
    // The cut under the deck: (cell, new height) where it lowers the ground.
    let mut cut: Vec<(usize, f64)> = Vec::new();
    let mut deepest = 0.0f64;
    for (&at, &ceil) in &ceiling {
        let (x, z) = (ox + (at % cols) as f64 * sp, oz + (at / cols) as f64 * sp);
        let old = f64::from(t.heights[at]) / 100.0;
        let new = ceil.max(fp.at(x, z).1);
        if new < old {
            deepest = deepest.max(old - new);
            cut.push((at, new));
        }
    }
    if deepest > max_relief_m {
        return false;
    }
    if cut.is_empty() {
        return true;
    }
    // Banks: no cell stands higher than a cut cell plus the bank's rise over the distance between them.
    let spread = libm::ceil(deepest / BANK_SLOPE / sp) as usize + 1;
    let mut lowered: BTreeMap<usize, f64> = BTreeMap::new();
    for &(at, new) in &cut {
        let (c, r) = (at % cols, at / cols);
        for rr in r.saturating_sub(spread)..=(r + spread).min(rows - 1) {
            for cc in c.saturating_sub(spread)..=(c + spread).min(cols - 1) {
                let dist = libm::hypot(cc as f64 - c as f64, rr as f64 - r as f64) * sp;
                let v = lowered.entry(rr * cols + cc).or_insert(f64::INFINITY);
                *v = v.min(new + dist * BANK_SLOPE);
            }
        }
    }
    let t = &mut map.terrain;
    for (at, cap) in lowered {
        if cap < f64::from(t.heights[at]) / 100.0 {
            t.heights[at] = libm::round(cap * 100.0) as i16;
        }
    }
    let terrain = map.terrain.clone();
    for q in &mut map.route.points {
        let (x, z) = (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0);
        q.y = mm(ground_height_m(&terrain, x, z));
    }
    true
}

/// Whether `p` lies inside the quad `q` (even-odd rule).
fn inside(q: &[(f64, f64); 4], p: (f64, f64)) -> bool {
    let mut odd = false;
    for k in 0..4 {
        let (a, b) = (q[k], q[(k + 1) % 4]);
        if (a.1 > p.1) != (b.1 > p.1) && p.0 < a.0 + (p.1 - a.1) * (b.0 - a.0) / (b.1 - a.1) {
            odd = !odd;
        }
    }
    odd
}

/// `spans` with route points `a..=b` taken out.
fn without(spans: &[Span], a: usize, b: usize) -> Vec<Span> {
    let mut out = Vec::new();
    for sp in spans {
        let (from, to) = (sp.from as usize, sp.to as usize);
        if from > to || to < a || from > b {
            // Untouched (a wrapping span here never reaches a loop, which never spans the seam).
            out.push(*sp);
            continue;
        }
        if from < a {
            out.push(Span {
                from: from as u32,
                to: (a - 1) as u32,
            });
        }
        if to > b {
            out.push(Span {
                from: (b + 1) as u32,
                to: to as u32,
            });
        }
    }
    out
}

/// Everything already placed stands on the ground the loops reshaped.
fn regrounded(map: &mut Map) {
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
        pose.y = mm(y);
    }
}

/// `ranges` with every loop's stretch cut out.
pub fn clear_of<T: Copy>(ranges: &[(f64, f64, T)], placed: &[Placed]) -> Vec<(f64, f64, T)> {
    let mut out = ranges.to_vec();
    for p in placed {
        out = out
            .into_iter()
            .flat_map(|(a, b, t)| {
                let mut keep = Vec::new();
                if a < p.from_s {
                    keep.push((a, b.min(p.from_s), t));
                }
                if b > p.to_s {
                    keep.push((a.max(p.to_s), b, t));
                }
                keep
            })
            .filter(|(a, b, _)| b > a)
            .collect();
    }
    out
}

/// Dressing and props on a loop's footprint leave (rails along the route under the deck, signs, scatter): the deck is
/// there.
pub fn clear_footprints(map: &mut Map) {
    let prints: Vec<Footprint> = map
        .features
        .iter()
        .filter_map(LoopDesign::of)
        .filter_map(|d| Footprint::of(map, &d))
        .collect();
    if prints.is_empty() {
        return;
    }
    let on = |x: i32, z: i32| {
        prints
            .iter()
            .any(|fp| fp.at(f64::from(x) / 1000.0, f64::from(z) / 1000.0).0 < FURNITURE_CLEAR_M)
    };
    map.dressing.retain(|d| !on(d.pose.x, d.pose.z));
    map.props.retain(|q| !on(q.pose.x, q.pose.z));
}
