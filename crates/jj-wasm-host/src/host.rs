//! The host's sim core (P1-S02), run inside the host Web Worker through [`crate::HostSim`]. Native-testable: everything
//! here is plain Rust over `jj-sim`, `jj-session` and `jj-input`.
//!
//! **Clock.** The worker passes its monotonic time in. The host steps **whole** 120 Hz ticks from an exact integer
//! accumulator (µs × 120 against 10⁶). `dt` never grows and ticks are never skipped. Rendering has no say: the renderer
//! only reads snapshots.
//!
//! **Pauses compose:** `manual`, `host-hidden`, `renderer-unavailable`, `performance-stall`, `fault`. While any is on,
//! time doesn't accumulate (hidden time is never replayed). Every source is neutralised and re-armed at neutral. When the
//! last clears, a short resume countdown runs before ticks start again. A backlog past [`STALL_US`] enters
//! `performance-stall` at the last completed tick, dropping the backlog rather than skipping ticks. Controller loss never
//! pauses (R45): a source that goes quiet for [`STALE_MS`] just reads neutral.
//!
//! **Tick order:** due scheduled messages, then queued messages (each at this tick boundary), then the seats' tick
//! boundary (cars join or leave), then controls from each seat's source, then [`Sim::step`] (contacts, respawns and race
//! progress happen inside), then ordered events.
//!
//! **Inputs.** Controller bytes are decoded here (`jj-protocol`) and interpreted by `jj-input`'s [`SourceState`]. Host
//! pads and keys (`LocalSource`) go through the same machine, so the same tick inputs give the same car whichever way
//! they came (§7.3a source parity).

use std::collections::{BTreeMap, BTreeSet};

use jj_input::{Neutralise, SampleFlags, SourceSemantics, SourceState};
use jj_map::{LoadedMap, Registry, load_canonical};
use jj_protocol::abi::{ABI_VERSION, Channel, MainToSim, SimEvent, SimToMain, UiCommand};
use jj_protocol::cmd::{ActionKind, ControllerCmd, HostCmd};
use jj_protocol::state::{Hud, HudUpdate, PauseReason, StateFlags, StateMessage};
use jj_session::seats::{self, ConnId, SeatConfig, Seats};
use jj_sim::race::Event;
use jj_sim::{CarId, DriveInput, Sim, TICK_HZ, UtilityEvent, UtilityKind, VehicleProfile};

use jj_types::{ActionId, EndpointId, LocalSourceId, SeatId, Tick};
use sha2::{Digest, Sha256};

/// Microseconds the accumulator may fall behind before the host enters `performance-stall`.
pub const STALL_US: u64 = 500_000;
/// How long a performance stall holds before trying again.
pub const STALL_HOLD_US: u64 = 1_000_000;
/// The visible resume countdown after the last pause reason clears.
pub const RESUME_COUNTDOWN_US: u64 = 3_000_000;
/// A source silent this long reads neutral (dropout; autopilot takeover after 2 s is G03's).
pub const STALE_MS: u64 = 250;
/// A source silent (or gone) this long hands its car to the autopilot; fresh deliberate input takes it back (R45, §9).
pub const DROPOUT_MS: u64 = 2_000;
/// `LocalSource.buttons` bits (P1-C05): a pad's View/Select or a key cluster's Identify key, its Start or READY key,
/// the two held together for 2 s (Leave; the main thread times the hold), and the source being gone (an unplugged
/// pad: neutral now, the autopilot after [`DROPOUT_MS`]).
pub const LOCAL_IDENTIFY: u32 = 1;
pub const LOCAL_READY: u32 = 1 << 1;
pub const LOCAL_LEAVE: u32 = 1 << 2;
/// The input drawer's Sit out / Return for this source's seat (a toggle).
pub const LOCAL_SIT_OUT: u32 = 1 << 3;
pub const LOCAL_UNAVAILABLE: u32 = 1 << 31;
/// Snapshot layout: a header, then one record per car and per debris body (little-endian).
pub const SNAPSHOT_MAGIC: u32 = 0x4a4a_5331; // "JJS1"
pub const SNAPSHOT_HEADER: usize = 40;
pub const SNAPSHOT_CAR: usize = 64;
pub const SNAPSHOT_DEBRIS: usize = 32;

/// Why the sim isn't stepping. Bits in [`Host::pause_mask`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Pause {
    Manual = 1,
    HostHidden = 2,
    RendererUnavailable = 4,
    PerformanceStall = 8,
    Fault = 16,
}

#[derive(Debug)]
pub enum HostError {
    Decode(String),
    Abi(u16),
    Map(String),
    NotInit,
}

