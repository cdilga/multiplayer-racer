//! br-xlvx.6 (Loops): the loop feature's geometry on the hand-made loop map (maps/test/loop.json, written by
//! tools/maps/loop.py). The deck leaves the road at E and rejoins it at X, tangentially and at road height; it is upside
//! down at the top, 2R above the road; its prisms are closed; and broken loops are named.

use std::collections::BTreeMap;

use jj_map::looping::{self, LoopDesign};
use jj_map::{Registry, load_json};

const MAP: &str = include_str!("../../../maps/test/loop.json");

/// The loop feature's params, from the map (tools/maps/loop.py writes them).
fn params() -> BTreeMap<String, i64> {
    let m = map();
    m.features
        .iter()
        .find(|f| f.kind == jj_map::FeatureKind::Loop)
        .expect("the map has a loop")
        .params
        .clone()
}

fn map() -> jj_map::model::Map {
    load_json(MAP.as_bytes(), &Registry::generic())
        .expect("the loop map validates")
        .map
}

fn near(a: [f64; 3], b: [f64; 3], tol: f64) -> bool {
    (0..3).all(|k| (a[k] - b[k]).abs() <= tol)
}

#[test]
fn the_hand_made_loop_is_valid() {
    let m = map();
    assert_eq!(looping::problems(&m, &params()), Vec::<String>::new());
    assert_eq!(
        LoopDesign::of(&m.features[0]),
        LoopDesign::of_params(&params())
    );
}

/// The loop is part of the map's contract: jj validate names a broken one (Rule::Loop) and a gate inside its span, and
/// the gameplay hash covers its params.
#[test]
fn the_validator_and_the_gameplay_hash_cover_the_loop() {
    let json: serde_json::Value = serde_json::from_str(MAP).unwrap();
    let load = |j: &serde_json::Value| {
        load_json(
            serde_json::to_string(j).unwrap().as_bytes(),
            &Registry::generic(),
        )
    };
    let hash = |j: &serde_json::Value| load(j).unwrap().hash;
    let base = hash(&json);
    let mut wider = json.clone();
    wider["features"][0]["params"]["radiusMm"] = serde_json::json!(8200);
    assert_ne!(hash(&wider), base, "the hash covers the loop's params");
    let mut tight = json.clone();
    tight["features"][0]["params"]["radiusMm"] = serde_json::json!(3000);
    let report = load(&tight).unwrap_err();
    assert!(
        report.violations.iter().any(|v| v.rule.name() == "loop"),
        "{report:?}"
    );
    let mut gated = json.clone();
    let inside = json["features"][0]["params"]["entry"].as_i64().unwrap() + 3;
    gated["route"]["gates"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({"at": inside, "finish": false}));
    let report = load(&gated).unwrap_err();
    assert!(
        report
            .violations
            .iter()
            .any(|v| v.rule.name() == "loop" && v.detail.contains("inside the loop")),
        "{report:?}"
    );
}

#[test]
fn the_deck_leaves_and_rejoins_the_road_and_is_upside_down_at_the_top() {
    let m = map();
    let d = LoopDesign::of_params(&params()).unwrap();
    let fr = looping::frame(&m, &d).unwrap();
    let secs = looping::sections(&fr, &d);
    let pt = |i: usize| {
        let q = &m.route.points[i];
        [
            f64::from(q.x) / 1000.0,
            f64::from(q.y) / 1000.0,
            f64::from(q.z) / 1000.0,
        ]
    };
    // E and X (the deck's surface the road ribbon's lift above them), flat (normal straight up) where the deck meets the
    // road.
    let on = |i: usize| {
        let mut p = pt(i);
        p[1] += looping::DECK_LIFT_M;
        p
    };
    assert!(near(secs[0].c, on(d.entry), 1e-9), "{:?}", secs[0].c);
    assert!(
        near(secs[d.segments].c, on(d.exit), 1e-6),
        "{:?}",
        secs[d.segments].c
    );
    for s in [secs[0], secs[d.segments]] {
        assert!(
            s.normal[1] > 0.999,
            "the deck meets the road flat: {:?}",
            s.normal
        );
    }
    // The top, halfway round: 2R up (the surface its lift below that, facing down).
    let top = secs[d.segments / 2];
    assert!(
        (top.c[1] - (2.0 * d.radius_m - looping::DECK_LIFT_M)).abs() < 1e-6,
        "top at {}",
        top.c[1]
    );
    assert!(
        top.normal[1] < -0.999,
        "upside down at the top: {:?}",
        top.normal
    );
    // Quarter and three-quarters round: a wall, the surface facing back and then forward along the road (the run-out
    // stretches the loop along the road, so the wall leans).
    let along = |v: [f64; 3]| v[0] * fr.forward[0] + v[2] * fr.forward[1];
    assert!(
        along(secs[d.segments / 4].normal) < -0.7,
        "{:?}",
        secs[d.segments / 4].normal
    );
    assert!(
        along(secs[3 * d.segments / 4].normal) > 0.7,
        "{:?}",
        secs[3 * d.segments / 4].normal
    );
    // The deck rolls only gently along the helix (the Frenet frame's twist), and a car with its wheel straight follows
    // the centre line: it is a geodesic of the deck (the curve's bend lies along the surface normal, never sideways).
    for (k, s) in secs.iter().enumerate() {
        assert!(
            s.side[1].abs() < 0.6,
            "the deck rolls gently (under ~37 degrees): {:?}",
            s.side
        );
        if k > 0 && k < secs.len() - 1 {
            let bend = [0, 1, 2].map(|i| secs[k + 1].c[i] - 2.0 * s.c[i] + secs[k - 1].c[i]);
            let sideways = bend[0] * s.side[0] + bend[1] * s.side[1] + bend[2] * s.side[2];
            let len = bend.iter().map(|x| x * x).sum::<f64>().sqrt();
            assert!(
                sideways.abs() < 0.05 * len.max(1e-9),
                "section {k}: the centre line bends sideways on the deck"
            );
        }
    }
    assert_eq!(
        fr.half_width,
        f64::from(m.route.points[d.entry].width) / 2000.0
    );
}

