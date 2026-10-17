//! Seeded track generation producing jj.map.v1 (native and WASM).
//!
//! - [`seed`] (P1-M03a): one seed → named streams.
//! - [`course`] (P1-M03b): the structure stream designs a closed loop of corners and straights.
//! - [`assemble`] (P1-M03a): a centerline plus dressing → a canonical `jj.map.v1` through `jj-map`.
//!
//! - [`features`] (P1-M03d): jumps, crests, whoops and creek dips composed into the route and baked into the heights.
//! - [`biome`] (P1-M03f): the biome interface (pure data), the selector, transition rules and the wayfinding family.
//! - [`scatter`] (P1-M03e): clumped or even dressing around the route from the dressing stream, clear of the road.
//! - [`validate`] (P1-M03g): every check on a generated map, and [`prepare`], which always returns a validated track.
//! - [`terrain`] (P1-M03c): undulation along the route with per-biome grade, curvature and bank limits.
//!
//! Props still come from a placeholder (cones by the road) and the scatter's pieces are the generic kit until the biome beads (M04–M07)
//! and seeded scatter (M03e) replace it.

#![forbid(unsafe_code)]

pub mod arena;
pub mod assemble;
pub mod biome;
pub mod course;
pub mod crossings;
pub mod features;
pub mod forks;
pub mod lab;
pub mod lineside;
pub mod loops;
pub mod overpass;
pub mod playtest;
pub mod rhythm;
pub mod roofs;
pub mod scatter;
pub mod seed;
pub mod setpieces;
pub mod signs;
pub mod stations;
pub mod terrain;
pub mod tuning;
pub mod validate;
pub mod variety;

pub use validate::{Plan, Prepared, prepare, prepare_tuned, prepare_with};

use std::collections::BTreeMap;

use jj_map::{Biome, Map, Pose, Prop, Surface};

use crate::assemble::{TrackSpec, arc_lengths, assemble, mm};
use crate::course::{CornerKind, Course, WIDTH_M};
use crate::seed::Streams;

pub const GENERATOR_ID: &str = "jj.procgen.course";
/// Bump when generated output changes on purpose (and re-bless `tests/goldens/seeds.txt`).
pub const GENERATOR_VERSION: &str = "27";
const STEP_M: f64 = 2.5;
/// Rooftop lots keep this far (m along the road) from a set piece's span.
const ROOF_PIECE_MARGIN_M: f64 = 10.0;

/// What a generation produced, for `jj procgen` and the seed bank.
#[derive(Clone, Debug)]
pub struct Report {
    pub length_m: f64,
    /// The seed's length class (R125).
    pub class: tuning::ClassName,
    pub preset: tuning::PresetName,
    pub straights_m: Vec<f64>,
    pub attempts: u32,
    pub fallback: bool,
    pub corners: BTreeMap<&'static str, u32>,
    pub rejects: BTreeMap<&'static str, u32>,
    /// The set pieces placed on the lap, in route order, and why candidate sites were turned down (R90).
    pub set_pieces: Vec<&'static str>,
    pub set_piece_rejects: BTreeMap<String, u32>,
    /// The route forks placed, and why candidate splits were turned down (R90).
    pub forks: u32,
    pub fork_rejects: BTreeMap<String, u32>,
    /// The course's set-piece beat straights (m along the lap, P1-FL15c).
    pub beat_spans: Vec<(f64, f64)>,
    /// The loops placed on the lap (br-xlvx.6.4), and why candidate beats were turned down (R90).
    pub loops: u32,
    pub loop_rejects: BTreeMap<String, u32>,
}

/// The map for `seed`.
pub fn generate(seed: u64) -> Map {
    generate_report(seed).0
}

pub fn generate_report(seed: u64) -> (Map, Report) {
    generate_from(Streams::new(seed))
}

/// The map from explicit streams (tests swap one stream to show it moves nothing else): one biome, the placeholder.
pub fn generate_from(st: Streams) -> (Map, Report) {
    generate_recipe_from(st, &[Biome::Greybox]).expect("a single biome needs no boundary")
}