impl core::fmt::Display for HostError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            HostError::Decode(e) => write!(f, "decode: {e}"),
            HostError::Abi(v) => write!(f, "worker ABI {ABI_VERSION}, Init asked for {v}"),
            HostError::Map(e) => write!(f, "map: {e}"),
            HostError::NotInit => write!(f, "the first message must be Init"),
        }
    }
}

/// Where a seat's input comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Origin {
    Net(ConnId),
    Local(LocalSourceId),
}

struct SeatInput {
    state: SourceState,
    car: Option<CarId>,
    /// The controller's recent discrete action ids: a resent `Action` applies once (§5.4).
    seen_actions: Vec<ActionId>,
    /// The autopilot took the car because the source went quiet (dropout), so fresh input takes it back.
    dropped: bool,
}

/// A host pad or key cluster's button edges and its way back after leaving.
#[derive(Default)]
struct LocalButtons {
    last: u32,
    /// It left: once it has gone fully neutral, its next press joins as a new player with a new seat (the old seat
    /// keeps its number and standings).
    left: bool,
    left_released: bool,
    /// How many seats this source has had (its endpoint is `local:<id>`, then `local:<id>#2`…).
    generation: u32,
}

/// The controller HUD's cadence: 12 ticks at 120 Hz is 10 Hz.
const HUD_EVERY_TICKS: u64 = 12;

/// How many recent action ids a seat remembers for deduplication.
const SEEN_ACTIONS: usize = 32;

pub struct Host {
    sim: Sim,
    /// The map the sim runs on (the test surface's `load` and route-relative observations read it).
    #[cfg_attr(
        not(feature = "testing"),
        expect(dead_code, reason = "only the testing build reads it so far")
    )]
    map: LoadedMap,
    seats: Seats,
    inputs: BTreeMap<SeatId, SeatInput>,
    conns: BTreeMap<EndpointId, ConnId>,
    /// Connections that have said Hello.
    helloed: BTreeSet<ConnId>,
    locals: BTreeMap<LocalSourceId, ConnId>,
    local_buttons: BTreeMap<LocalSourceId, LocalButtons>,
    next_conn: ConnId,
    /// Accumulated time × 120 (µs units), and the last time the worker passed in.
    acc: u128,
    last_us: Option<u64>,
    pauses: BTreeSet<Pause>,
    stall_since_us: Option<u64>,
    /// When the resume countdown ends (worker µs), if one is running.
    resume_at_us: Option<u64>,
    now_us: u64,
    queued: Vec<MainToSim>,
    scheduled: BTreeMap<u64, Vec<MainToSim>>,
    stop_at: Option<u64>,
    out: Vec<SimToMain>,
    events: Vec<SimEvent>,
    seen_race_events: usize,
    /// How many of the sim's utility events have become seat events (P1-S08).
    seen_utility_events: usize,
    session_rev: u32,
    /// The test surface's state (P1-F05b): only in the `testing` build, never in the shipped worker.
    #[cfg(feature = "testing")]
    test: testing::TestState,
}

fn tick_ms(tick: u64) -> u64 {
    tick * 1000 / u64::from(TICK_HZ)
}

fn sha(bytes: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(&Sha256::digest(bytes));
    out
}

/// A seat's controls from its source's semantics. `jj-input` steers −1 left to +1 right; the sim's positive steer
/// turns left, so steering flips here. The ACTION stick's held sectors pass through (drift left, boost right).
fn controls(s: SourceSemantics) -> DriveInput {
    DriveInput::from_semantics(
        s.drive.throttle,
        s.drive.steer,
        s.drive.brake,
        s.drift,
        s.boost,
    )
}

impl Host {
    /// Starts from an `Init` message (canonical map bytes, seed, ABI version).
    pub fn new(init: &[u8]) -> Result<Self, HostError> {
        let MainToSim::Init {
            abi_version,
            map_bytes,
            seed,
            ..
        } = MainToSim::decode(init).map_err(|e| HostError::Decode(format!("{e:?}")))?
        else {
            return Err(HostError::NotInit);
        };
        if abi_version != ABI_VERSION {
            return Err(HostError::Abi(abi_version));
        }
        let map: LoadedMap = load_canonical(&map_bytes, &Registry::generic()).map_err(|r| {
            HostError::Map(format!(
                "{:?}",
                r.violations
                    .iter()
                    .map(|v| v.rule.name())
                    .collect::<Vec<_>>()
            ))
        })?;
        Ok(Self::from_map(map, seed))
    }

