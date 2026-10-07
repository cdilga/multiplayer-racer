//! Bug clips and session bundles (P1-F07, P1-F12, plan §13b.6): a host session's applied-input journal, kept in pieces on
//! the main thread as the sim runs, and the replay of it.
//!
//! - [`ClipTap`] watches a live [`Sim`] (the browser host's worker, through the test surface's `journalChunk`) and hands
//!   out what is new in its journal since the last poll as a postcard [`Chunk`]. A new world (the host rebuilds the sim at
//!   every Countdown and at the Lobby, so a round is a world) starts a new world number and carries its start (session
//!   seed, canonical map bytes and hash). The main thread keeps every chunk, so a clip can still be saved after a worker
//!   fault.
//! - [`Bundle`] is the file: `*.jjclip` (one moment marked) and `*.jjsession` (the whole session) are the same shape, JSON
//!   with the binary parts in base64, so a bug bead's clip diffs, greps and reads as text.
//! - [`replay`] re-simulates every world from its chunks (the map's canonical bytes, the journal and the seed are all
//!   a world needs), checks every recorded checkpoint hash, and reports the state hash at the marked moment. With `trace`
//!   it also writes the rows `jj sim --trace` writes, so a clip can be compared tick by tick with its fix (§13.3).

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use jj_map::{LoadedMap, Registry, hex, load_canonical};
use jj_sim::journal::{Entry, Setup};
use jj_sim::observe::{RouteGeom, observe_cars};
use jj_sim::{CarId, Journal, Sim, VehicleProfile};
use jj_types::axis::dequantise_axis;

pub const FORMAT_CLIP: &str = "jj.clip.v1";
pub const FORMAT_SESSION: &str = "jj.session.v1";

/// Base64 (standard) of bytes, for the hosts that don't carry the crate.
pub fn b64(bytes: &[u8]) -> String {
    B64.encode(bytes)
}

/// What a journal gained between two polls (postcard on the wire between the worker and main).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Chunk {
    pub setup: Vec<(u64, Setup)>,
    pub entries: Vec<Entry>,
}