/// The map for `seed` crossing the recipe's biomes in order, ending the lap in the first (see [`biome::select`]).
/// Fails when a boundary can't find a straight stretch (the fallback recipe is P1-M03g's).
pub fn generate_recipe(seed: u64, recipe: &[Biome]) -> Result<(Map, Report), biome::SelectError> {
    generate_recipe_from(Streams::new(seed), recipe)
}

/// [`generate_recipe`] from explicit streams. The pipeline: course, biome selection, assembly (route surfaces by biome),
/// terrain, features, the shared wayfinding family, then each biome's scatter.
pub fn generate_recipe_from(
    st: Streams,
    recipe: &[Biome],
) -> Result<(Map, Report), biome::SelectError> {
    generate_tuned_from(st, recipe, tuning::GeneratorData::shipped())
}

/// [`generate_recipe_from`] with explicit generator data (the owner tuning menu's regenerate): the course's length band
/// and straights, each biome's terrain and feature mix. With the shipped data this is the untuned generator.
pub fn generate_tuned_from(
    mut st: Streams,
    recipe: &[Biome],
    data: &tuning::GeneratorData,
) -> Result<(Map, Report), biome::SelectError> {
    // A lap of only biomes whose own corners are the technical beat (Town) gets its own technical spacing, and a lap of
    // only biomes that rule a family out never draws it.
    let name = |b: &Biome| {
        serde_json::to_value(b)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default()
    };
    let spacing_in: Vec<f64> = recipe
        .iter()
        .filter_map(|b| data.course.technical_spacing_in.get(&name(b)).copied())
        .collect();
    let mut c = data.course.clone();
    if !recipe.is_empty() && spacing_in.len() == recipe.len() {
        c.technical_spacing_m = spacing_in.into_iter().fold(0.0, f64::max);
    }
    for f in tuning::PresetName::ALL {
        let off = !recipe.is_empty()
            && recipe.iter().all(|b| {
                data.course
                    .families_off_in
                    .get(&name(b))
                    .is_some_and(|fs| fs.contains(&f))
            });
        if off {
            c.presets.set_weight(f, 0.0);
        }
    }
    if tuning::PresetName::ALL
        .iter()
        .all(|&f| c.presets.weight(f) <= 0.0)
    {
        c.presets.set_weight(tuning::PresetName::Twisty, 1.0);
    }
    let course = course::design_with(&mut st.structure, &c);
    generate_course(st, course, recipe, data, setpieces::shipped())
}