    /// A host on a validated map with a seed (the generic kit registry and the Cruz Missile profile).
    pub fn from_map(map: LoadedMap, seed: u64) -> Self {
        Self {
            sim: Sim::new(&map, &Registry::generic(), seed, VehicleProfile::cruz()),
            map,
            seats: Seats::new(SeatConfig {
                tick_hz: TICK_HZ,
                ..SeatConfig::default()
            }),
            inputs: BTreeMap::new(),
            conns: BTreeMap::new(),
            helloed: BTreeSet::new(),
            locals: BTreeMap::new(),
            local_buttons: BTreeMap::new(),
            next_conn: 1,
            acc: 0,
            last_us: None,
            pauses: BTreeSet::new(),
            stall_since_us: None,
            resume_at_us: None,
            now_us: 0,
            queued: Vec::new(),
            scheduled: BTreeMap::new(),
            stop_at: None,
            out: Vec::new(),
            events: Vec::new(),
            seen_race_events: 0,
            seen_utility_events: 0,
            session_rev: 0,
            #[cfg(feature = "testing")]
            test: testing::TestState {
                seed,
                ..Default::default()
            },
        }
    }

    pub fn tick(&self) -> u64 {
        self.sim.tick()
    }

    pub fn sim(&self) -> &Sim {
        &self.sim
    }

    pub fn state_hash(&self) -> [u8; 32] {
        self.sim.state_hash()
    }

    pub fn pause_mask(&self) -> u32 {
        self.pauses.iter().map(|&p| p as u32).fold(0, |a, b| a | b)
    }

    /// Microseconds left on the resume countdown (0 when none is running).
    pub fn countdown_us(&self) -> u64 {
        self.resume_at_us
            .map_or(0, |t| t.saturating_sub(self.now_us))
    }

    /// Queues a main-thread message for the next tick boundary (Lifecycle and Ui pauses act at once).
    pub fn handle(&mut self, bytes: &[u8]) -> Result<(), HostError> {
        let msg = MainToSim::decode(bytes).map_err(|e| HostError::Decode(format!("{e:?}")))?;
        match msg {
            MainToSim::Lifecycle { visible, render_ok } => {
                self.set_pause(Pause::HostHidden, !visible);
                self.set_pause(Pause::RendererUnavailable, !render_ok);
            }
            MainToSim::Ui {
                ui: UiCommand::Pause { on },
                ..
            } => self.set_pause(Pause::Manual, on),
            MainToSim::Init { .. } | MainToSim::ReturnBuffer { .. } => {}
            other => self.queued.push(other),
        }
        Ok(())
    }

    /// A test/bot hook (R90 "settable"): applies `bytes` exactly at the boundary before `tick` is stepped.
    pub fn schedule(&mut self, tick: u64, bytes: &[u8]) -> Result<(), HostError> {
        let msg = MainToSim::decode(bytes).map_err(|e| HostError::Decode(format!("{e:?}")))?;
        self.scheduled.entry(tick).or_default().push(msg);
        Ok(())
    }

    /// Stops stepping once the sim reaches `tick` (tests read a hash at an exact tick).
    pub fn stop_at(&mut self, tick: u64) {
        self.stop_at = Some(tick);
    }

    /// A fault (a panic caught by the worker, or a broken invariant): the room can't continue (R84).
    pub fn fault(&mut self) {
        self.set_pause(Pause::Fault, true);
    }

    fn set_pause(&mut self, why: Pause, on: bool) {
        let was = !self.pauses.is_empty();
        if on {
            if self.pauses.insert(why) && !was {
                // Entering a pause: every source reads neutral and nothing pending fires.
                for s in self.inputs.values_mut() {
                    s.state.neutralise(Neutralise::Paused);
                }
                self.resume_at_us = None;
            }
        } else if self.pauses.remove(&why) && self.pauses.is_empty() {
            self.resume_at_us = Some(self.now_us + RESUME_COUNTDOWN_US);
        }
    }

    /// The worker's clock: steps every whole tick due by `now_us` (monotonic µs). Returns the ticks stepped.
    pub fn advance(&mut self, now_us: u64) -> u32 {
        self.now_us = now_us;
        let last = self.last_us.replace(now_us);
        #[cfg(feature = "testing")]
        if self.test.held {
            // Held by the test surface: only its `step` moves the sim, and no backlog builds up meanwhile.
            self.acc = 0;
            return 0;
        }
        if self.pauses.contains(&Pause::PerformanceStall)
            && self
                .stall_since_us
                .is_some_and(|t| now_us >= t + STALL_HOLD_US)
        {
            self.stall_since_us = None;
            self.set_pause(Pause::PerformanceStall, false);
        }
        if !self.pauses.is_empty() {
            return 0;
        }
        if let Some(at) = self.resume_at_us {
            if now_us < at {
                return 0;
            }
            // The countdown's over: time starts again from here (nothing from the pause is replayed), and input is
            // re-armed at neutral: samples that arrived during the pause are dropped, so only fresh input drives.
            self.resume_at_us = None;
            self.acc = 0;
            self.queued.retain(|m| {
                !matches!(
                    m,
                    MainToSim::LocalSource { .. }
                        | MainToSim::NetBytes {
                            channel: Channel::State,
                            ..
                        }
                )
            });
            for s in self.inputs.values_mut() {
                s.state.neutralise(Neutralise::Paused);
            }
            return 0;
        }
        let Some(last) = last else { return 0 };
        self.acc += u128::from(now_us.saturating_sub(last)) * u128::from(TICK_HZ);
        let backlog_us = (self.acc / u128::from(TICK_HZ)) as u64;
        if backlog_us > STALL_US {
            // Persistently behind: stall at the last completed tick rather than skipping ticks or growing dt.
            self.acc = 0;
            self.stall_since_us = Some(now_us);
            self.set_pause(Pause::PerformanceStall, true);
            return 0;
        }
        let mut stepped = 0;
        while self.acc >= 1_000_000 {
            if self.stop_at.is_some_and(|t| self.sim.tick() >= t) {
                self.acc = 0;
                break;
            }
            self.acc -= 1_000_000;
            self.step_one();
            stepped += 1;
        }
        stepped
    }

