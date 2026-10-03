//! The 0.1 map-validator cases worth keeping (plan §14: `static/js/resources/mapValidator.js`,
//! `tests/unit/map-validator.test.js`), re-expressed on a small synthetic loop: drivable width, wall thickness,
//! reachable checkpoints, landing checks, and the spawn cases as the start-corridor rule. 0.1's "insufficient spawn
//! capacity for N players" is deliberately not kept: 0.2 has no player caps, so the validator checks the corridor rule,
//! not an N (§7.5).

use std::collections::BTreeMap;

use jj_map::*;

const M: i32 = 1000;

/// A 200 m × 80 m rectangle, points every 5 m, gates every 40 m, a clear start corridor on the bottom edge.
fn rect(width: u32) -> Map {
    let mut pts = Vec::new();
    let corners: [(i32, i32); 4] = [(0, 0), (200, 0), (200, 80), (0, 80)];
    for k in 0..4 {
        let (a, b) = (corners[k], corners[(k + 1) % 4]);
        let len = (b.0 - a.0).abs() + (b.1 - a.1).abs();
        for s in (0..len).step_by(5) {
            let t = s as f64 / len as f64;
            let x = a.0 as f64 + (b.0 - a.0) as f64 * t;
            let z = a.1 as f64 + (b.1 - a.1) as f64 * t;
            pts.push(RoutePoint {
                x: (x * 1000.0) as i32,
                y: 0,
                z: (z * 1000.0) as i32,
                width,
                bank: 0,
                surface: Surface::Tarmac,
            });
        }
    }
    let n = pts.len() as u32;
    let gates = (0..n)
        .step_by(8)
        .map(|at| Gate {
            at,
            finish: at == 0,
        })
        .collect();
    let (cols, rows) = (31, 19);
    Map {
        header: Header {
            version: MAP_VERSION.into(),
            generator: Generator {
                id: "test.rect".into(),
                version: "1".into(),
            },
            seed: 1,
            biomes: vec![Biome::Greybox],
            bounds: Bounds {
                min_x: -50 * M,
                min_z: -50 * M,
                max_x: 250 * M,
                max_z: 130 * M,
                kill_y: -20 * M,
            },
            ref_lap_ms: 40_000,
            gameplay_hash: None,
        },
        terrain: Terrain {
            origin_x: -50 * M,
            origin_z: -50 * M,
            spacing: 10_000,
            cols,
            rows,
            heights: vec![0; (cols * rows) as usize],
            surfaces: vec![Surface::OffTrack; (cols * rows) as usize],
        },
        route: Route {
            closed: true,
            points: pts,
            gates,
            start: StartCorridor {
                at: 20,
                length: 40_000,
                width: 8_000,
                row_spacing: 8_000,
                column_spacing: 3_500,
            },
            recovery: vec![Span { from: 0, to: n - 1 }],
            segments: vec![],
        },
        features: vec![],
        dressing: vec![],
        props: vec![],
    }
}

fn check(map: &Map) -> Report {
    validate(map, &Registry::generic())
}

fn params(kv: &[(&str, i64)]) -> BTreeMap<String, i64> {
    kv.iter().map(|(k, v)| ((*k).to_owned(), *v)).collect()
}

#[test]
fn the_baseline_loop_is_valid() {
    let r = check(&rect(12_000));
    assert!(r.ok, "{r:#?}");
}

// 0.1 "rejects missing geometry" (no drivable band) → drivable width.
#[test]
fn drivable_width() {
    assert!(check(&rect(5_000)).has(Rule::DrivableWidth));
}

// 0.1 "rejects an open derby boundary (no walls)" → walls must be thick enough to contain a car.
#[test]
fn wall_thickness() {
    let fence = br#"{"id":"test/fence","version":1,"collider":{"box":{"x":4000,"y":900,"z":80}},"lod":{"simplifyBeyondMm":1000}}"#;
    let reg = Registry::from_json(
        GENERIC_PIECES
            .iter()
            .map(|(id, j)| (*id, j.as_bytes()))
            .chain([("test/fence", &fence[..])]),
    );
    let mut map = rect(12_000);
    map.dressing.push(Dressing {
        kit_piece: "test/fence".into(),
        pose: Pose {
            x: 100 * M,
            y: 0,
            z: -9 * M,
            yaw: 0,
        },
        params: BTreeMap::new(),
        collides: true,
    });
    assert!(validate(&map, &reg).has(Rule::WallThickness));
}