/// The generator from a designed course on: biomes, terrain, crossings, set pieces (from `pieces`), features, dressing.
/// [`generate_tuned_from`] designs the course; a Feel Lab scene ([`lab`]) hands in its own.
pub fn generate_course(
    mut st: Streams,
    course: Course,
    recipe: &[Biome],
    data: &tuning::GeneratorData,
    pieces: &setpieces::Data,
) -> Result<(Map, Report), biome::SelectError> {
    let mut centerline = centred(&resample(&course.points));
    // Loops (br-xlvx.6.4) take a set-piece beat straight: the centreline jogs under and after each before anything is
    // laid on it, from their own stream (seeded off the structure stream's state, a clone: nothing else moves). The
    // beats move with the jog (same route points, new arc lengths).
    let loop_data = &loops::LoopData {
        per_lap: data.loops_per_lap,
        ..loops::shipped().clone()
    };
    // A course that crosses itself (br-xlvx.10) has its levels set on the designed line, so a loop's jog would move a
    // road under a bridge: those courses take their crossings and no loop.
    let (loop_sites, mut loop_rejects) = if !course.crossings.is_empty() && data.loops_per_lap > 0 {
        (
            Vec::new(),
            BTreeMap::from([("course crosses itself".to_string(), 1)]),
        )
    } else if data.set_pieces {
        let loop_seed = st.structure.clone().next_u64() ^ 0x100F;
        loops::jog(
            &mut centerline,
            &course.beat_spans,
            WIDTH_M,
            &mut seed::Rng::stream(loop_seed, "loops"),
            loop_data,
        )
    } else {
        Default::default()
    };
    let beat_spans = if loop_sites.is_empty() {
        course.beat_spans.clone()
    } else {
        loops::moved_spans(&resample_s(&course.points), &centerline, &course.beat_spans)
    };
    let sel = if !course.crossings.is_empty() {
        biome::select::select_crossing(&centerline, recipe, &mut st.structure, &beat_spans)?
    } else {
        biome::select::select_avoiding(&centerline, recipe, &mut st.structure, &beat_spans)?
    };
    let props = placeholder_props(&mut st, &centerline);
    let n = centerline.len();
    let blend: Vec<(Biome, Biome, f64)> = (0..n).map(|i| sel.blend_at(i)).collect();
    let road = |b: Biome| biome::def(b).data().road;
    let point_surfaces: Vec<Surface> = blend
        .iter()
        .map(|&(a, b, t)| road(if t < 0.5 { a } else { b }))
        .collect();
    let mut map = assemble(&TrackSpec {
        seed: st.seed,
        generator_id: GENERATOR_ID.into(),
        generator_version: GENERATOR_VERSION.into(),
        biomes: sel.biomes(),
        centerline,
        width_m: WIDTH_M,
        surface: road(sel.lap[0]),
        point_surfaces,
        dressing: Vec::new(),
        props,
    });
    let along: Vec<terrain::TerrainParams> = blend
        .iter()
        .map(|&(a, b, t)| data.terrain(a).lerp(&data.terrain(b), t))
        .collect();
    terrain::undulate_along_crossing(
        &mut map,
        &mut st.terrain,
        &along,
        &course.crossings,
        &data.course.crossing,
    );
    if !course.crossings.is_empty() {
        crossings::place(&mut map, &course, &data.course.crossing);
        // Each crossing square enough for a leap tries one, keeping its bridge when the leap is refused (br-xlvx.10.3).
        overpass::leap_crossings(&mut map, overpass::shipped());
    }
    // The loops stand on the finished ground (cut where it rises into the deck), before the set pieces, which keep a
    // beat's spacing from them, and the small features, which keep off their straights.
    let (loop_spans, place_rejects) = loops::place(&mut map, &loop_sites, loop_data);
    for (k, v) in place_rejects {
        *loop_rejects.entry(k).or_default() += v;
    }
    // Features stay inside their biome's stretch, clear of the transition zones at its ends.
    let ranges: Vec<(f64, f64, features::Density)> = sel
        .segments()
        .into_iter()
        .map(|(b, from, to)| {
            let lo = sel.s[from]
                + if from > 0 {
                    biome::TRANSITION_M / 2.0
                } else {
                    0.0
                };
            let hi = if to + 1 < n {
                sel.s[to] - biome::TRANSITION_M / 2.0
            } else {
                sel.total
            };
            (lo, hi, data.density(b))
        })
        .collect();
    // Set pieces (R132) own their stretch: placed first, from their own stream, and the small features keep clear.
    let piece_ranges: Vec<(f64, f64, Biome)> = sel
        .segments()
        .into_iter()
        .zip(&ranges)
        .map(|((b, _, _), &(lo, hi, _))| (lo, hi, b))
        .collect();
    let ranges = loops::clear_of(&crossings::feature_ranges(&map, &ranges), &loop_spans, 0.0);

    // Its own stream, seeded from the structure stream's state (a clone: nothing else moves), so each course draw of a
    // seed gets its own placement.
    let piece_seed = st.structure.clone().next_u64();
    let (pieces, piece_rejects) = if !data.set_pieces {
        Default::default()
    } else if loop_spans.is_empty() {
        setpieces::place_counted(
            &mut map,
            &mut seed::Rng::stream(piece_seed, "set-pieces"),
            &piece_ranges,
            pieces,
        )
    } else {
        // A loop is one of the lap's set pieces (R132): the gap-leaps make up the rest, a rhythm's spacing from it
        // (R20) where the lap has the room, else the road two pieces keep between them (the minimum still holds).
        let lap_m = sel.total;
        let beside = loops::pieces_beside(pieces, loop_spans.len(), lap_m);
        let want = setpieces::min_for(&beside, lap_m, &sel.biomes()) as usize;
        let before = map.clone();
        let spaced = setpieces::place_counted(
            &mut map,
            &mut seed::Rng::stream(piece_seed, "set-pieces"),
            &loops::clear_of(&piece_ranges, &loop_spans, loops::piece_gap_m()),
            &beside,
        );
        if spaced.0.len() >= want {
            spaced
        } else {
            map = before;
            setpieces::place_counted(
                &mut map,
                &mut seed::Rng::stream(piece_seed, "set-pieces"),
                &loops::clear_of(&piece_ranges, &loop_spans, setpieces::CLEAR_M),
                &beside,
            )
        }
    };
    let ranges = setpieces::clear_of(&ranges, &pieces);
    // Route forks (R134, P1-FL16) on the sweepers left, from their own stream; the small features keep clear of them.
    let fork_seed = st.structure.clone().next_u64() ^ 0xF0_4C;
    let (fork_spans, fork_rejects) = forks::place(
        &mut map,
        &mut seed::Rng::stream(fork_seed, "forks"),
        &ranges,
        &data.forks,
    );
    let ranges = forks::clear_of(&ranges, &fork_spans);
    features::place_in_tuned(&mut map, &mut st.features, &ranges, data.jumps);
    let registry = biome::registry();
    stations::place(&mut map, &data.item_stations, &registry);
    biome::wayfinding::place(&mut map);
    // Each biome's rules along its own stretches (houses facing the street, lane lines, signs...), before the scatter fills
    // the ground around them.
    for b in sel.biomes() {
        let data = biome::def(b).data();
        let entries: Vec<f64> = sel
            .segments()
            .iter()
            .filter(|(bb, _, _)| *bb == b)
            .map(|&(_, from, _)| {
                if from == 0 {
                    90.0
                } else {
                    sel.s[from] + biome::TRANSITION_M / 2.0 + 10.0
                }
            })
            .collect();
        lineside::place(
            &mut map,
            &mut st.dressing,
            &lineside::Context {
                biome: b,
                registry: &registry,
                weight: &|i| sel.weight(b, i),
                entries: &entries,
            },
            data.lineside,
            data.signs,
        );
    }
    for (k, b) in sel.biomes().into_iter().enumerate() {
        scatter::scatter_masked(
            &mut map,
            &mut st.dressing,
            &scatter::spec(b),
            &registry,
            k == 0,
            &|seg| sel.weight(b, seg),
        );
    }
    map.route.segments = sel.route_segments();
    // Last: check the complete street/scatter before adding stunt lots. Canonicalisation rebases
    // their dressing references; no earlier placement pass may fill the approach afterwards.
    crossings::clear_corridors(&mut map, &registry);
    setpieces::clear_footprints(&mut map, &registry);
    loops::clear_footprints(&mut map);
    forks::clear_corridors(&mut map, &registry);
    biome::wayfinding::fork_gores(&mut map);
    // Remove blocked furniture BEFORE roofTarget indices exist, and keep roof kickers
    // out of the same crossing envelopes as ordinary features.
    let eligible: Vec<bool> = sel
        .s
        .iter()
        .map(|s| ranges.iter().any(|(a, b, _)| s >= a && s <= b))
        .collect();
    // Roof stunts reshape a lot beside the road after the corridors are cleared; `roofs::place` refuses a lot on any
    // painted track or within a fork branch's graded verge (`forks::in_mouth`).
    let reserved = |i: usize| {
        // A set piece's span and `ROOF_PIECE_MARGIN_M` either side: its approach and run-out are graded ground a
        // lot's kicker would launch off (a lot just past a run-out overshot its roof, Town seed 0). Its detour's
        // painted track is `roofs::place`'s own surface check.
        pieces
            .iter()
            .map(|p| (p.from_s, p.to_s))
            .chain(loop_spans.iter().map(|p| (p.from_s, p.to_s)))
            .any(|(from, to)| {
                sel.s[i] + ROOF_PIECE_MARGIN_M > from && sel.s[i] < to + ROOF_PIECE_MARGIN_M
            })
    };
    roofs::place(&mut map, &data.roof_stunts, &registry, &|i| {
        if reserved(i) {
            0.0
        } else if course.crossings.is_empty() || eligible[i] {
            sel.weight(Biome::Town, i)
        } else {
            0.0
        }
    });
    let mut rep = report(&course);
    rep.set_pieces = pieces.iter().map(|p| p.kind.name()).collect();
    rep.set_piece_rejects = piece_rejects;
    rep.forks = fork_spans.len() as u32;
    rep.fork_rejects = fork_rejects;
    rep.loops = loop_spans.len() as u32;
    rep.loop_rejects = loop_rejects;
    rep.beat_spans = beat_spans;
    Ok((map, rep))
}