    /// One tick, in the contract's order.
    /// The controllers' light HUD (P1-C02): every `HUD_EVERY_TICKS` ticks each seated controller gets its car's boost
    /// meter and the pause state on its `state` channel (unreliable: a lost one is replaced by the next).
    fn send_huds(&mut self, tick: u64) {
        let pause = if self.pauses.contains(&Pause::Manual) {
            Some(PauseReason::Host)
        } else if self.pauses.contains(&Pause::HostHidden) {
            Some(PauseReason::HostHidden)
        } else if self.pauses.contains(&Pause::RendererUnavailable) {
            Some(PauseReason::RenderLost)
        } else if self.pauses.contains(&Pause::Fault) {
            Some(PauseReason::Fault)
        } else {
            None
        };
        let mut out = Vec::new();
        for seat in self.seats.seats() {
            let Some(endpoint) = seat.conn.and_then(|c| self.endpoint_of(c)) else {
                continue;
            };
            if endpoint.0.starts_with("local:") {
                continue;
            }
            let boost = self
                .inputs
                .get(&seat.id)
                .and_then(|i| i.car)
                .and_then(|car| self.sim.action_state(car))
                .map_or(0, |a| (a.boost.clamp(0.0, 1.0) * 255.0).round() as u8);
            let hud = Hud {
                position: None,
                lap: None,
                boost,
                connection: None,
                pause,
                tick: Tick(tick),
            };
            out.push(SimToMain::Outbound {
                endpoint,
                channel: Channel::State,
                bytes: HudUpdate {
                    minor: jj_protocol::state::STATE_MINOR,
                    hud,
                }
                .encode(),
            });
        }
        self.out.extend(out);
    }

    pub fn step_one(&mut self) {
        let tick = self.sim.tick();
        if tick % HUD_EVERY_TICKS == 0 {
            self.send_huds(tick);
        }
        for msg in self.scheduled.remove(&tick).unwrap_or_default() {
            self.apply(msg, tick);
        }
        for msg in std::mem::take(&mut self.queued) {
            self.apply(msg, tick);
        }
        for o in self.seats.apply(seats::Input::Tick(Tick(tick + 1))) {
            self.seat_output(o);
        }
        // A loaded fixture's events and scripted inputs come before the seats' controls, as in `jj sim`.
        #[cfg(feature = "testing")]
        if let Some(h) = &mut self.test.harness {
            h.before_step(&mut self.sim);
        }
        let now_ms = tick_ms(tick);
        // Dropout (R45, §9): a source silent or gone for DROPOUT_MS hands its car to the autopilot, and the room never
        // pauses; fresh deliberate input takes it back through the autopilot's handback blend. Source-blind: phones,
        // pads and keys alike (G03 adds idle and menus).
        for input in self.inputs.values_mut() {
            let Some(car) = input.car else { continue };
            let age = input.state.age_ms(now_ms);
            if age.is_some_and(|a| a > DROPOUT_MS) {
                if !input.dropped && !self.sim.has_autopilot(car) {
                    self.sim.set_autopilot(car, true);
                    input.dropped = true;
                }
            } else if input.dropped
                && age.is_some_and(|a| a <= STALE_MS)
                && jj_sim::autopilot::is_deliberate(
                    DriveInput::default(),
                    controls(input.state.semantics()),
                )
            {
                self.sim.set_autopilot(car, false);
                input.dropped = false;
            }
        }
        for input in self.inputs.values() {
            let Some(car) = input.car else { continue };
            let fresh = input
                .state
                .age_ms(now_ms)
                .is_some_and(|age| age <= STALE_MS);
            let controls = if fresh {
                controls(input.state.semantics())
            } else {
                DriveInput::default()
            };
            self.sim.set_input(car, controls);
        }
        self.sim.step();
        #[cfg(feature = "testing")]
        if let Some(h) = &mut self.test.harness {
            h.after_step(&self.sim, false);
        }
        self.collect_race_events();
        self.collect_utility_events();
    }

