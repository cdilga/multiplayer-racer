//! Crossing contract defects are injected into a real map document, through the normal loader.
use std::collections::BTreeMap;

use jj_map::{
    Feature, FeatureKind, Gate, Map, Pose, Registry, RoutePoint, Rule, Span, Surface, Terrain,
    load_json,
};

fn crossing() -> Map {
    let mut m: Map = serde_json::from_str(include_str!("../../../maps/greybox-loop.json")).unwrap();
    m.header.gameplay_hash = None;
    m.header.bounds.min_x = -220_000;
    m.header.bounds.min_z = -220_000;
    m.header.bounds.max_x = 220_000;
    m.header.bounds.max_z = 220_000;
    m.header.ref_lap_ms = 90_000;
    m.terrain = Terrain {
        origin_x: -220_000,
        origin_z: -220_000,
        spacing: 10_000,
        cols: 45,
        rows: 45,
        heights: vec![0; 45 * 45],
        surfaces: vec![Surface::Tarmac; 45 * 45],
    };
    m.route.closed = true;
    m.route.points = (0..256)
        .map(|i| {
            let a = i as f64 / 256.0 * core::f64::consts::TAU;
            let u = i.min(256 - i) as f64 / 32.0;
            let h = if u >= 1.0 {
                0.0
            } else if u <= 0.25 {
                7.0
            } else {
                3.5 * (1.0 + libm::cos((u - 0.25) / 0.75 * core::f64::consts::PI))
            };
            RoutePoint {
                x: libm::round(180_000.0 * libm::sin(a)) as i32,
                y: libm::round(h * 1000.0) as i32,
                z: libm::round(90_000.0 * libm::sin(2.0 * a)) as i32,
                width: 12_000,
                bank: 0,
                surface: Surface::Tarmac,
            }
        })
        .collect();
    m.route.gates = (0..256)
        .step_by(8)
        .map(|i| Gate {
            at: i,
            finish: i == 64,
        })
        .collect();
    m.route.start.at = 64;
    m.route.start.length = 60_000;
    m.route.start.width = 12_000;
    m.route.recovery = vec![Span { from: 0, to: 255 }];
    m.route.segments.clear();
    m.dressing.clear();
    m.props.clear();
    m.features = vec![Feature {
        kind: FeatureKind::Bridge,
        pose: Pose::default(),
        params: [
            ("upperFrom", 224),
            ("upperTo", 32),
            ("lowerFrom", 96),
            ("lowerTo", 160),
            ("thicknessMm", 400),
            ("barrierHeightMm", 750),
            ("barrierWidthMm", 350),
            ("clearanceMm", 5_000),
            ("maxGradeMilli", 200),
        ]
        .into_iter()
        .map(|(k, v)| (k.into(), v))
        .collect(),
    }];
    m
}

fn rejected(m: &Map) {
    let r = load_json(&serde_json::to_vec(m).unwrap(), &Registry::generic()).unwrap_err();
    assert!(
        r.violations.iter().any(|v| v.rule == Rule::Crossing),
        "{r:#?}"
    );
}

#[test]
fn a_grade_separated_figure_eight_loads_and_round_trips_with_a_closed_mesh() {
    let m = crossing();
    let loaded = load_json(&serde_json::to_vec(&m).unwrap(), &Registry::generic()).unwrap();
    assert_eq!(
        jj_map::load_canonical(&loaded.canonical, &Registry::generic()).unwrap(),
        loaded
    );
    assert_eq!(
        loaded.map.terrain.heights, m.terrain.heights,
        "the upper route never lifts the lower terrain"
    );
    let (vertices, triangles) =
        jj_map::bridge::bridge_mesh(&loaded.map, &loaded.map.features[0]).unwrap();
    // Explicitly requested fixture/evidence output only; ordinary test runs never rewrite repository artifacts.
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("bridge-map.json"),
            serde_json::to_vec_pretty(&loaded.map).unwrap(),
        )
        .unwrap();
        std::fs::write(dir.join("bridge-shapes.json"), serde_json::to_vec_pretty(&serde_json::json!([
            { "feature": 0, "triangles": triangles.len(), "fingerprint": format!("{:016x}", jj_map::jump::render_fingerprint(&(vertices.clone(), triangles.clone()))) }
        ])).unwrap()).unwrap();
    }
    assert!(vertices.iter().all(|p| p.iter().all(|v| v.is_finite())));
    let mut edges = BTreeMap::new();
    for t in &triangles {
        for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            assert!(a != b);
            *edges.entry((a.min(b), a.max(b))).or_insert(0) += 1;
        }
    }
    assert!(
        edges.values().all(|&n| n == 2),
        "every edge belongs to exactly two faces: closed collider, no internal end caps"
    );
    assert!(
        vertices.iter().any(|p| (p[1] - 7.75).abs() < 0.001),
        "barriers stand above the deck"
    );
}

#[test]
fn too_little_clearance_and_too_steep_a_ramp_are_rejected() {
    let mut low = crossing();
    for p in &mut low.route.points {
        p.y = p.y.min(3_500);
    }
    rejected(&low);
    let mut steep = crossing();
    steep.route.points[230].y = 50_000;
    rejected(&steep);
}

#[test]
fn solid_ground_cannot_be_hidden_by_a_lower_route_height() {
    let mut m = crossing();
    m.terrain.heights[22 * 45 + 22] = 600;
    rejected(&m);
}

#[test]
fn a_ramp_must_meet_the_ground_and_the_declared_spans_must_cross() {
    let mut m = crossing();
    m.route.points[224].y = 400;
    rejected(&m);
    let mut m = crossing();
    m.features[0].params.insert("lowerFrom".into(), 64);
    m.features[0].params.insert("lowerTo".into(), 80);
    rejected(&m);
}

#[test]
fn absent_params_and_shared_spans_are_rejected_without_panicking() {
    let mut m = crossing();
    m.features[0].params.remove("clearanceMm");
    rejected(&m);
    let mut m = crossing();
    m.features[0].params.insert("lowerFrom".into(), 0);
    rejected(&m);
}

#[test]
fn declaring_a_bridge_does_not_make_collinear_gates_valid() {
    let mut m = crossing();
    for gate in &m.route.gates {
        m.route.points[gate.at as usize].z = 0;
    }
    let r = load_json(&serde_json::to_vec(&m).unwrap(), &Registry::generic()).unwrap_err();
    assert!(
        r.violations.iter().any(|v| v.rule == Rule::GateWinding),
        "{r:#?}"
    );
}