/// The registry generated maps validate against: the generic kit plus the wayfinding family.
pub fn registry() -> jj_map::Registry {
    biome::registry()
}

fn report(course: &Course) -> Report {
    let mut corners: BTreeMap<&'static str, u32> =
        CornerKind::ALL.iter().map(|k| (k.name(), 0)).collect();
    for c in &course.corners {
        *corners.entry(c.kind.name()).or_default() += 1;
    }
    Report {
        length_m: course.length_m,
        class: course.class,
        preset: course.preset,
        straights_m: course.straights.clone(),
        attempts: course.attempts,
        fallback: course.fallback,
        corners,
        rejects: course.rejects.clone(),
        set_pieces: Vec::new(),
        set_piece_rejects: BTreeMap::new(),
        forks: 0,
        fork_rejects: BTreeMap::new(),
        beat_spans: course.beat_spans.clone(),
        loops: 0,
        loop_rejects: BTreeMap::new(),
    }
}

/// The arc length at each point of [`resample`]`(dense)` (the line the course's spans are measured on).
fn resample_s(dense: &[(f64, f64)]) -> Vec<f64> {
    arc_lengths(&resample(dense)).0
}

/// Resamples a closed polyline to points evenly spaced by arc length (~[`STEP_M`]), keeping the first point.
fn resample(dense: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let (s, total) = arc_lengths(dense);
    let n = libm::round(total / STEP_M) as usize;
    let mut out = Vec::with_capacity(n);
    let mut j = 0;
    for i in 0..n {
        let target = total * i as f64 / n as f64;
        while j + 1 < s.len() && s[j + 1] < target {
            j += 1;
        }
        let (a, b) = (dense[j], dense[(j + 1) % dense.len()]);
        let seg = (if j + 1 < s.len() { s[j + 1] } else { total }) - s[j];
        let t = if seg > 0.0 {
            (target - s[j]) / seg
        } else {
            0.0
        };
        out.push((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t));
    }
    out
}