impl Chunk {
    pub fn is_empty(&self) -> bool {
        self.setup.is_empty() && self.entries.is_empty()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        postcard::to_allocvec(self).expect("chunks encode")
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, postcard::Error> {
        postcard::from_bytes(bytes)
    }
}

/// How a world began: what a replay needs besides its chunks.
#[derive(Clone, Debug, PartialEq)]
pub struct WorldStart {
    /// The session seed the sim was built from (the journal's).
    pub seed: u64,
    pub map_hash: [u8; 32],
    /// The map's canonical bytes (`jj.map.v1`), so a clip is self-contained: a generated track needs no generator.
    pub map: Vec<u8>,
}

/// One poll's answer.
#[derive(Clone, Debug)]
pub struct Poll {
    /// Which world (0, 1, 2…) this is. A bigger number than last time means the host rebuilt the sim.
    pub world: u32,
    /// Present on the first poll of a world.
    pub start: Option<WorldStart>,
    pub tick: u64,
    /// The journal's new part since the last poll (empty chunk: nothing new).
    pub chunk: Chunk,
    /// The full-state hash at `tick`, when asked for.
    pub hash: Option<[u8; 32]>,
    /// How many setup commands the journal held when it was taken (inputs aren't in the hash, setup is).
    pub setup_len: usize,
}

impl Poll {
    /// The poll as the worker sends it to main (JSON; the chunk and map bytes in base64).
    pub fn to_json(&self) -> Value {
        json!({
            "world": self.world,
            "tick": self.tick,
            "start": self.start.as_ref().map(|s| json!({
                "seed": s.seed, "mapHash": hex(&s.map_hash), "map": b64(&s.map) })),
            "chunk": (!self.chunk.is_empty()).then(|| b64(&self.chunk.to_bytes())),
            "hash": self.hash.map(|h| hex(&h)),
            "setup": self.setup_len,
        })
    }
}

/// The cursors over a sim's journal.
#[derive(Default)]
pub struct ClipTap {
    worlds: u32,
    seen_setup: usize,
    seen_entries: usize,
    last_tick: u64,
    map_hash: [u8; 32],
}

impl ClipTap {
    /// What's new since the last poll. A world is new when the sim has fewer ticks or a shorter journal than last time,
    /// or another map: the host rebuilt it.
    pub fn poll(&mut self, sim: &Sim, map: &LoadedMap, hash: bool) -> Poll {
        let j = sim.journal();
        let fresh = self.worlds == 0
            || sim.tick() < self.last_tick
            || j.setup.len() < self.seen_setup
            || j.entries.len() < self.seen_entries
            || map.hash != self.map_hash
            // A new sim the same size as the last one: its first poll comes at tick 0 or with a new seed.
            || (sim.tick() == 0 && self.last_tick > 0);
        let mut start = None;
        if fresh {
            self.worlds += 1;
            (self.seen_setup, self.seen_entries) = (0, 0);
            self.map_hash = map.hash;
            start = Some(WorldStart {
                seed: j.seed,
                map_hash: map.hash,
                map: map.canonical.clone(),
            });
        }
        let chunk = Chunk {
            setup: j.setup[self.seen_setup..].to_vec(),
            entries: j.entries[self.seen_entries..].to_vec(),
        };
        (self.seen_setup, self.seen_entries) = (j.setup.len(), j.entries.len());
        self.last_tick = sim.tick();
        Poll {
            world: self.worlds - 1,
            start,
            tick: sim.tick(),
            chunk,
            hash: hash.then(|| sim.state_hash()),
            setup_len: j.setup.len(),
        }
    }
}

/// A clip's or session's file: every world the host simulated, as much of it as was kept.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub format: String,
    /// The host build (git commit) that simulated it; a replay by another build is refused.
    pub build: String,
    #[serde(default)]
    pub saved_at: String,
    /// The marked moment (a clip).
    #[serde(default)]
    pub mark: Option<Mark>,
    /// Who was in the room when it was saved.
    #[serde(default)]
    pub roster: Value,
    /// The worker's fault, if the clip was saved after one: worlds replay up to the fault's tick.
    #[serde(default)]
    pub fault: Option<Fault>,
    /// The session summary (F12): rounds, roster changes, connection paths, input ages, frame pacing.
    #[serde(default)]
    pub summary: Value,
    /// Other facts the host kept (preparations, frame times of the save…).
    #[serde(default)]
    pub notes: Value,
    pub worlds: Vec<World>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub world: u32,
    pub tick: u64,
    #[serde(default)]
    pub note: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fault {
    pub world: u32,
    pub tick: u64,
    pub message: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    pub index: u32,
    /// What it was in the room: "round 2", "lobby", "free drive"…
    #[serde(default)]
    pub label: String,
    /// The round's number, when it was a round.
    #[serde(default)]
    pub round: Option<u32>,
    pub session_seed: u64,
    /// The track seed (session seed + preparation id) of a generated map, so the bug names the exact track.
    #[serde(default)]
    pub track_seed: Option<u64>,
    #[serde(default)]
    pub preparation: Option<u32>,
    pub map_hash: String,
    /// The map's canonical bytes, base64.
    pub map: String,
    /// The journal's pieces in order, each a postcard [`Chunk`] in base64.
    pub chunks: Vec<String>,
    /// How far the journal reaches: the last tick polled.
    pub end_tick: u64,
    /// Full-state hashes the host took on the way: a replay verifies every one.
    #[serde(default)]
    pub checkpoints: Vec<Checkpoint>,
}

/// A full-state hash taken at `tick`, after the journal's first `setup` setup commands (those at the same tick as the
/// poll may or may not have landed yet; the count says which).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub tick: u64,
    pub hash: String,
    pub setup: usize,
}

impl World {
    /// Starts a world from a first poll.
    pub fn from_start(index: u32, s: &WorldStart) -> Self {
        Self {
            index,
            session_seed: s.seed,
            map_hash: hex(&s.map_hash),
            map: B64.encode(&s.map),
            ..Self::default()
        }
    }

