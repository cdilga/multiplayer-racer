//! The host's test surface (P1-F05b, R90): the `jj sim` fixture commands (`jj-fixture`), run inside the real host's
//! worker so Playwright, agents and smoke checks can see, set up and step the live host. Built only with the `testing`
//! feature, which only the test chunk's worker loads (`web/host/src/testing/`); the shipped worker has none of it.
//!
//! One JSON command in, one JSON answer out (`HostSim::test`):
//!
//! | `cmd` | does | answers |
//! |---|---|---|
//! | `autopilot` `{car?, on}` | every car (or one) to or from the autopilot | `{cars, on}` |
//! | `hold` `{on}` | holds the clock (test mode starts held): only `step` moves the sim | `{tick, held}` |
//! | `load` `{fixture, mapJson?}` | a fresh host world set up from a `jj sim` fixture (its map, or `mapJson`) | `{tick, cars}` |
//! | `spawn` `{cars: [CarSpec]}` | more cars, as a fixture's `cars` entries (journaled) | `{cars: [id]}` |
//! | `inputs` `{spans: [InputSpan]}` | more scripted input spans (a seated car follows its seat, not the script) | `{spans}` |
//! | `step` `{ticks}` | exactly that many ticks, held or not | `{tick}` |
//! | `until` `{until, maxTicks}` | steps until a car's metric is in range (`Until`, as in fixtures) | `{tick, ticks, held}` |
//! | `observe` | cars (as `jj sim` observations), debris, the fixture's session, the host's seats and pauses | state |
//! | `hash` | the full-state hash | `{tick, stateHash}` |
//! | `meta` | what a capture records about the run: map hash, seed, the fixture's scenario | `{mapHash, seed, scenario}` |
//! | `journalChunk` `{hash?}` | what the journal gained since the last call (bug clips, P1-F07): the world number (new when the host rebuilt the sim), its start (seed, map hash, canonical bytes), tick, the chunk (postcard, base64) and with `hash` the full-state hash | `{world, tick, start?, chunk?, hash?, setup, phase, round, freeDrive, pending}` |
//! | `outcome` | the fixture's envelope checks (end-of-run ones evaluated now) and outcome signatures | `{checks, signature}` |
//!
//! The fixture shapes are `jj-fixture`'s, so the same fixture gives the same full-state hash here as from `jj sim`.

use serde::Deserialize;
use serde_json::{Value, json};

use jj_fixture::{CarSpec, Fixture, Harness, InputSpan, Until};
use jj_map::{Registry, load_json};
use jj_sim::observe::{RouteGeom, observe_cars};

use super::{Host, STALE_MS, tick_ms};

#[derive(Default)]
pub struct TestState {
    /// Held: the worker's clock doesn't step the sim; only `step` and `until` do.
    pub held: bool,
    /// The fixture run around the host's sim: a loaded fixture, or an empty one the first command that needs it makes.
    pub harness: Option<Harness>,
    /// The seed the sim started from (captures record it).
    pub seed: u64,
    /// The cursors of `journalChunk` (bug clips, P1-F07).
    pub tap: jj_fixture::clip::ClipTap,
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase", deny_unknown_fields)]
enum Command {
    Hold {
        on: bool,
    },
    #[serde(rename_all = "camelCase")]
    Load {
        fixture: Box<Fixture>,
        #[serde(default)]
        map_json: Option<String>,
    },
    Spawn {
        cars: Vec<CarSpec>,
    },
    Inputs {
        spans: Vec<InputSpan>,
    },
    /// Sets a part's health (R90 "settable", P1-S04b): `part` is a contract part name (`front`, `door_FL`…). 0 detaches
    /// it, at or under half makes it loose.
    Damage {
        car: u32,
        part: String,
        health: f32,
    },
    /// Hands every car (or one) to the autopilot, so a journey can race full rounds hands-off (P1-G01).
    Autopilot {
        #[serde(default)]
        car: Option<u32>,
        on: bool,
    },
    Step {
        ticks: u64,
    },
    #[serde(rename_all = "camelCase")]
    Until {
        until: Until,
        max_ticks: u64,
    },
    /// What the journal gained since the last call, for bug clips and the session recorder (P1-F07, P1-F12).
    JournalChunk {
        #[serde(default)]
        hash: bool,
    },
    Observe,
    Hash,
    Outcome,
    Meta,
}

fn empty_fixture(seed: u64) -> Fixture {
    serde_json::from_value(json!({
        "scenario": "live-host", "what": "the live host, observed through the test surface",
        "map": "", "seed": seed, "ticks": 0
    }))
    .expect("the empty fixture is valid")
}

impl Host {
    fn harness(&mut self) -> Result<&mut Harness, String> {
        if self.test.harness.is_none() {
            let mut h = Harness::new(empty_fixture(0), &self.map, &mut self.sim, false)?;
            h.record(&self.sim, false);
            self.test.harness = Some(h);
        }
        Ok(self.test.harness.as_mut().expect("just made"))
    }