/// The loop moved so its bounding box is centred on the origin (whole metres).
fn centred(points: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let (mut lo, mut hi) = (
        (f64::INFINITY, f64::INFINITY),
        (f64::NEG_INFINITY, f64::NEG_INFINITY),
    );
    for &(x, z) in points {
        lo = (lo.0.min(x), lo.1.min(z));
        hi = (hi.0.max(x), hi.1.max(z));
    }
    let (cx, cz) = (
        libm::round((lo.0 + hi.0) / 2.0),
        libm::round((lo.1 + hi.1) / 2.0),
    );
    points.iter().map(|&(x, z)| (x - cx, z - cz)).collect()
}

/// Cones by the road (dressing stream only) until the biome kits bring their own props.
fn placeholder_props(st: &mut Streams, line: &[(f64, f64)]) -> Vec<Prop> {
    let d = &mut st.dressing;
    let (s, total) = arc_lengths(line);
    // A point `off` metres to the side of the route at arc length `dist`.
    let beside = |dist: f64, off: f64| {
        let i = s.iter().position(|&v| v >= dist).unwrap_or(0);
        let (a, b) = (line[i], line[(i + 1) % line.len()]);
        let len = libm::hypot(b.0 - a.0, b.1 - a.1).max(1e-9);
        (a.0 - (b.1 - a.1) / len * off, a.1 + (b.0 - a.0) / len * off)
    };
    let mut props = Vec::new();
    for _ in 0..4 {
        // Clear of the start corridor (it runs back from the finish at 60 m).
        let dist = d.range(120.0, total - 20.0);
        let side = if d.unit() < 0.5 { -1.0 } else { 1.0 };
        let p = beside(dist, side * (WIDTH_M / 2.0 + d.range(3.0, 5.0)));
        props.push(Prop {
            kit_piece: "generic/cone".into(),
            pose: Pose {
                x: mm(p.0),
                y: 0,
                z: mm(p.1),
                yaw: 0,
            },
            params: BTreeMap::new(),
        });
    }
    props
}