    fn apply(&mut self, msg: MainToSim, tick: u64) {
        let now_ms = tick_ms(tick);
        match msg {
            MainToSim::NetBytes {
                endpoint,
                channel: Channel::Cmd,
                bytes,
            } => {
                let Ok(cmd) = ControllerCmd::decode(&bytes) else {
                    return;
                };
                self.controller_cmd(endpoint, cmd);
            }
            MainToSim::NetBytes {
                endpoint,
                channel: Channel::State,
                bytes,
            } => {
                let Some(&conn) = self.conns.get(&endpoint) else {
                    return;
                };
                let Ok(StateMessage::Batch(batch)) = StateMessage::decode(&bytes) else {
                    return;
                };
                for r in batch.records {
                    let Some(seat) = self.seats.input_seat(conn, r.source) else {
                        continue;
                    };
                    if let Some(input) = self.inputs.get_mut(&seat) {
                        let flags = SampleFlags {
                            available: r.flags.has(StateFlags::AVAILABLE),
                            drive_touch: r.flags.has(StateFlags::DRIVE_TOUCH),
                            action_touch: r.flags.has(StateFlags::ACTION_TOUCH),
                            menu_open: r.flags.has(StateFlags::MENU_OPEN),
                        };
                        input.state.sample(r.drive, r.action, flags, now_ms);
                    }
                }
            }
            MainToSim::LocalSource {
                source,
                axes,
                buttons,
                ..
            } => {
                let neutral = axes == [0; 4] && buttons & !LOCAL_UNAVAILABLE == 0;
                // After leaving and letting go, the next press is a new player: forget the old connection so the
                // source joins again under its next endpoint generation.
                let lb = self.local_buttons.entry(source).or_default();
                if lb.left && neutral {
                    lb.left_released = true;
                }
                if lb.left && lb.left_released && !neutral {
                    (lb.left, lb.left_released) = (false, false);
                    lb.generation += 1;
                    self.locals.remove(&source);
                }
                let seat = self.local_seat(source);
                let conn = self.locals[&source];
                let lb = self.local_buttons.entry(source).or_default();
                let pressed = |bit: u32| buttons & bit != 0 && lb.last & bit == 0;
                let (leave, identify, sit_out) = (
                    pressed(LOCAL_LEAVE),
                    pressed(LOCAL_IDENTIFY),
                    pressed(LOCAL_SIT_OUT),
                );
                lb.last = buttons;
                if leave {
                    lb.left = true;
                }
                let mut outs = Vec::new();
                if leave {
                    outs.extend(self.seats.apply(seats::Input::Leave { conn }));
                }
                if sit_out && let Some(id) = seat {
                    let sitting = self
                        .seats
                        .seats()
                        .any(|s| s.id == id && s.presence == seats::Presence::SittingOut);
                    outs.extend(
                        self.seats
                            .apply(seats::Input::SitOut { conn, on: !sitting }),
                    );
                }
                if identify {
                    outs.extend(self.seats.apply(seats::Input::Identify { conn }));
                }
                for o in outs {
                    self.seat_output(o);
                }
                // READY (`LOCAL_READY`) is the round director's (G01).
                // Like the wire (`Seats::input_seat`), a sample only counts once the seat has a car.
                if let Some(input) = seat
                    .and_then(|s| self.inputs.get_mut(&s))
                    .filter(|i| i.car.is_some())
                {
                    let flags = SampleFlags {
                        available: buttons & LOCAL_UNAVAILABLE == 0,
                        drive_touch: axes[0] != 0 || axes[1] != 0,
                        action_touch: axes[2] != 0 || axes[3] != 0,
                        menu_open: false,
                    };
                    let fired =
                        input
                            .state
                            .sample([axes[0], axes[1]], [axes[2], axes[3]], flags, now_ms);
                    // A host pad's gestures are detected here (a controller sends its own as `Action`).
                    if let Some(car) = input.car {
                        for a in fired {
                            match a.kind {
                                ActionKind::Wheelie { preload_ms } => {
                                    self.sim.wheelie(car, preload_ms);
                                }
                                ActionKind::UtilityForward => {
                                    self.sim.utility(car, UtilityKind::Forward);
                                }
                                ActionKind::UtilityRear => {
                                    self.sim.utility(car, UtilityKind::Rear);
                                }
                            }
                        }
                    }
                }
            }
            MainToSim::Ui { ui, .. } => match ui {
                UiCommand::StartRound => self.sim.start_race(jj_sim::race::DEFAULT_LAPS),
                UiCommand::Pause { on } => self.set_pause(Pause::Manual, on),
                // The round loop (G01), cameras (R05) and the drawer's Remove (G07) land later.
                _ => {}
            },
            // Map preparation (G01/M08a) and buffers are main-thread plumbing; Init and Lifecycle act on arrival.
            _ => {}
        }
    }