    /// Appends a poll's chunk (and checkpoint) to the world.
    pub fn push(&mut self, p: &Poll) {
        if !p.chunk.is_empty() {
            self.chunks.push(B64.encode(p.chunk.to_bytes()));
        }
        self.end_tick = p.tick;
        if let Some(h) = p.hash {
            self.checkpoints.push(Checkpoint {
                tick: p.tick,
                hash: hex(&h),
                setup: p.setup_len,
            });
        }
    }

    /// The whole journal from its chunks.
    pub fn journal(&self) -> Result<Journal, String> {
        let mut map_hash = [0u8; 32];
        let bytes = unhex(&self.map_hash)?;
        if bytes.len() != 32 {
            return Err(format!("world {}: mapHash isn't 32 bytes", self.index));
        }
        map_hash.copy_from_slice(&bytes);
        let mut j = Journal {
            seed: self.session_seed,
            map_hash,
            ..Journal::default()
        };
        for (i, c) in self.chunks.iter().enumerate() {
            let bytes = B64
                .decode(c)
                .map_err(|e| format!("world {} chunk {i}: {e}", self.index))?;
            let chunk = Chunk::from_bytes(&bytes)
                .map_err(|e| format!("world {} chunk {i}: {e}", self.index))?;
            j.setup.extend(chunk.setup);
            j.entries.extend(chunk.entries);
        }
        Ok(j)
    }

    pub fn map_bytes(&self) -> Result<Vec<u8>, String> {
        B64.decode(&self.map)
            .map_err(|e| format!("world {} map: {e}", self.index))
    }
}

fn unhex(s: &str) -> Result<Vec<u8>, String> {
    if !s.len().is_multiple_of(2) {
        return Err(format!("bad hex {s:?}"));
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| format!("bad hex {s:?}")))
        .collect()
}

impl Bundle {
    pub fn from_json(bytes: &[u8]) -> Result<Self, String> {
        let b: Bundle = serde_json::from_slice(bytes).map_err(|e| format!("not a clip: {e}"))?;
        if b.format != FORMAT_CLIP && b.format != FORMAT_SESSION {
            return Err(format!(
                "not a clip: format {:?} (expected {FORMAT_CLIP} or {FORMAT_SESSION})",
                b.format
            ));
        }
        Ok(b)
    }
}

/// One checkpoint, replayed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointResult {
    pub tick: u64,
    pub expected: String,
    pub actual: String,
    pub ok: bool,
}

/// One world, replayed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldReport {
    pub index: u32,
    pub label: String,
    pub round: Option<u32>,
    pub session_seed: u64,
    pub track_seed: Option<u64>,
    pub map_hash: String,
    pub ticks: u64,
    /// The full-state hash at `ticks`, the end of what the clip kept of this world.
    pub end_hash: String,
    pub checkpoints: Vec<CheckpointResult>,
    /// Every recorded checkpoint matched (and there was at least one, or no hash to check).
    pub ok: bool,
}

/// The marked moment, replayed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReport {
    pub world: u32,
    pub tick: u64,
    pub note: String,
    pub state_hash: String,
    pub cars: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub format: String,
    pub build: String,
    pub worlds: Vec<WorldReport>,
    pub mark: Option<MarkReport>,
    pub fault: Option<Fault>,
    pub ok: bool,
    /// `--trace` rows per world, in `jj sim --trace`'s shape (the last row of each is its summary).
    #[serde(skip)]
    pub traces: Vec<Vec<Value>>,
}

