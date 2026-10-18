//! br-zrat.1 (P1-S-parry-grid-corner): smooth road doesn't jolt where it crosses the terrain heightfield's grid lines.
//! The crossing bank's bots took sudden kicks at speed exactly on grid rows and columns (br-qwn9): a Postie at 23 m/s lost
//! 7.6 m/s and gained 4.4 m/s upward in one tick at x = 210 on a flowing Rocks course; a Lion at 39 m/s lost 5.4 m/s and
//! gained 4 m/s upward in one tick on a figure-eight's cutting. Resampling the same ground half a cell over removed them:
//! contacts against the heightfield's internal edges, which the terrain collider didn't fix (the trimeshes did). The sim's
//! heightfield now sets parry's `FIX_INTERNAL_EDGES`.
//!
//! The fixtures are the real ground: the terrain 40 m round each run, copied from those generated courses
//! (`tests/fixtures/grid-corner-*.json`, written by jj-procgen's `grid_corner_diag`), so the check doesn't move when the
//! generator does. Each is pasted, cell for cell on the grid, into otherwise empty ground, and the vehicle is launched along
//! its run at the speed it had, holding throttle: no one-tick loss of speed or change of vertical velocity like a hit.
use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{CarId, DriveInput, Sim, SpawnPose, TICK_HZ, VehicleProfile};

/// Where a patch's first cell goes in the greybox's frame (m): on its 2.5 m grid, clear of its edges.
const PASTE: (f64, f64) = (-90.0, -10.0);

struct Patch {
    vehicle: String,
    speed: f32,
    sp: f64,
    cols: usize,
    rows: usize,
    heights_cm: Vec<i64>,
    start: (f64, f64),
    heading_deg: f64,
}

fn patch(json: &str) -> Patch {
    let v: serde_json::Value = serde_json::from_str(json).unwrap();
    Patch {
        vehicle: v["vehicle"].as_str().unwrap().into(),
        speed: v["speed"].as_f64().unwrap() as f32,
        sp: v["spacingMm"].as_f64().unwrap() / 1000.0,
        cols: v["cols"].as_u64().unwrap() as usize,
        rows: v["rows"].as_u64().unwrap() as usize,
        heights_cm: v["heightsCm"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| h.as_i64().unwrap())
            .collect(),
        start: (
            v["start"][0].as_f64().unwrap(),
            v["start"][1].as_f64().unwrap(),
        ),
        heading_deg: v["headingDeg"].as_f64().unwrap(),
    }
}

impl Patch {
    /// The patch's height (cm) at its cell (c, r), its edge carried on beyond it.
    fn at(&self, c: i64, r: i64) -> i64 {
        let (c, r) = (
            c.clamp(0, self.cols as i64 - 1) as usize,
            r.clamp(0, self.rows as i64 - 1) as usize,
        );
        self.heights_cm[r * self.cols + c]
    }

    /// Ground height (m) at a point in the patch's frame (bilinear: for the launch's grade only).
    fn height(&self, x: f64, z: f64) -> f64 {
        let (fc, fr) = (x / self.sp, z / self.sp);
        let (c, r) = (fc.floor() as i64, fr.floor() as i64);
        let (u, w) = (fc - c as f64, fr - r as f64);
        let h = |c, r| self.at(c, r) as f64 / 100.0;
        (h(c, r) * (1.0 - u) + h(c + 1, r) * u) * (1.0 - w)
            + (h(c, r + 1) * (1.0 - u) + h(c + 1, r + 1) * u) * w
    }