    fn conn_for(&mut self, endpoint: &EndpointId) -> ConnId {
        if let Some(&c) = self.conns.get(endpoint) {
            return c;
        }
        let c = self.next_conn;
        self.next_conn += 1;
        self.conns.insert(endpoint.clone(), c);
        c
    }

    fn controller_cmd(&mut self, endpoint: EndpointId, cmd: ControllerCmd) {
        let mut conn = self.conn_for(&endpoint);
        // Hello is the first message on a connection (plan §5.4): a Hello on an endpoint that already said one is a new
        // connection (a reloaded page, a rebuilt link), so it gets a fresh ConnId; the seat reducer then fences the old
        // one and welcomes the new one back to its seat.
        if matches!(cmd, ControllerCmd::Hello { .. }) && !self.helloed.insert(conn) {
            conn = self.next_conn;
            self.next_conn += 1;
            self.conns.insert(endpoint.clone(), conn);
            self.helloed.insert(conn);
        }
        let outputs = match cmd {
            ControllerCmd::Hello {
                endpoint: claimed,
                resume,
                ..
            } => {
                // The secret is hashed at once and never stored; a first connection without one hashes its endpoint id.
                let secret = resume.unwrap_or_else(|| claimed.0.clone());
                self.seats.apply(seats::Input::Hello {
                    conn,
                    endpoint: claimed,
                    secret_hash: sha(secret.as_bytes()),
                })
            }
            ControllerCmd::Claim { request, name } => self.seats.apply(seats::Input::Claim {
                conn,
                request,
                name,
            }),
            ControllerCmd::Leave => self.seats.apply(seats::Input::Leave { conn }),
            ControllerCmd::SitOut => self.seats.apply(seats::Input::SitOut { conn, on: true }),
            ControllerCmd::Identify => self.seats.apply(seats::Input::Identify { conn }),
            ControllerCmd::SetCamera { camera } => {
                if let Some(seat) = self.seats.seat_of(conn)
                    && let Some(car) = self.inputs.get(&seat).and_then(|i| i.car)
                {
                    self.events.push(SimEvent::CameraSet {
                        seat,
                        car: car.0,
                        camera,
                    });
                }
                vec![]
            }
            ControllerCmd::Recover => {
                if let Some(car) = self
                    .seats
                    .seat_of(conn)
                    .and_then(|s| self.inputs.get(&s))
                    .and_then(|i| i.car)
                {
                    self.sim.recover(car);
                }
                vec![]
            }
            // The wheelie (P1-S03c) and the ACTION utilities (P1-S08): the controller validated the gesture; each is
            // applied once per action id (a resent action does nothing).
            ControllerCmd::Action {
                action,
                source,
                kind,
                ..
            } => {
                if let Some(input) = self
                    .seats
                    .input_seat(conn, source)
                    .and_then(|s| self.inputs.get_mut(&s))
                    && !input.seen_actions.contains(&action)
                {
                    if input.seen_actions.len() == SEEN_ACTIONS {
                        input.seen_actions.remove(0);
                    }
                    input.seen_actions.push(action);
                    if let Some(car) = input.car {
                        match kind {
                            ActionKind::Wheelie { preload_ms } => {
                                self.sim.wheelie(car, preload_ms);
                            }
                            ActionKind::UtilityForward => {
                                self.sim.utility(car, UtilityKind::Forward);
                            }
                            ActionKind::UtilityRear => {
                                self.sim.utility(car, UtilityKind::Rear);
                            }
                        }
                    }
                }
                vec![]
            }
            // Other actions, Ready, names, cameras, menus and pings are wired by their beads (S08, G01, R05, C-beads).
            _ => vec![],
        };
        for o in outputs {
            self.seat_output(o);
        }
    }

    /// A host pad or keyboard player's seat, claimed through the seat reducer on its first sample.
    fn local_seat(&mut self, source: LocalSourceId) -> Option<SeatId> {
        let conn = match self.locals.get(&source) {
            Some(&c) => c,
            None => {
                let c = self.next_conn;
                self.next_conn += 1;
                self.locals.insert(source, c);
                let generation = self.local_buttons.get(&source).map_or(0, |b| b.generation);
                let endpoint = EndpointId(match generation {
                    0 => format!("local:{}", source.0),
                    g => format!("local:{}#{}", source.0, g + 1),
                });
                let mut outs = self.seats.apply(seats::Input::Hello {
                    conn: c,
                    endpoint: endpoint.clone(),
                    secret_hash: sha(endpoint.0.as_bytes()),
                });
                outs.extend(self.seats.apply(seats::Input::Claim {
                    conn: c,
                    request: jj_types::RequestId(1),
                    name: String::new(),
                }));
                for o in outs {
                    self.seat_output(o);
                }
                c
            }
        };
        self.seats.seat_of(conn)
    }