/// Applies one setup command the way `Sim::replay` does.
fn apply(sim: &mut Sim, s: &Setup) {
    match s {
        Setup::SpawnCar { pose, .. } => {
            sim.spawn_car(*pose);
        }
        Setup::PlaceCar {
            car,
            pose,
            roll,
            linvel,
        } => sim.place_car(CarId(*car), *pose, *roll, *linvel),
        Setup::StartRace { laps } => sim.start_race(*laps),
        Setup::Recover { car } => {
            sim.recover(CarId(*car));
        }
        Setup::DropIn => {
            sim.drop_in();
        }
        Setup::SpawnDebris { pose, half } => sim.spawn_debris(*pose, *half),
        Setup::Autopilot { car, on } => sim.set_autopilot(CarId(*car), *on),
        Setup::Wheelie { car, preload_ms } => {
            sim.wheelie(CarId(*car), *preload_ms);
        }
        Setup::Utility { car, kind } => {
            sim.utility(CarId(*car), *kind);
        }
        Setup::PartHealth { car, part, health } => sim.set_part_health(CarId(*car), *part, *health),
        Setup::Wreck { car } => {
            sim.wreck(CarId(*car));
        }
    }
}

/// Replays one world to `until` ticks, calling `at(sim, tick, applied)` at every point a checkpoint can be taken: each tick
/// boundary and after each setup command (`applied`: how many have been applied), and `row(sim, tick, events)` after
/// each step.
fn replay_world(
    sim: &mut Sim,
    journal: &Journal,
    until: u64,
    mut at: impl FnMut(&Sim, u64, usize),
    mut row: impl FnMut(&Sim, u64, Vec<Value>),
) {
    let mut applied = 0usize;
    let mut entries = journal.entries.iter().peekable();
    at(sim, 0, applied);
    row(sim, 0, vec![]);
    let mut events = Vec::new();
    loop {
        while let Some((t, s)) = journal.setup.get(applied).filter(|(t, _)| *t == sim.tick()) {
            apply(sim, s);
            applied += 1;
            events.push(json!({ "at": t, "setup": s }));
            at(sim, sim.tick(), applied);
        }
        if sim.tick() >= until {
            break;
        }
        while let Some(e) = entries.next_if(|e| e.tick == sim.tick()) {
            sim.set_input(CarId(e.car), e.input);
            events.push(json!({ "at": e.tick, "input": { "car": e.car,
                "throttle": dequantise_axis(e.input.throttle), "steer": dequantise_axis(e.input.steer),
                "brake": dequantise_axis(e.input.brake) } }));
        }
        sim.step();
        at(sim, sim.tick(), applied);
        row(sim, sim.tick(), std::mem::take(&mut events));
    }
}

