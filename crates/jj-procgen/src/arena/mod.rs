//! The derby bowl generator (P1-M10, master §11.4/§11.5a, R83 "derby is separate with rocks vibes"): a seeded bowl arena as
//! a `jj.map.v1`, sized to the car count when the round is prepared and never reshaped afterwards.
//!
//! - The world geometry is the `bowl` feature (`jj_map::arena`): flat floor, a quarter-circle bank, a vertical top wall and
//!   a flat lip, a closed shell; the floor is the map's flat heightfield. Passive containment only: nothing closes in.
//! - The route is the arena's *spawn ring* (the map format has one route, so the arena uses it for placement): a closed
//!   ring on the floor, a few metres in from the foot of the bank, whose start corridor runs round nearly all of it. The
//!   placement service fills it for any N and, once it is full, staggers the overflow inside it under spawn protection.
//!   Gates exist only because the format wants them; the derby never reads them.
//! - Dressing is the rocks look outside the bowl: red banded domes (the Olgas) and ledges round the rim. Nothing solid
//!   stands inside, so every part of the floor is reachable and no corner is dead.
//! - Everything draws from a named `arena` stream and uses integers and `libm`, so the canonical bytes are identical
//!   natively and in WASM. The bowl is centred on the world origin.

use jj_map::arena::{BowlDesign, floor_radius_for};
use jj_map::{
    Biome, Bounds, Dressing, Feature, FeatureKind, Footprint, Gate, Generator, Header, LoadedMap,
    MAP_VERSION, Map, Params, Pose, Registry, Route, RoutePoint, Span, StartCorridor, Surface,
    Terrain, load_json, validate,
};

use crate::seed::Rng;

pub const GENERATOR_ID: &str = "jj.procgen.arena";
/// Bump when generated output changes on purpose (and re-bless `tests/goldens/arena.txt`).
pub const GENERATOR_VERSION: &str = "1";

const TERRAIN_SPACING_M: f64 = 2.5;
/// The spawn ring sits this far in from the foot of the bank (the ring's centreline), m.
const RING_INSET_M: f64 = 5.5;
const RING_WIDTH_M: f64 = 8.0;
/// Spawn ring: rows every 6 m, two columns 3 m apart.
const ROW_SPACING_M: f64 = 6.0;
const COLUMN_SPACING_M: f64 = 3.0;
const START_WIDTH_M: f64 = 6.0;
/// Gates (the format's requirement, unused by the derby) at most this far apart, m.
const GATE_EVERY_M: f64 = 60.0;
/// The reference speed for the format's lap time (the derby never reads it), m/s.
const REF_SPEED_MPS: f64 = 15.0;
const MARGIN_M: f64 = 8.0;

fn mm(v: f64) -> i32 {
    libm::round(v * 1000.0) as i32
}

/// One ring of rocks round the bowl.
struct Ring {
    spacing_m: f64,
    radius_m: (f64, f64),
    height_m: (f64, f64),
    gap_m: (f64, f64),
}

const RINGS: [Ring; 2] = [
    // The towers.
    Ring {
        spacing_m: 30.0,
        radius_m: (6.0, 14.0),
        height_m: (22.0, 42.0),
        gap_m: (3.0, 14.0),
    },
    // Ledges and stacks close against the lip.
    Ring {
        spacing_m: 14.0,
        radius_m: (3.0, 5.0),
        height_m: (12.0, 22.0),
        gap_m: (1.0, 4.0),
    },
];