    /// The host's own seats: who holds them, their source handles and cars, and how fresh their input is.
    fn observe_seats(&self) -> Vec<Value> {
        let now_ms = tick_ms(self.sim.tick());
        self.seats
            .seats()
            .map(|s| {
                let input = self.inputs.get(&s.id);
                let age = input.and_then(|i| i.state.age_ms(now_ms));
                json!({
                    "seat": s.id.0,
                    "number": s.number.0,
                    "colour": s.colour,
                    "name": self.seats.display_name(s.id),
                    "endpoint": s.endpoint.0,
                    "connected": s.conn.is_some(),
                    "source": s.source.0,
                    "presence": format!("{:?}", s.presence),
                    "car": input.and_then(|i| i.car).map(|c| c.0),
                    "inputAgeMs": age,
                    "fresh": age.is_some_and(|a| a <= STALE_MS),
                })
            })
            .collect()
    }

    fn observe(&self) -> Value {
        let mut state = match &self.test.harness {
            Some(h) => h.observe(&self.sim),
            None => json!({
                "tick": self.sim.tick(),
                "cars": observe_cars(&self.sim, &RouteGeom::new(&self.map.map)),
                "debris": jj_fixture::debris(&self.sim),
            }),
        };
        state["host"] = json!({
            "seats": self.observe_seats(),
            "pauseMask": self.pause_mask(),
            "countdownMs": self.countdown_us() / 1000,
            "held": self.test.held,
            "queued": self.queued.len(),
        });
        state
    }