#[test]
fn the_mesh_is_three_closed_prisms_with_a_surface_each() {
    let m = map();
    let d = LoopDesign::of_params(&params()).unwrap();
    let (verts, tris) = looping::loop_mesh(&m, &d).unwrap();
    assert_eq!(tris.len(), 3 * (d.segments * 8 + 4));
    assert_eq!(
        looping::triangle_surfaces(&m, &d).unwrap().len(),
        tris.len()
    );
    assert!(verts.iter().flatten().all(|v| v.is_finite()));
    // Closed: every undirected edge is shared by exactly two triangles, once in each direction (consistent winding).
    let mut edges: BTreeMap<(u32, u32), i32> = BTreeMap::new();
    for t in &tris {
        for k in 0..3 {
            let (a, b) = (t[k], t[(k + 1) % 3]);
            *edges.entry((a.min(b), a.max(b))).or_default() += if a < b { 1 } else { -1 };
        }
    }
    assert!(
        edges.values().all(|&n| n == 0),
        "every edge is walked once each way"
    );
    // No zero-area triangles.
    for t in &tris {
        let [a, b, c] = t.map(|i| verts[i as usize]);
        let (u, v) = (
            [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
            [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
        );
        let n = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        assert!(
            n.iter().map(|x| x * x).sum::<f64>() > 1e-12,
            "a degenerate triangle"
        );
    }
}

#[test]
fn broken_loops_are_named() {
    let m = map();
    let with = |k: &str, v: i64| {
        let mut p = params();
        p.insert(k.to_owned(), v);
        looping::problems(&m, &p)
    };
    assert!(
        with("radiusMm", 3000)
            .iter()
            .any(|p| p.contains("radiusMm"))
    );
    assert!(with("segments", 8).iter().any(|p| p.contains("segments")));
    // An exit two points on: too little shift for the decks to clear, and a run-out shorter than the radius.
    let close = with("exit", 66);
    assert!(
        close.iter().any(|p| p.contains("clear each other")),
        "{close:?}"
    );
    assert!(
        close.iter().any(|p| p.contains("on from the entry")),
        "{close:?}"
    );
    // Entry after exit.
    assert!(with("entry", 90).iter().any(|p| p.contains("in order")));
    // An entry where the road bends (the first hairpin) is off the loop's line.
    let bent = {
        let mut p = params();
        p.insert("entry".into(), 140);
        p.insert("exit".into(), 150);
        looping::problems(&m, &p)
    };
    assert!(
        bent.iter().any(|p| p.contains("off the loop's line")),
        "{bent:?}"
    );
    assert!(
        looping::problems(&m, &BTreeMap::new())
            .iter()
            .any(|p| p.contains("missing"))
    );
    // A recovery span over the loop would let a respawn anchor land on it.
    let mut covered = map();
    covered.route.recovery[0].to = 70;
    let anchored = looping::problems(&covered, &params());
    assert!(
        anchored.iter().any(|p| p.contains("recovery span")),
        "{anchored:?}"
    );
}

#[test]
fn the_posted_speed_is_the_minimum_at_the_top_plus_the_climb() {
    let d = LoopDesign::of_params(&params()).unwrap();
    let want = (d.min_speed_mps.powi(2) + 4.0 * 9.81 * 8.0).sqrt();
    assert!((looping::posted_entry_mps(&d, 9.81) - want).abs() < 1e-12);
}

/// The native mesh's render fingerprint (jj_map::jump::render_fingerprint), which the TS counterpart
/// (web/host/src/render/map/loop.ts) must reproduce: web/host/tests/loop-parity.test.mjs holds it to the same value.
pub const LOOP_FINGERPRINT: u64 = 0x45d1_55fd_ea1c_1d0c;

#[test]
fn the_native_mesh_has_the_committed_fingerprint() {
    let d = LoopDesign::of_params(&params()).unwrap();
    let mesh = looping::loop_mesh(&map(), &d).unwrap();
    let fp = jj_map::jump::render_fingerprint(&mesh);
    eprintln!("loop fingerprint {fp:#018x}");
    assert_eq!(
        fp, LOOP_FINGERPRINT,
        "the loop mesh changed: update LOOP_FINGERPRINT and the TS parity test together"
    );
}

#[test]
fn the_shared_sin_cos_matches_libm_over_its_range() {
    // looping::sin_cos replaces libm's (the renderer's port must get the same bits); it is as good as libm on −π..3π.
    for k in 0..=4000 {
        let th = -core::f64::consts::PI + 4.0 * core::f64::consts::PI * f64::from(k) / 4000.0;
        let (s, c) = looping::sin_cos(th);
        assert!((s - libm::sin(th)).abs() < 1e-15, "sin({th}) = {s}");
        assert!((c - libm::cos(th)).abs() < 1e-15, "cos({th}) = {c}");
    }
}