/// The arena for `seed` sized for `cars` cars (any N: the floor grows with it).
pub fn generate(seed: u64, cars: usize) -> Map {
    let mut rng = Rng::stream(seed, "arena");
    // The bank's radius, the wall's height and the lip's width vary a little with the seed (whole metres).
    let bank = 8 + (rng.unit() * 4.0) as i64; // 8..=11 m
    let wall = 8 + (rng.unit() * 3.0) as i64; // 8..=10 m
    let lip = 2 + (rng.unit() * 2.0) as i64; // 2..=3 m
    let floor_r = floor_radius_for(cars);
    let params: Params = [
        ("floorRadiusMm".to_owned(), (floor_r * 1000.0) as i64),
        ("bankRadiusMm".to_owned(), bank * 1000),
        ("wallHeightCm".to_owned(), wall * 100),
        ("lipWidthMm".to_owned(), lip * 1000),
    ]
    .into_iter()
    .collect();
    let feature = Feature {
        kind: FeatureKind::Bowl,
        pose: Pose::default(),
        params,
    };
    let design = BowlDesign::of(&feature).expect("the params are complete");
    let outer = design.outer_r();

    // Rocks outside: domes whose footprints clear the lip.
    let mut dressing = Vec::new();
    let mut reach = outer;
    for ring in &RINGS {
        let far = outer + ring.radius_m.1 + ring.gap_m.1;
        let count = libm::ceil(core::f64::consts::TAU * far / ring.spacing_m) as usize;
        let phase = rng.range(0.0, core::f64::consts::TAU);
        for k in 0..count {
            if rng.unit() < 0.1 {
                continue;
            }
            let angle =
                phase + core::f64::consts::TAU * (k as f64 + rng.range(-0.3, 0.3)) / count as f64;
            let radius = libm::round(rng.range(ring.radius_m.0, ring.radius_m.1) * 2.0) / 2.0;
            let height = libm::round(rng.range(ring.height_m.0, ring.height_m.1));
            let dist = outer + radius + rng.range(ring.gap_m.0, ring.gap_m.1);
            reach = reach.max(dist + radius);
            dressing.push(Dressing {
                kit_piece: "rocks/dome".into(),
                pose: Pose {
                    x: mm(dist * libm::cos(angle)),
                    y: 0,
                    z: mm(dist * libm::sin(angle)),
                    yaw: libm::round(rng.range(0.0, 36_000.0)) as i32,
                },
                params: [
                    ("radiusMm".to_owned(), (radius * 1000.0) as i64),
                    ("heightCm".to_owned(), (height * 100.0) as i64),
                ]
                .into_iter()
                .collect(),
                collides: true,
            });
        }
    }

    // Bounds: the rocks plus a margin; the terrain grid covers them, flat at the floor's height.
    let half = reach + MARGIN_M;
    let bounds = Bounds {
        min_x: -mm(half),
        min_z: -mm(half),
        max_x: mm(half),
        max_z: mm(half),
        kill_y: -30_000,
    };
    let spacing = mm(TERRAIN_SPACING_M);
    let origin_x = bounds.min_x.div_euclid(spacing) * spacing;
    let origin_z = bounds.min_z.div_euclid(spacing) * spacing;
    let cols = ((bounds.max_x - origin_x) / spacing + 2) as u32;
    let rows = ((bounds.max_z - origin_z) / spacing + 2) as u32;
    let sp = f64::from(spacing) / 1000.0;
    let (ox, oz) = (f64::from(origin_x) / 1000.0, f64::from(origin_z) / 1000.0);
    let mut surfaces = Vec::with_capacity((cols * rows) as usize);
    for r in 0..rows {
        for c in 0..cols {
            let d = libm::hypot(ox + f64::from(c) * sp, oz + f64::from(r) * sp);
            // Packed red dirt under the bowl, bare rock round the outside.
            surfaces.push(if d <= design.wall_r() {
                Surface::PackedDirt
            } else {
                Surface::Rock
            });
        }
    }

    // The spawn ring.
    let ring_r = floor_r - RING_INSET_M;
    let circumference = core::f64::consts::TAU * ring_r;
    let n = (libm::ceil(circumference / 5.0) as usize).max(24);
    let points: Vec<RoutePoint> = (0..n)
        .map(|i| {
            let a = core::f64::consts::TAU * i as f64 / n as f64;
            RoutePoint {
                x: mm(ring_r * libm::cos(a)),
                y: 0,
                z: mm(ring_r * libm::sin(a)),
                width: mm(RING_WIDTH_M) as u32,
                bank: 0,
                surface: Surface::PackedDirt,
            }
        })
        .collect();
    let gate_count = (libm::ceil(circumference / GATE_EVERY_M) as usize).max(3);
    let gates: Vec<Gate> = (0..gate_count)
        .map(|k| Gate {
            at: (k * n / gate_count) as u32,
            finish: k == 0,
        })
        .collect();
    // Rows round nearly the whole ring; the overflow stacks inside it under spawn protection (placement, S06).
    let length = libm::floor(circumference * 0.95 / ROW_SPACING_M) * ROW_SPACING_M;
    Map {
        header: Header {
            version: MAP_VERSION.into(),
            generator: Generator {
                id: GENERATOR_ID.into(),
                version: GENERATOR_VERSION.into(),
            },
            seed,
            biomes: vec![Biome::Rocks],
            bounds,
            ref_lap_ms: libm::round(circumference / REF_SPEED_MPS * 1000.0) as u32,
            gameplay_hash: None,
        },
        terrain: Terrain {
            origin_x,
            origin_z,
            spacing: spacing as u32,
            cols,
            rows,
            heights: vec![0; (cols * rows) as usize],
            surfaces,
        },
        route: Route {
            closed: true,
            gates,
            start: StartCorridor {
                at: 0,
                length: mm(length) as u32,
                width: mm(START_WIDTH_M) as u32,
                row_spacing: mm(ROW_SPACING_M) as u32,
                column_spacing: mm(COLUMN_SPACING_M) as u32,
            },
            recovery: vec![Span {
                from: 0,
                to: (n - 1) as u32,
            }],
            segments: Vec::new(),
            points,
        },
        features: vec![feature],
        dressing,
        props: Vec::new(),
    }
}