    /// One test-surface command (JSON) → its answer (JSON).
    pub fn test_command(&mut self, json: &str) -> Result<Value, String> {
        let cmd: Command =
            serde_json::from_str(json).map_err(|e| format!("bad test command: {e}"))?;
        Ok(match cmd {
            Command::Hold { on } => {
                self.test.held = on;
                json!({ "tick": self.sim.tick(), "held": on })
            }
            Command::Load { fixture, map_json } => {
                let map = match map_json {
                    Some(text) => {
                        load_json(text.as_bytes(), &Registry::generic()).map_err(|r| {
                            format!(
                                "the map doesn't validate: {:?}",
                                r.violations
                                    .iter()
                                    .map(|v| v.rule.name())
                                    .collect::<Vec<_>>()
                            )
                        })?
                    }
                    None => self.map.clone(),
                };
                let held = self.test.held;
                *self = Host::from_map(map, fixture.seed);
                self.test.held = held;
                let mut h = Harness::new(*fixture, &self.map, &mut self.sim, false)?;
                h.record(&self.sim, false);
                self.test.harness = Some(h);
                json!({ "tick": self.sim.tick(), "cars": self.sim.cars().count() })
            }
            Command::Spawn { cars } => {
                let mut ids = Vec::new();
                for (i, c) in cars.iter().enumerate() {
                    self.harness()?;
                    let h = self.test.harness.as_mut().expect("made above");
                    ids.push(
                        h.spawn(&self.map, &mut self.sim, c)
                            .map_err(|e| format!("cars[{i}] {e}"))?
                            .0,
                    );
                }
                json!({ "cars": ids })
            }
            Command::Inputs { spans } => {
                let n = spans.len();
                self.harness()?.add_inputs(spans);
                json!({ "spans": n })
            }
            Command::Damage { car, part, health } => {
                let i = jj_sim::damage::part_index(&part)
                    .filter(|&i| i > 0)
                    .ok_or_else(|| format!("no damageable part {part:?}"))?;
                self.sim
                    .set_part_health(jj_sim::CarId(car), i as u8, health);
                json!({ "tick": self.sim.tick(), "part": part, "health": health })
            }
            Command::Autopilot { car, on } => {
                let cars: Vec<jj_sim::CarId> = match car {
                    Some(c) => vec![jj_sim::CarId(c)],
                    None => self.sim.cars().collect(),
                };
                for &c in &cars {
                    self.sim.set_autopilot(c, on);
                }
                json!({ "cars": cars.len(), "on": on })
            }
            Command::Step { ticks } => {
                for _ in 0..ticks {
                    self.step_one();
                }
                json!({ "tick": self.sim.tick() })
            }
            Command::Until { until, max_ticks } => {
                self.harness()?;
                let mut ticks = 0;
                let mut held = self.test.harness.as_ref().is_some_and(|h| h.holds(&until));
                while !held && ticks < max_ticks {
                    self.step_one();
                    ticks += 1;
                    held = self.test.harness.as_ref().is_some_and(|h| h.holds(&until));
                }
                json!({ "tick": self.sim.tick(), "ticks": ticks, "held": held })
            }
            Command::JournalChunk { hash } => {
                let p = self.test.tap.poll(&self.sim, &self.map, hash);
                json!({
                    "world": p.world,
                    "tick": p.tick,
                    "start": p.start.as_ref().map(|s| json!({
                        "seed": s.seed, "mapHash": jj_map::hex(&s.map_hash), "map": jj_fixture::clip::b64(&s.map) })),
                    "chunk": (!p.chunk.is_empty()).then(|| jj_fixture::clip::b64(&p.chunk.to_bytes())),
                    "hash": p.hash.map(|h| jj_map::hex(&h)),
                    "setup": p.setup_len,
                    "phase": format!("{:?}", self.round.director.phase()),
                    "round": self.round.director.round().map(|r| r.0),
                    "freeDrive": self.round.free_drive,
                    "pending": self.round.pending.map(|(id, seed)| json!({ "id": id.0, "seed": seed })),
                })
            }
            Command::Observe => self.observe(),
            Command::Meta => json!({
                "mapHash": jj_map::hex(&self.map.hash),
                "seed": self.test.seed,
                "scenario": self.test.harness.as_ref().map(|h| h.fixture().scenario.clone()),
            }),
            Command::Hash => {
                json!({ "tick": self.sim.tick(), "stateHash": jj_map::hex(&self.sim.state_hash()) })
            }
            Command::Outcome => {
                self.harness()?;
                let h = self.test.harness.as_mut().expect("made above");
                h.check_now(&self.sim);
                json!({ "checks": h.checks(), "signature": h.signature() })
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use jj_fixture::{Fixture, Harness};
    use jj_map::{Registry, load_json};
    use jj_protocol::PROTOCOL_VERSION;
    use jj_protocol::abi::{ABI_VERSION, Channel, MainToSim};
    use jj_protocol::cmd::ControllerCmd;
    use jj_sim::{Sim, VehicleProfile};
    use jj_types::{BuildId, EndpointId, RequestId};
    use serde_json::{Value, json};

    use super::Host;

    const GREYBOX: &str = include_str!("../../../../maps/greybox-loop.json");
    const THREE_CARS: &str = include_str!("../../../../scenarios/introspection/three-cars.json");

    fn host() -> Host {
        let map = load_json(GREYBOX.as_bytes(), &Registry::generic()).unwrap();
        let init = MainToSim::Init {
            abi_version: ABI_VERSION,
            rules_hash: [0; 32],
            map_bytes: map.canonical,
            vehicle_sidecars: vec![],
            seed: 1,
        };
        // The test surface drives cars as they're claimed: G04's free drive (the host page's `?test` does the same).
        let mut h = Host::new(&init.encode()).unwrap();
        h.set_free_drive(true);
        h
    }

    fn cmd(h: &mut Host, v: Value) -> Value {
        h.test_command(&v.to_string()).unwrap()
    }

    /// The `jj sim` loop (crates/jj-tools/src/sim) over the whole fixture: the native reference hash.
    fn native_hash(fixture: &str) -> String {
        let fx: Fixture = serde_json::from_str(fixture).unwrap();
        let map = load_json(GREYBOX.as_bytes(), &Registry::generic()).unwrap();
        let ticks = fx.ticks;
        let mut sim = Sim::new(&map, &Registry::generic(), fx.seed, VehicleProfile::cruz());
        let mut h = Harness::new(fx, &map, &mut sim, false).unwrap();
        h.record(&sim, ticks == 0);
        while sim.tick() < ticks {
            h.before_step(&mut sim);
            sim.step();
            h.after_step(&sim, sim.tick() == ticks);
        }
        jj_map::hex(&sim.state_hash())
    }

    #[test]
    fn spawning_through_the_surface_and_stepping_held_matches_the_native_fixture_run() {
        let full: Value = serde_json::from_str(THREE_CARS).unwrap();
        let mut bare = full.clone();
        bare["cars"] = json!([]);
        bare["inputs"] = json!([]);
        let mut h = host();
        cmd(&mut h, json!({ "cmd": "hold", "on": true }));
        cmd(&mut h, json!({ "cmd": "load", "fixture": bare }));
        let spawned = cmd(&mut h, json!({ "cmd": "spawn", "cars": full["cars"] }));
        assert_eq!(spawned["cars"], json!([0, 1, 2]));
        cmd(&mut h, json!({ "cmd": "inputs", "spans": full["inputs"] }));
        // Held: the worker's clock moves nothing.
        for t in 0..100 {
            h.advance(t * 10_000);
        }
        assert_eq!(h.tick(), 0);
        assert_eq!(
            cmd(&mut h, json!({ "cmd": "step", "ticks": 600 }))["tick"],
            600
        );
        let hash = cmd(&mut h, json!({ "cmd": "hash" }));
        assert_eq!(hash["stateHash"], native_hash(THREE_CARS));
        let outcome = cmd(&mut h, json!({ "cmd": "outcome" }));
        assert_eq!(outcome["checks"].as_array().unwrap().len(), 3);
        assert!(
            outcome["checks"]
                .as_array()
                .unwrap()
                .iter()
                .all(|c| c["ok"] == true),
            "{outcome}"
        );
    }

    #[test]
    fn until_steps_to_the_predicate_and_observe_shows_controller_seats() {
        let mut h = host();
        cmd(&mut h, json!({ "cmd": "hold", "on": true }));
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("fake-0".into()),
            resume: None,
        };
        let claim = ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        };
        for c in [hello, claim] {
            let bytes = MainToSim::NetBytes {
                endpoint: EndpointId("fake-0".into()),
                channel: Channel::Cmd,
                bytes: c.encode(),
            };
            h.handle(&bytes.encode()).unwrap();
        }
        cmd(&mut h, json!({ "cmd": "step", "ticks": 1 }));
        let seen = cmd(&mut h, json!({ "cmd": "observe" }));
        let seat = &seen["host"]["seats"][0];
        assert_eq!(
            (
                seat["endpoint"].as_str(),
                seat["source"].as_u64(),
                seat["car"].as_u64()
            ),
            (Some("fake-0"), Some(1), Some(0))
        );
        assert_eq!(seen["cars"].as_array().unwrap().len(), 1);
        // A seated car follows its seat (silent here, so neutral): script a second, unseated car instead and step
        // until it has travelled 10 m.
        let spawned = cmd(
            &mut h,
            json!({ "cmd": "spawn", "cars": [{ "routePoint": 16, "lateral": 4 }] }),
        );
        assert_eq!(spawned["cars"], json!([1]));
        cmd(
            &mut h,
            json!({ "cmd": "inputs", "spans": [{ "car": 0, "fromTick": 0, "throttle": 1.0 },
                                                      { "car": 1, "fromTick": 0, "throttle": 1.0 }] }),
        );
        let until = cmd(
            &mut h,
            json!({ "cmd": "until", "until": { "car": 1, "metric": "travel", "min": 10 }, "maxTicks": 1200 }),
        );
        assert_eq!(until["held"], true, "{until}");
        assert!(until["ticks"].as_u64().unwrap() < 1200);
        let seen = cmd(&mut h, json!({ "cmd": "observe" }));
        assert!(
            seen["cars"][0]["speed"].as_f64().unwrap() < 0.5,
            "the seated car ignored the script"
        );
        assert_eq!(seen["cars"][1]["wheels"].as_array().unwrap().len(), 4);
    }

    /// A clip kept from `journalChunk` polls replays to the live hash, across the host rebuilding its sim (P1-F07).
    #[test]
    fn journal_chunks_kept_by_main_replay_to_the_live_hash_across_worlds() {
        use jj_fixture::clip::{Bundle, Checkpoint, FORMAT_CLIP, World, replay};
        let mut h = host();
        cmd(&mut h, json!({ "cmd": "hold", "on": true }));
        let mut worlds: Vec<World> = Vec::new();
        let poll = |h: &mut Host, worlds: &mut Vec<World>, hash: bool| {
            let p = cmd(h, json!({ "cmd": "journalChunk", "hash": hash }));
            let index = p["world"].as_u64().unwrap() as u32;
            if !p["start"].is_null() {
                worlds.push(World {
                    index,
                    session_seed: p["start"]["seed"].as_u64().unwrap(),
                    map_hash: p["start"]["mapHash"].as_str().unwrap().into(),
                    map: p["start"]["map"].as_str().unwrap().into(),
                    ..World::default()
                });
            }
            let w = worlds.last_mut().unwrap();
            if let Some(c) = p["chunk"].as_str() {
                w.chunks.push(c.into());
            }
            w.end_tick = p["tick"].as_u64().unwrap();
            if let Some(hs) = p["hash"].as_str() {
                w.checkpoints.push(Checkpoint {
                    tick: w.end_tick,
                    hash: hs.into(),
                    setup: p["setup"].as_u64().unwrap() as usize,
                });
            }
        };
        poll(&mut h, &mut worlds, true);
        let hello = ControllerCmd::Hello {
            protocol: PROTOCOL_VERSION,
            build: BuildId("t".into()),
            endpoint: EndpointId("fake-0".into()),
            resume: None,
        };
        let claim = ControllerCmd::Claim {
            request: RequestId(1),
            name: "Ava".into(),
        };
        for c in [hello, claim] {
            let bytes = MainToSim::NetBytes {
                endpoint: EndpointId("fake-0".into()),
                channel: Channel::Cmd,
                bytes: c.encode(),
            };
            h.handle(&bytes.encode()).unwrap();
        }
        for i in 0..40 {
            cmd(&mut h, json!({ "cmd": "step", "ticks": 15 }));
            poll(&mut h, &mut worlds, i % 10 == 9);
        }
        // The host rebuilds its sim (free drive off and on: the Lobby's reset), as at every Countdown.
        h.set_free_drive(false);
        h.set_free_drive(true);
        for i in 0..8 {
            cmd(&mut h, json!({ "cmd": "step", "ticks": 15 }));
            poll(&mut h, &mut worlds, i == 7);
        }
        assert_eq!(worlds.len(), 2, "the rebuilt sim is a second world");
        let live = cmd(&mut h, json!({ "cmd": "hash" }));
        let bundle = Bundle {
            format: FORMAT_CLIP.into(),
            build: "t".into(),
            worlds,
            ..Bundle::default()
        };
        let r = replay(
            &bundle,
            &Registry::generic(),
            &VehicleProfile::cruz(),
            false,
        )
        .unwrap();
        assert!(r.ok, "{r:?}");
        assert_eq!(r.worlds[1].end_hash, live["stateHash"]);
        assert!(r.worlds[0].checkpoints.len() >= 4);
    }

    #[test]
    fn bad_commands_say_why() {
        let mut h = host();
        assert!(
            h.test_command(r#"{"cmd":"warp"}"#)
                .unwrap_err()
                .contains("bad test command")
        );
        assert!(
            h.test_command(r#"{"cmd":"spawn","cars":[{}]}"#)
                .unwrap_err()
                .contains("routePoint or pose")
        );
    }
}
