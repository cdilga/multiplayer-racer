//! br-zrat.1 diagnostic (ignored): the Postie's jolt on the flowing Rocks seed 1 course near (210, -90), on heightfield
//! grid lines (br-qwn9). Prints the terrain round the spot, then places the bike on the route 30 m before it at 23 m/s
//! along the road and reports each tick's speed and vertical velocity through it.
//!   JJ_SPOT=210,-90 cargo test -p jj-procgen --release --test grid_corner_diag -- --ignored --nocapture
use jj_map::Biome;
use jj_procgen::tuning::{GeneratorData, PresetName};
use jj_sim::{DriveInput, Sim, SpawnPose, TICK_HZ};

#[test]
#[ignore]
fn diag_grid_corner_jolt() {
    let mut d = GeneratorData::shipped().clone();
    let family = std::env::var("JJ_FAMILY").unwrap_or_else(|_| "flowing".into());
    for p in PresetName::ALL {
        let on = if family == "flowing" {
            p == PresetName::Flowing
        } else {
            p == PresetName::FigureEight
        };
        d.course.presets.set_weight(p, f64::from(on));
    }
    let seed: u64 = std::env::var("JJ_SEED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);
    let recipe = if std::env::var("JJ_FOUR").is_ok() {
        vec![
            Biome::Town,
            Biome::Rocks,
            Biome::OutbackDirt,
            Biome::OutbackBitumen,
        ]
    } else {
        vec![Biome::Rocks]
    };
    let map = jj_procgen::prepare_tuned(seed, &recipe, 8, &d).map;
    let (sx, sz) = std::env::var("JJ_SPOT")
        .ok()
        .and_then(|v| {
            v.split_once(',')
                .map(|(a, b)| (a.parse::<f32>().ok(), b.parse::<f32>().ok()))
        })
        .and_then(|(a, b)| Some((a?, b?)))
        .unwrap_or((210.0, -90.0));
    let t = &map.terrain;
    let sp = t.spacing as f32 / 1000.0;
    let (ox, oz) = (t.origin_x as f32 / 1000.0, t.origin_z as f32 / 1000.0);
    let (c0, r0) = (
        ((sx - ox) / sp).round() as i32,
        ((sz - oz) / sp).round() as i32,
    );
    eprintln!(
        "terrain round ({sx}, {sz}): spacing {sp}, the spot at column {c0} row {r0} (cm; rows along z)"
    );
    let w: i32 = std::env::var("JJ_HALF")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3);
    for r in (r0 - w)..=(r0 + w) {
        let mut line = format!("z {:7.1} |", oz + r as f32 * sp);
        for c in (c0 - w)..=(c0 + w) {
            let h = t.heights[(r as usize) * t.cols as usize + c as usize];
            line += &format!(" {h:6}");
        }
        eprintln!("{line}");
    }
    // The route point nearest the spot, and the road's direction there.
    let pts = &map.route.points;
    let (i, _) = pts
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            let da = (a.x as f32 / 1000.0 - sx).hypot(a.z as f32 / 1000.0 - sz);
            let db = (b.x as f32 / 1000.0 - sx).hypot(b.z as f32 / 1000.0 - sz);
            da.total_cmp(&db)
        })
        .unwrap();
    let back = (i + pts.len() - 6) % pts.len();
    let (a, b) = (&pts[back], &pts[i]);
    let (dx, dz) = ((b.x - a.x) as f32 / 1000.0, (b.z - a.z) as f32 / 1000.0);
    let n = dx.hypot(dz);
    let heading = dx.atan2(dz);
    eprintln!(
        "route point {i} at ({:.1}, {:.1}), from point {back} {:.1} m back, heading {:.1} deg",
        b.x as f32 / 1000.0,
        b.z as f32 / 1000.0,
        n,
        heading.to_degrees()
    );
    let loaded = jj_map::load_canonical(&jj_map::canonical_bytes(&map), &jj_procgen::registry())
        .expect("valid map");
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let want = std::env::var("JJ_VEHICLE").unwrap_or_else(|_| "postie-bike".into());
    let (_, profile) = jj_sim::VehicleProfile::roster(&root)
        .unwrap()
        .into_iter()
        .find(|(v, _)| *v == want)
        .unwrap();
    let speed: f32 = std::env::var("JJ_SPEED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(23.0);
    let lateral: f32 = std::env::var("JJ_LATERAL")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.4);
    let (nx, nz) = (dz / n, -dx / n);
    let mut sim = Sim::new(&loaded, &jj_procgen::registry(), 7, profile);
    let (px, pz) = (
        a.x as f32 / 1000.0 + nx * lateral,
        a.z as f32 / 1000.0 + nz * lateral,
    );
    // `JJ_DUMP=<file>`: the terrain 40 m round the run as a jj-sim fixture (tests/fixtures/grid-corner-*.json), the
    // patch's cells aligned to the map's grid and the run in the patch's own frame.
    if let Ok(path) = std::env::var("JJ_DUMP") {
        let half = 16i32;
        let (cc, rc) = (
            ((px - ox) / sp).floor() as i32,
            ((pz - oz) / sp).floor() as i32,
        );
        let (c_lo, r_lo) = (cc - half, rc - half);
        let mut heights = Vec::new();
        for r in r_lo..=(rc + half) {
            for c in c_lo..=(cc + half) {
                heights.push(t.heights[(r as usize) * t.cols as usize + c as usize]);
            }
        }
        let (px0, pz0) = (ox + c_lo as f32 * sp, oz + r_lo as f32 * sp);
        let doc = serde_json::json!({
            "//": format!("br-zrat.1: the terrain round a jolt on a generated course ({family} seed {seed}, {want} at {speed} m/s), copied from jj-procgen's grid_corner_diag; the run starts at `start` (m, from the patch's first cell) along `headingDeg`"),
            "vehicle": want, "speed": speed,
            "spacingMm": t.spacing, "cols": 2 * half + 1, "rows": 2 * half + 1, "heightsCm": heights,
            "start": [px - px0, pz - pz0], "headingDeg": heading.to_degrees(),
        });
        let _ = path;
        // Printed (a remote runner keeps no files): the line after FIXTURE is the file.
        eprintln!("FIXTURE {}", serde_json::to_string(&doc).unwrap());
    }
    let car = sim.spawn_car(SpawnPose {
        x: px,
        y: a.y as f32 / 1000.0 + 1.0,
        z: pz,
        heading,
    });
    for _ in 0..TICK_HZ / 2 {
        sim.step();
    }
    let y = sim.car_state(car).unwrap().position[1];
    sim.place_car(
        car,
        SpawnPose {
            x: px,
            y: y + 0.02,
            z: pz,
            heading,
        },
        0.0,
        [dx / n * speed, 0.0, dz / n * speed],
    );
    let mut last: Option<[f32; 3]> = None;
    let mut worst = (0.0f32, 0.0f32, 0usize);
    for k in 0..(TICK_HZ as usize * 3 / 2) {
        sim.set_input(
            car,
            DriveInput {
                throttle: i16::MAX,
                ..Default::default()
            },
        );
        sim.step();
        let st = sim.car_state(car).unwrap();
        let v = st.linvel;
        if let Some(p) = last {
            let loss = p[0].hypot(p[2]) - v[0].hypot(v[2]);
            let dvy = (v[1] - p[1]).abs();
            if loss > 0.3 || dvy > 0.5 {
                eprintln!(
                    "tick {k}: at ({:.2}, {:.2}, {:.2}) speed {:.2} -> {:.2}, vy {:.2} -> {:.2}, angvel {:?}",
                    st.position[0],
                    st.position[1],
                    st.position[2],
                    p[0].hypot(p[2]),
                    v[0].hypot(v[2]),
                    p[1],
                    v[1],
                    st.angvel
                );
            }
            if loss > worst.0 {
                worst = (loss, dvy, k);
            }
        }
        last = Some(v);
    }
    eprintln!(
        "worst one-tick loss {:.2} m/s (dvy {:.2}) at tick {}",
        worst.0, worst.1, worst.2
    );
}