    fn seat_output(&mut self, o: seats::Output) {
        match o {
            seats::Output::Welcome {
                conn,
                seat,
                number,
                colour,
                source,
            } => {
                let origin = self
                    .locals
                    .iter()
                    .find(|(_, c)| **c == conn)
                    .map_or(Origin::Net(conn), |(&l, _)| Origin::Local(l));
                self.inputs.entry(seat).or_insert_with(|| SeatInput {
                    state: SourceState::new(source),
                    car: None,
                    seen_actions: Vec::new(),
                    dropped: false,
                });
                if let Origin::Net(_) = origin
                    && let Some(endpoint) = self.endpoint_of(conn)
                {
                    let bytes = HostCmd::Welcome {
                        seat,
                        number,
                        colour,
                        source,
                    }
                    .encode();
                    self.out.push(SimToMain::Outbound {
                        endpoint,
                        channel: Channel::Cmd,
                        bytes,
                    });
                }
                self.events.push(SimEvent::SeatJoined { seat, number });
                self.session_rev += 1;
            }
            seats::Output::CarAdded { seat } => {
                // Through the placement service: the next grid slot before the race, a drop-in once it's running.
                let car = if self.sim.race().started_at.is_some() {
                    self.sim.drop_in()
                } else {
                    self.sim.spawn_grid(1)[0]
                };
                if let Some(input) = self.inputs.get_mut(&seat) {
                    input.car = Some(car);
                }
                self.session_rev += 1;
            }
            seats::Output::CarWithdrawn { seat, .. } => {
                // The car stays where it is as debris-free scenery until S04c's withdrawal rules; it just stops driving.
                if let Some(input) = self.inputs.get_mut(&seat)
                    && let Some(car) = input.car.take()
                {
                    self.sim.set_input(car, DriveInput::default());
                }
                self.events.push(SimEvent::SeatLeft { seat });
                self.session_rev += 1;
            }
            seats::Output::Identify { seat } => {
                self.events.push(SimEvent::Identify { seat });
            }
            seats::Output::ClaimRejected { conn, reason } => {
                if let Some(endpoint) = self.endpoint_of(conn) {
                    let bytes = HostCmd::ClaimRejected { reason }.encode();
                    self.out.push(SimToMain::Outbound {
                        endpoint,
                        channel: Channel::Cmd,
                        bytes,
                    });
                }
            }
            _ => {}
        }
    }

    fn endpoint_of(&self, conn: ConnId) -> Option<EndpointId> {
        self.conns
            .iter()
            .find(|(_, c)| **c == conn)
            .map(|(e, _)| e.clone())
    }

    fn seat_of_car(&self, car: u32) -> Option<SeatId> {
        self.inputs
            .iter()
            .find(|(_, i)| i.car == Some(CarId(car)))
            .map(|(s, _)| *s)
    }

    /// The sim's accepted ACTION utilities since the last step, as seat events for the host's cues (P1-S08).
    fn collect_utility_events(&mut self) {
        let fired = self.sim.utility_events().to_vec();
        for (_, e) in &fired[self.seen_utility_events..] {
            match *e {
                UtilityEvent::Oi { car } => {
                    if let Some(seat) = self.seat_of_car(car) {
                        self.events.push(SimEvent::Oi { seat });
                    }
                }
                UtilityEvent::Cone { car, prop } => {
                    if let Some(seat) = self.seat_of_car(car) {
                        self.events
                            .push(SimEvent::ConeDropped { seat, debris: prop });
                    }
                }
            }
        }
        self.seen_utility_events = fired.len();
    }

    fn collect_race_events(&mut self) {
        let race = self.sim.race().events().to_vec();
        for (_, e) in &race[self.seen_race_events..] {
            match *e {
                Event::LapCompleted { car, laps } => {
                    if let Some(seat) = self.seat_of_car(car) {
                        self.events.push(SimEvent::Lap {
                            seat,
                            lap: laps as u16,
                        });
                    }
                }
                Event::Finished { car } => {
                    if let Some(seat) = self.seat_of_car(car) {
                        let place = self
                            .sim
                            .race()
                            .standings()
                            .iter()
                            .position(|r| r.car == car)
                            .map_or(0, |p| p as u32 + 1);
                        let start = self.sim.race().started_at.unwrap_or(0);
                        let time_ms = tick_ms(self.sim.tick() - start) as u32;
                        self.events.push(SimEvent::Finished {
                            seat,
                            place,
                            time_ms,
                        });
                    }
                }
                Event::Respawned {
                    car,
                    why: jj_sim::race::Respawned::OutOfBounds | jj_sim::race::Respawned::FlipWreck,
                } => {
                    if let Some(seat) = self.seat_of_car(car) {
                        self.events.push(SimEvent::Wrecked { seat });
                    }
                }
                _ => {}
            }
        }
        self.seen_race_events = race.len();
    }