/// A validated, canonical arena for `seed` and `cars`, or what the validators found wrong.
pub fn prepare(seed: u64, cars: usize, registry: &Registry) -> Result<LoadedMap, Vec<String>> {
    let map = generate(seed, cars);
    let bad = check(&map, registry);
    if !bad.is_empty() {
        return Err(bad);
    }
    let json = serde_json::to_vec(&map).map_err(|e| vec![e.to_string()])?;
    load_json(&json, registry).map_err(|r| {
        r.violations
            .iter()
            .map(|v| format!("{} {}: {}", v.rule.name(), v.at, v.detail))
            .collect()
    })
}

/// Every arena check (empty when sound): the format's validator, plus the arena's own: one bowl; the spawn ring and the
/// cars' spread across it on the floor; solid rocks clear of the lip; every floor cell reachable from the ring (a flood
/// fill on a 2 m grid, so no dead corner and no walled-off pocket); a closed shell no car can leave.
pub fn check(map: &Map, registry: &Registry) -> Vec<String> {
    let mut bad: Vec<String> = validate(map, registry)
        .violations
        .iter()
        .map(|v| format!("{} {}: {}", v.rule.name(), v.at, v.detail))
        .collect();
    let bowls: Vec<BowlDesign> = map.features.iter().filter_map(BowlDesign::of).collect();
    let [d] = bowls.as_slice() else {
        bad.push(format!(
            "an arena has exactly one bowl, this has {}",
            bowls.len()
        ));
        return bad;
    };
    // The spawn ring, with its width, lies on the floor.
    for (i, p) in map.route.points.iter().enumerate() {
        let r = libm::hypot(
            f64::from(p.x) / 1000.0 - d.cx,
            f64::from(p.z) / 1000.0 - d.cz,
        );
        if r + f64::from(p.width) / 2000.0 > d.floor_r - 1.0 {
            bad.push(format!(
                "route.points[{i}] reaches the bank (the spawn ring stays on the floor)"
            ));
        }
    }
    // Solid dressing stands clear of the lip's outer edge.
    for (i, dr) in map
        .dressing
        .iter()
        .enumerate()
        .filter(|(_, dr)| dr.collides)
    {
        let Some(fp) = registry
            .get(&dr.kit_piece)
            .and_then(|p| p.footprint(&dr.params))
        else {
            continue;
        };
        let reach = match fp {
            Footprint::Circle { radius, .. } => f64::from(radius) / 1000.0,
            Footprint::Rect { x, z, .. } => libm::hypot(f64::from(x), f64::from(z)) / 2000.0,
        };
        let dist = libm::hypot(
            f64::from(dr.pose.x) / 1000.0 - d.cx,
            f64::from(dr.pose.z) / 1000.0 - d.cz,
        );
        if dist - reach < d.outer_r() {
            bad.push(format!(
                "dressing[{i}] reaches into the bowl (solid rocks stand outside the lip)"
            ));
        }
    }
    // Reachability: flood the floor disc from the ring on a 2 m grid.
    let cell = 2.0;
    let half = (d.floor_r / cell) as i64 + 1;
    let side = (2 * half + 1) as usize;
    let inside = |i: i64, j: i64| libm::hypot(i as f64 * cell, j as f64 * cell) <= d.floor_r - 1.0;
    let at = |i: i64, j: i64| ((i + half) as usize) * side + (j + half) as usize;
    let mut seen = vec![false; side * side];
    let start = map.route.points.first().map_or((0, 0), |p| {
        (
            libm::round(f64::from(p.x) / 1000.0 / cell) as i64,
            libm::round(f64::from(p.z) / 1000.0 / cell) as i64,
        )
    });
    let (mut stack, mut reached) = (vec![start], 0usize);
    while let Some((i, j)) = stack.pop() {
        if !inside(i, j) || seen[at(i, j)] {
            continue;
        }
        seen[at(i, j)] = true;
        reached += 1;
        stack.extend([(i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)]);
    }
    let total = (-half..=half)
        .flat_map(|i| (-half..=half).map(move |j| (i, j)))
        .filter(|&(i, j)| inside(i, j))
        .count();
    if reached != total {
        bad.push(format!(
            "only {reached} of {total} floor cells are reachable from the spawn ring"
        ));
    }
    // The shell is closed: the outer face reaches below the floor.
    if d.profile().last().is_none_or(|&(_, h)| h >= 0.0) {
        bad.push("the bowl's outer face doesn't reach below the floor".into());
    }
    bad
}