/// Re-simulates every world of a bundle (`profile`: the car the host raced). `registry` is the kit the maps validate
/// against (generated maps use `jj_procgen::registry()`, a superset of the generic kit).
pub fn replay(
    bundle: &Bundle,
    registry: &Registry,
    profile: &VehicleProfile,
    trace: bool,
) -> Result<Report, String> {
    let mut worlds = Vec::new();
    let mut traces = Vec::new();
    let mut mark_report = None;
    for w in &bundle.worlds {
        let journal = w.journal()?;
        let map = load_canonical(&w.map_bytes()?, registry).map_err(|r| {
            format!(
                "world {}: the map doesn't validate: {:?}",
                w.index,
                r.violations
                    .iter()
                    .map(|v| v.rule.name())
                    .collect::<Vec<_>>()
            )
        })?;
        if hex(&map.hash) != w.map_hash {
            return Err(format!(
                "world {}: the map bytes hash to {}, the clip says {}",
                w.index,
                hex(&map.hash),
                w.map_hash
            ));
        }
        let route = RouteGeom::new(&map.map);
        let mut sim = Sim::new(&map, registry, journal.seed, profile.clone());
        let mark = bundle.mark.as_ref().filter(|m| m.world == w.index);
        let mut checkpoints: Vec<CheckpointResult> = Vec::new();
        let mut rows: Vec<Value> = Vec::new();
        let until = w.end_tick.max(mark.map_or(0, |m| m.tick.min(w.end_tick)));
        let mut marked = None;
        replay_world(
            &mut sim,
            &journal,
            until,
            |sim, tick, applied| {
                for c in &w.checkpoints {
                    if c.tick == tick && c.setup == applied {
                        let actual = hex(&sim.state_hash());
                        checkpoints.push(CheckpointResult {
                            tick,
                            ok: actual == c.hash,
                            expected: c.hash.clone(),
                            actual,
                        });
                    }
                }
                if let Some(m) = mark.filter(|m| m.tick == tick && marked.is_none()) {
                    marked = Some(MarkReport {
                        world: w.index,
                        tick,
                        note: m.note.clone(),
                        state_hash: hex(&sim.state_hash()),
                        cars: json!(observe_cars(sim, &route)),
                    });
                }
            },
            |sim, tick, events| {
                if trace {
                    rows.push(json!({ "tick": tick, "cars": observe_cars(sim, &route), "events": events }));
                }
            },
        );
        if marked.is_some() {
            mark_report = marked;
        }
        let end_hash = hex(&sim.state_hash());
        // A checkpoint the replay never reached (its tick or setup count doesn't exist here) is a failure too.
        for c in w.checkpoints.iter().filter(|c| c.tick <= until) {
            if !checkpoints
                .iter()
                .any(|r| r.tick == c.tick && r.expected == c.hash)
            {
                checkpoints.push(CheckpointResult {
                    tick: c.tick,
                    expected: c.hash.clone(),
                    actual: "not reached".into(),
                    ok: false,
                });
            }
        }
        if trace {
            rows.push(
                json!({ "summary": { "scenario": format!("clip-world-{}", w.index),
                "ticks": sim.tick(), "stateHash": end_hash, "tuned": Vec::<String>::new() } }),
            );
        }
        traces.push(rows);
        worlds.push(WorldReport {
            index: w.index,
            label: w.label.clone(),
            round: w.round,
            session_seed: journal.seed,
            track_seed: w.track_seed,
            map_hash: w.map_hash.clone(),
            ticks: sim.tick(),
            end_hash,
            ok: checkpoints.iter().all(|c| c.ok) && sim.tick() == until,
            checkpoints,
        });
    }
    if let Some(m) = &bundle.mark
        && mark_report.is_none()
    {
        return Err(format!(
            "the mark (world {}, tick {}) is beyond what the clip kept",
            m.world, m.tick
        ));
    }
    let ok = worlds.iter().all(|w| w.ok);
    Ok(Report {
        format: bundle.format.clone(),
        build: bundle.build.clone(),
        worlds,
        mark: mark_report,
        fault: bundle.fault.clone(),
        ok,
        traces,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use jj_sim::{DriveInput, route_spawn};

    const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");

    fn map() -> LoadedMap {
        jj_map::load_json(GREYBOX.as_bytes(), &Registry::generic()).unwrap()
    }

    /// Drives a sim for `ticks`, polling every `every` ticks, the way the host's worker would.
    fn drive(
        sim: &mut Sim,
        map: &LoadedMap,
        tap: &mut ClipTap,
        every: u64,
        ticks: u64,
        w: &mut World,
    ) {
        for i in 0..ticks {
            if i % 50 == 10 {
                sim.set_input(
                    CarId(0),
                    DriveInput {
                        throttle: 20000 + (i as i16 % 7) * 1000,
                        steer: if i % 100 < 50 { 5000 } else { -5000 },
                        ..DriveInput::default()
                    },
                );
            }
            sim.step();
            if sim.tick().is_multiple_of(every) {
                w.push(&tap.poll(sim, map, sim.tick().is_multiple_of(every * 4)));
            }
        }
    }

    #[test]
    fn a_world_kept_in_chunks_replays_to_its_checkpoints_and_the_mark() {
        let map = map();
        let mut sim = Sim::new(&map, &Registry::generic(), 9, VehicleProfile::cruz());
        sim.spawn_car(route_spawn(&map, 16, 0.0, 0.0));
        let mut tap = ClipTap::default();
        let first = tap.poll(&sim, &map, true);
        let mut w = World::from_start(first.world, first.start.as_ref().unwrap());
        w.push(&first);
        drive(&mut sim, &map, &mut tap, 15, 600, &mut w);
        assert!(w.chunks.len() > 2, "the journal arrived in pieces");
        let bundle = Bundle {
            format: FORMAT_CLIP.into(),
            build: "test".into(),
            mark: Some(Mark {
                world: 0,
                tick: 300,
                note: "here".into(),
            }),
            worlds: vec![w],
            ..Bundle::default()
        };
        let bundle = Bundle::from_json(&serde_json::to_vec(&bundle).unwrap()).unwrap();
        let r = replay(&bundle, &Registry::generic(), &VehicleProfile::cruz(), true).unwrap();
        assert!(r.ok, "{r:?}");
        assert_eq!(r.worlds[0].ticks, 600);
        assert_eq!(r.worlds[0].end_hash, hex(&sim.state_hash()));
        assert!(r.worlds[0].checkpoints.len() >= 10);
        assert_eq!(r.mark.as_ref().unwrap().tick, 300);
        assert_eq!(r.traces[0].len(), 601 + 1, "a row per tick and the summary");
        // The same journal through `Sim::replay`'s own loop gives the same hash.
        let j = bundle.worlds[0].journal().unwrap();
        let again = Sim::replay(&map, &Registry::generic(), VehicleProfile::cruz(), &j, 600);
        assert_eq!(hex(&again.state_hash()), r.worlds[0].end_hash);
    }

    #[test]
    fn a_rebuilt_sim_is_a_new_world_and_a_flipped_checkpoint_is_found() {
        let map = map();
        let mut tap = ClipTap::default();
        let mut bundle = Bundle {
            format: FORMAT_SESSION.into(),
            build: "test".into(),
            ..Bundle::default()
        };
        for seed in [3u64, 4] {
            let mut sim = Sim::new(&map, &Registry::generic(), seed, VehicleProfile::cruz());
            sim.spawn_car(route_spawn(&map, 8, 0.0, 0.0));
            let first = tap.poll(&sim, &map, true);
            let mut w = World::from_start(first.world, first.start.as_ref().unwrap());
            w.push(&first);
            drive(&mut sim, &map, &mut tap, 20, 240, &mut w);
            bundle.worlds.push(w);
        }
        assert_eq!(
            bundle.worlds.iter().map(|w| w.index).collect::<Vec<_>>(),
            [0, 1]
        );
        assert_eq!(bundle.worlds[1].session_seed, 4);
        let r = replay(
            &bundle,
            &Registry::generic(),
            &VehicleProfile::cruz(),
            false,
        )
        .unwrap();
        assert!(r.ok && r.worlds.len() == 2, "{r:?}");
        // A different hash recorded at a tick is a divergence the report names.
        bundle.worlds[1].checkpoints[3].hash = "00".repeat(32);
        let r = replay(
            &bundle,
            &Registry::generic(),
            &VehicleProfile::cruz(),
            false,
        )
        .unwrap();
        assert!(!r.ok);
        assert!(r.worlds[0].ok && !r.worlds[1].ok);
        assert_eq!(r.worlds[1].checkpoints.iter().filter(|c| !c.ok).count(), 1);
    }

    #[test]
    fn a_clip_cut_at_a_fault_replays_up_to_the_last_polled_tick() {
        let map = map();
        let mut sim = Sim::new(&map, &Registry::generic(), 5, VehicleProfile::cruz());
        sim.spawn_car(route_spawn(&map, 4, 0.0, 0.0));
        let mut tap = ClipTap::default();
        let first = tap.poll(&sim, &map, true);
        let mut w = World::from_start(0, first.start.as_ref().unwrap());
        w.push(&first);
        drive(&mut sim, &map, &mut tap, 10, 200, &mut w);
        let at_fault = hex(&sim.state_hash());
        // The worker panics; later steps never reach main.
        let b = Bundle {
            format: FORMAT_CLIP.into(),
            build: "t".into(),
            fault: Some(Fault {
                world: 0,
                tick: 200,
                message: "debug_panic".into(),
            }),
            worlds: vec![w],
            ..Bundle::default()
        };
        let r = replay(&b, &Registry::generic(), &VehicleProfile::cruz(), false).unwrap();
        assert_eq!(
            (r.worlds[0].ticks, r.worlds[0].end_hash.clone()),
            (200, at_fault)
        );
    }
}