// 0.1 "rejects a race map missing checkpoints and finish line".
#[test]
fn reachable_checkpoints_need_gates_and_a_finish() {
    let mut few = rect(12_000);
    few.route.gates.truncate(2);
    assert!(check(&few).has(Rule::Gates));
    let mut no_finish = rect(12_000);
    no_finish.route.gates[0].finish = false;
    assert!(check(&no_finish).has(Rule::Gates));
}

// 0.1 "rejects degenerate (collinear) checkpoint winding".
#[test]
fn reachable_checkpoints_need_a_real_loop() {
    let mut map = rect(12_000);
    let out: Vec<RoutePoint> = (0..41)
        .map(|k| RoutePoint {
            x: k * 5 * M,
            y: 0,
            z: 0,
            width: 12_000,
            bank: 0,
            surface: Surface::Tarmac,
        })
        .collect();
    let back: Vec<RoutePoint> = (0..40)
        .rev()
        .map(|k| RoutePoint {
            x: k * 5 * M + 2_500,
            y: 0,
            z: 0,
            width: 12_000,
            bank: 0,
            surface: Surface::Tarmac,
        })
        .collect();
    map.route.points = out.into_iter().chain(back).collect();
    let n = map.route.points.len() as u32;
    map.route.gates = (0..n)
        .step_by(8)
        .map(|at| Gate {
            at,
            finish: at == 0,
        })
        .collect();
    map.route.recovery = vec![Span { from: 0, to: n - 1 }];
    assert!(check(&map).has(Rule::GateWinding));
}

// Reachable checkpoints: nothing static blocks the road between gates.
#[test]
fn reachable_checkpoints_need_a_clear_road() {
    let mut map = rect(12_000);
    map.dressing.push(Dressing {
        kit_piece: "generic/box-building".into(),
        pose: Pose {
            x: 200 * M,
            y: 0,
            z: 40 * M,
            yaw: 9000,
        },
        params: BTreeMap::new(),
        collides: true,
    });
    assert!(check(&map).has(Rule::RouteObstructed));
}

// Landing checks: a jump needs a landing long and clear enough, and a bypass.
#[test]
fn landing_checks() {
    let jump = |landing: i64| Feature {
        kind: FeatureKind::Jump,
        pose: Pose {
            x: 200 * M - 3 * M,
            y: 0,
            z: 10 * M,
            yaw: 9000,
        },
        params: params(&[
            ("rampLengthMm", 6000),
            ("rampWidthMm", 4000),
            ("lipHeightCm", 100),
            ("landingLengthMm", landing),
            ("landingWidthMm", 5000),
        ]),
    };
    let mut ok = rect(12_000);
    ok.features.push(jump(25_000));
    assert!(check(&ok).ok, "{:#?}", check(&ok));
    let mut short = rect(12_000);
    short.features.push(jump(5_000));
    assert!(check(&short).has(Rule::LandingEnvelope));
    let mut blocked = rect(12_000);
    blocked.features.push(jump(25_000));
    blocked.props.push(Prop {
        kit_piece: "generic/bin".into(),
        pose: Pose {
            x: 200 * M - 3 * M,
            y: 0,
            z: 30 * M,
            yaw: 0,
        },
        params: BTreeMap::new(),
    });
    assert!(check(&blocked).has(Rule::LandingEnvelope));
}

// 0.1 "rejects overlapping (unsafe) spawns" → rows and columns at least a car apart.
#[test]
fn start_rows_are_clear_and_spaced() {
    let mut tight = rect(12_000);
    tight.route.start.row_spacing = 2_000;
    assert!(check(&tight).has(Rule::StartCorridor));
}

// 0.1 "rejects a pickup/weapon zone overlapping a spawn" → nothing stands in the start corridor.
#[test]
fn nothing_stands_in_the_start_corridor() {
    let mut map = rect(12_000);
    map.props.push(Prop {
        kit_piece: "generic/cone".into(),
        pose: Pose {
            x: 80 * M,
            y: 0,
            z: 0,
            yaw: 0,
        },
        params: BTreeMap::new(),
    });
    assert!(check(&map).has(Rule::StartCorridor));
}

// 0.1 "rejects a map with no physics (render/physics misalignment)" → a map without terrain doesn't parse.
#[test]
fn missing_terrain_is_a_schema_error() {
    let mut doc = serde_json::to_value(rect(12_000)).unwrap();
    doc.as_object_mut().unwrap().remove("terrain");
    let err = load_json(&serde_json::to_vec(&doc).unwrap(), &Registry::generic()).unwrap_err();
    assert!(err.has(Rule::Schema));
}