    /// The next message for main, in order: queued events first (one ordered batch), then outbound controller bytes.
    pub fn next_message(&mut self) -> Option<SimToMain> {
        if !self.events.is_empty() {
            return Some(SimToMain::Events {
                batch: std::mem::take(&mut self.events),
            });
        }
        if self.out.is_empty() {
            None
        } else {
            Some(self.out.remove(0))
        }
    }

    /// Bytes a snapshot needs now.
    pub fn snapshot_size(&self) -> usize {
        SNAPSHOT_HEADER
            + SNAPSHOT_CAR * self.sim.cars().count()
            + SNAPSHOT_DEBRIS * self.sim.debris_poses().len()
    }

    /// Writes the snapshot into `buf` (a pooled buffer). Returns the bytes written, or 0 if it doesn't fit.
    ///
    /// Header: magic u32, version u16, flags u16, tick u64, session_rev u32, pause mask u32, countdown ms u32, cars u32,
    /// debris u32, parts u32 (the part records after the debris, P1-R02's layout in web/host/src/render/snapshot.ts;
    /// written 0 until the sim reports loose and detached parts: every part intact). Car (64 B): car u32, life u32, position 3×f32, rotation 4×f32, linvel 3×f32, steer f32,
    /// flags u32 (1 protected, 2 finished, 4 autopilot, 8 held, 16 boosting, 32 drifting), boost meter f32 (0..1),
    /// reserved u32. Debris (32 B): position 3×f32, rotation 4×f32, kind u32 (0 debris, 1 a dropped cone; P1-S08).
    pub fn write_snapshot(&self, buf: &mut [u8]) -> usize {
        let need = self.snapshot_size();
        if buf.len() < need {
            return 0;
        }
        let mut w = Writer { buf, at: 0 };
        let cars: Vec<CarId> = self.sim.cars().collect();
        let debris = self.sim.debris_poses();
        w.u32(SNAPSHOT_MAGIC);
        w.u16(1);
        w.u16(0);
        w.u64(self.sim.tick());
        w.u32(self.session_rev);
        w.u32(self.pause_mask());
        w.u32((self.countdown_us() / 1000) as u32);
        w.u32(cars.len() as u32);
        w.u32(debris.len() as u32);
        w.u32(0); // parts
        let race = self.sim.race();
        for car in cars {
            let s = self.sim.car_state(car).expect("listed car");
            let steer = self
                .sim
                .applied_input(car)
                .map_or(0.0, |i| jj_types::axis::dequantise_axis(i.steer));
            let action = self.sim.action_state(car).unwrap_or_default();
            let flags = u32::from(self.sim.is_protected(car))
                | (u32::from(race.is_finished(car.0)) << 1)
                | (u32::from(self.sim.has_autopilot(car)) << 2)
                | (u32::from(race.is_held(car.0, self.sim.tick())) << 3)
                | (u32::from(action.boosting) << 4)
                | (u32::from(action.drift > 0.0) << 5);
            w.u32(car.0);
            w.u32(self.sim.car_life(car).unwrap_or(0));
            s.position
                .iter()
                .chain(&s.rotation)
                .chain(&s.linvel)
                .for_each(|&v| w.f32(v));
            w.f32(steer);
            w.u32(flags);
            w.f32(action.boost);
            w.u32(0);
        }
        for ((p, r), k) in debris.into_iter().zip(self.sim.prop_kinds()) {
            p.iter().chain(&r).for_each(|&v| w.f32(v));
            w.u32(k.code());
        }
        w.at
    }
}

struct Writer<'a> {
    buf: &'a mut [u8],
    at: usize,
}

impl Writer<'_> {
    fn put(&mut self, b: &[u8]) {
        self.buf[self.at..self.at + b.len()].copy_from_slice(b);
        self.at += b.len();
    }
    fn u16(&mut self, v: u16) {
        self.put(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.put(&v.to_le_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.put(&v.to_le_bytes());
    }
    fn f32(&mut self, v: f32) {
        self.put(&v.to_le_bytes());
    }
}

#[cfg(feature = "testing")]
pub mod testing;

#[cfg(test)]
mod tests;