    /// The greybox's extent at the patch's spacing, empty but for the patch's ground.
    fn map(&self) -> LoadedMap {
        let mut m: serde_json::Value =
            serde_json::from_str(include_str!("../../../maps/greybox-loop.json")).unwrap();
        let t = &mut m["terrain"];
        let (ox, oz, sp0, cols0, rows0) = (
            t["originX"].as_f64().unwrap() / 1000.0,
            t["originZ"].as_f64().unwrap() / 1000.0,
            t["spacing"].as_f64().unwrap() / 1000.0,
            t["cols"].as_u64().unwrap() as usize,
            t["rows"].as_u64().unwrap() as usize,
        );
        let k = (sp0 / self.sp) as usize;
        let (cols, rows) = ((cols0 - 1) * k + 1, (rows0 - 1) * k + 1);
        let (pc, pr) = (
            ((PASTE.0 - ox) / self.sp) as i64,
            ((PASTE.1 - oz) / self.sp) as i64,
        );
        let (mut heights, mut surfaces) = (Vec::new(), Vec::new());
        for r in 0..rows as i64 {
            for c in 0..cols as i64 {
                heights.push(serde_json::json!(self.at(c - pc, r - pr)));
                surfaces.push(serde_json::json!("tarmac"));
            }
        }
        t["spacing"] = serde_json::json!((self.sp * 1000.0) as i64);
        t["cols"] = serde_json::json!(cols);
        t["rows"] = serde_json::json!(rows);
        t["heights"] = serde_json::Value::Array(heights);
        t["surfaces"] = serde_json::Value::Array(surfaces);
        m["features"] = serde_json::json!([]);
        m["dressing"] = serde_json::json!([]);
        m["props"] = serde_json::json!([]);
        m["header"]["gameplayHash"] = serde_json::Value::Null;
        load_json(&serde_json::to_vec(&m).unwrap(), &Registry::generic())
            .unwrap_or_else(|v| panic!("{:?}", v.violations))
    }
}

/// The run: the worst one-tick loss of speed and change of vertical velocity (m/s), and the tick of the worst loss.
fn run(p: &Patch, profile: VehicleProfile, secs: f32) -> (f32, f32, u32) {
    let map = p.map();
    let mut sim = Sim::new(&map, &Registry::generic(), 7, profile);
    let heading = p.heading_deg.to_radians() as f32;
    let (x, z) = ((PASTE.0 + p.start.0) as f32, (PASTE.1 + p.start.1) as f32);
    let ground = p.height(p.start.0, p.start.1) as f32;
    let car: CarId = sim.spawn_car(SpawnPose {
        x,
        y: ground + 1.0,
        z,
        heading,
    });
    for _ in 0..TICK_HZ / 2 {
        sim.step();
    }
    let y = sim.car_state(car).unwrap().position[1];
    // Launched along the ground: its grade ahead, so the launch itself makes no hop.
    let (dx, dz) = (f64::from(heading.sin()), f64::from(heading.cos()));
    let grade =
        (p.height(p.start.0 + dx, p.start.1 + dz) - p.height(p.start.0 - dx, p.start.1 - dz)) / 2.0;
    let k = p.speed / (1.0 + grade * grade).sqrt() as f32;
    sim.place_car(
        car,
        SpawnPose {
            x,
            y: y + 0.02,
            z,
            heading,
        },
        0.0,
        [heading.sin() * k, grade as f32 * k, heading.cos() * k],
    );
    let (mut loss, mut dvy, mut at) = (0.0f32, 0.0f32, 0);
    let mut last: Option<[f32; 3]> = None;
    for t in 0..(secs * TICK_HZ as f32) as u32 {
        sim.set_input(
            car,
            DriveInput {
                throttle: i16::MAX,
                ..Default::default()
            },
        );
        sim.step();
        let v = sim.car_state(car).unwrap().linvel;
        if let Some(q) = last {
            let l = q[0].hypot(q[2]) - v[0].hypot(v[2]);
            if l > loss {
                (loss, at) = (l, t);
            }
            dvy = dvy.max((v[1] - q[1]).abs());
        }
        last = Some(v);
    }
    (loss, dvy, at)
}

#[test]
fn smooth_road_across_heightfield_grid_lines_never_jolts() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let roster = VehicleProfile::roster(&root).unwrap();
    let mut report = Vec::new();
    for json in [
        include_str!("fixtures/grid-corner-postie.json"),
        include_str!("fixtures/grid-corner-lion.json"),
    ] {
        let p = patch(json);
        let profile = roster
            .iter()
            .find(|(id, _)| *id == p.vehicle)
            .unwrap()
            .1
            .clone();
        let (loss, dvy, at) = run(&p, profile, 1.0);
        report.push(format!(
            "{} at {} m/s: worst one-tick loss {loss:.2} m/s (tick {at}), dvy {dvy:.2} m/s",
            p.vehicle, p.speed
        ));
        assert!(
            loss < 1.0 && dvy < 1.5,
            "{} jolts on smooth road across the grid: loss {loss:.2} m/s at tick {at}, dvy {dvy:.2} m/s",
            p.vehicle
        );
    }
    eprintln!("{}", report.join("\n"));
}
