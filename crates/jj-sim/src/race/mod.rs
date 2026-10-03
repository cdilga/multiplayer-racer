//! Race rules and recovery (P1-S05, plan §7.4–§7.5): legal progress through gates in order, recovery anchors, flip
//! assist, Recover, out of bounds, laps, the finish window and the absolute deadline.
//!
//! Pure logic over what each car looks like after a tick ([`CarView`]); [`crate::Sim`] owns the physics and applies the
//! [`Effect`]s (respawn at an anchor, ghost a finished car, push the flip-assist torque). Every number here is
//! plan-given or TUNE; nothing caps cars (R36).
//!
//! - **Gates in order.** The route's gates, starting at the finish line, must be crossed in order (forward through the
//!   gate's line, within the road's half-width plus [`GATE_MARGIN_M`]). Only the next expected gate counts, so a
//!   shortcut across the infield earns nothing. Teleports (placements, respawns) never cross a gate.
//! - **Legal progress** is the route distance at the last gate passed, plus how far along the route the car is towards
//!   the next one. That second term comes from projecting only onto the route between those two gates, never the
//!   nearest point of the whole spline, which a crossing or shortcut would fool.
//! - **The anchor** is the last gate passed, on the centerline facing along the route (the spawn pose before any gate).
//!   Respawns land there. Making it a clear pose against other cars is the placement service's job (S06).
//! - **Flip assist.** Up·Y < 0.2 and speed < 2 m/s for 1 s starts a self-righting torque. If the car isn't righted
//!   3 s later (4 s after coming to rest inverted), it's wrecked. Until S04c's husks land, a wreck respawns at the anchor
//!   like Recover.
//! - **Recover** is allowed after 1 s under 3 m/s, or when inverted. It respawns at the anchor and holds the car for the
//!   2 s penalty.
//! - **Out of bounds.** Below the kill height or outside the map bounds is a wreck, then a respawn. It always recovers.
//! - **Race end.** `laps` (default 3). The first finisher opens a 30 s window, and the absolute deadline is
//!   `max(180 s, 2 × laps × refLap)` after the start (countdown completion). Finished cars are ghosted against racers and
//!   debris, and unfinished cars rank by legal progress.
//!
//! Maths goes through `libm` (not the platform's), so native and WASM decide every crossing identically.

use jj_map::LoadedMap;
use serde::Serialize;

use crate::journal::SpawnPose;
use crate::placement::{
    DROP_IN_BEHIND_TICKS, DROP_IN_MIN_GAP_M, HISTORY_EVERY_TICKS, HISTORY_KEEP_TICKS,
    ProgressSample,
};
use crate::sim::{TICK_HZ, route_spawn};

const SECOND: u64 = TICK_HZ as u64;
pub const DEFAULT_LAPS: u32 = 3;
/// Inverted: the car's up axis has y below this.
pub const FLIP_UP_Y: f32 = 0.2;
/// Righted again: up·Y at least this.
pub const RIGHTED_UP_Y: f32 = 0.9;
pub const FLIP_REST_SPEED: f32 = 2.0;
pub const FLIP_REST_TICKS: u64 = SECOND;
pub const FLIP_ASSIST_TICKS: u64 = 3 * SECOND;
pub const RECOVER_SPEED: f32 = 3.0;
pub const RECOVER_SLOW_TICKS: u64 = SECOND;
/// Recover's 2 s penalty, and the wreck respawn until S04c.
pub const RESPAWN_HOLD_TICKS: u64 = 2 * SECOND;
pub const FINISH_WINDOW_TICKS: u64 = 30 * SECOND;
pub const DEADLINE_MIN_TICKS: u64 = 180 * SECOND;
/// Lateral slack beyond the road's half-width for a gate crossing.
pub const GATE_MARGIN_M: f32 = 2.0;
pub const RESPAWN_LIFT_M: f32 = crate::placement::SPAWN_LIFT_M;
/// Flip-assist PD gains about the axis that turns the car's up towards world up (TUNE, S03).
pub const ASSIST_K: f32 = 9_000.0;
pub const ASSIST_D: f32 = 3_000.0;
pub const ASSIST_MAX: f32 = 30_000.0;

#[derive(Clone, Debug)]
struct Gate {
    at: usize,
    x: f32,
    z: f32,
    /// Unit route tangent (x, z) at the gate.
    tx: f32,
    tz: f32,
    half_width: f32,
    /// Route distance from the finish line.
    from_finish: f32,
    anchor: SpawnPose,
}

/// The map's route as the race sees it: gates in race order (the finish first), arc lengths and bounds.
#[derive(Clone, Debug)]
pub struct Course {
    pts: Vec<(f32, f32)>,
    s: Vec<f32>,
    total: f32,
    gates: Vec<Gate>,
    bounds: [f32; 4],
    kill_y: f32,
    ref_lap_ticks: u64,
}

impl Course {
    pub fn new(map: &LoadedMap) -> Self {
        let m = &map.map;
        let pts: Vec<(f32, f32)> = m
            .route
            .points
            .iter()
            .map(|p| (p.x as f32 / 1000.0, p.z as f32 / 1000.0))
            .collect();
        let n = pts.len();
        let mut s = Vec::with_capacity(n);
        let mut total = 0.0;
        for i in 0..n {
            s.push(total);
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            total += libm::hypotf(b.0 - a.0, b.1 - a.1);
        }
        let mut sorted: Vec<&jj_map::Gate> = m.route.gates.iter().collect();
        sorted.sort_by_key(|g| g.at);
        let finish = sorted.iter().position(|g| g.finish).unwrap_or(0);
        sorted.rotate_left(finish);
        let finish_s = sorted.first().map_or(0.0, |g| s[g.at as usize % n]);
        let gates = sorted
            .iter()
            .map(|g| {
                let at = g.at as usize % n;
                let (prev, next) = (pts[(at + n - 1) % n], pts[(at + 1) % n]);
                let (dx, dz) = (next.0 - prev.0, next.1 - prev.1);
                let len = libm::hypotf(dx, dz).max(1e-6);
                Gate {
                    at,
                    x: pts[at].0,
                    z: pts[at].1,
                    tx: dx / len,
                    tz: dz / len,
                    half_width: m.route.points[at].width as f32 / 2000.0,
                    from_finish: (s[at] - finish_s).rem_euclid(total),
                    anchor: route_spawn(map, at, 0.0, RESPAWN_LIFT_M),
                }
            })
            .collect();
        let b = &m.header.bounds;
        Self {
            pts,
            s,
            total,
            gates,
            bounds: [
                b.min_x as f32 / 1000.0,
                b.min_z as f32 / 1000.0,
                b.max_x as f32 / 1000.0,
                b.max_z as f32 / 1000.0,
            ],
            kill_y: b.kill_y as f32 / 1000.0,
            ref_lap_ticks: u64::from(m.header.ref_lap_ms) * SECOND / 1000,
        }
    }

    pub fn gate_count(&self) -> usize {
        self.gates.len()
    }

    pub fn length_m(&self) -> f32 {
        self.total
    }

    /// The route point of gate `i` in race order (0 = the finish line).
    pub fn gate_route_point(&self, i: usize) -> usize {
        self.gates[i].at
    }

    /// Where a respawn at gate `i` lands.
    pub fn anchor(&self, i: usize) -> SpawnPose {
        self.gates[i].anchor
    }

    pub fn out_of_bounds(&self, p: [f32; 3]) -> bool {
        let [x0, z0, x1, z1] = self.bounds;
        p[1] < self.kill_y || p[0] < x0 || p[0] > x1 || p[2] < z0 || p[2] > z1
    }

    /// Distance along the route from gate `from`'s route point, projecting only onto the route between gates `from`
    /// and `to` and clamped to that stretch.
    fn window_progress(&self, from: usize, to: usize, x: f32, z: f32) -> f32 {
        let n = self.pts.len();
        let (a_at, b_at) = (self.gates[from].at, self.gates[to].at);
        let span = (self.s[b_at] - self.s[a_at]).rem_euclid(self.total);
        let span = if span == 0.0 { self.total } else { span };
        let (mut best, mut along) = (f32::INFINITY, 0.0);
        let mut i = a_at;
        loop {
            let (p, q) = (self.pts[i], self.pts[(i + 1) % n]);
            let (dx, dz) = (q.0 - p.0, q.1 - p.1);
            let len2 = dx * dx + dz * dz;
            let t = if len2 > 0.0 {
                (((x - p.0) * dx + (z - p.1) * dz) / len2).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let d = libm::hypotf(x - (p.0 + t * dx), z - (p.1 + t * dz));
            if d < best {
                best = d;
                along = (self.s[i] - self.s[a_at]).rem_euclid(self.total) + t * len2.sqrt();
            }
            i = (i + 1) % n;
            if i == b_at {
                break;
            }
        }
        along.clamp(0.0, span)
    }
}

/// What the race needs from a car after a tick.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CarView {
    pub position: [f32; 3],
    pub up_y: f32,
    pub speed: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Respawned {
    Recover,
    OutOfBounds,
    FlipWreck,
}

/// What the sim must do after a race update or command.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Effect {
    Respawn {
        car: u32,
        pose: SpawnPose,
        why: Respawned,
    },
    Ghost {
        car: u32,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RaceEnd {
    AllFinished,
    Window,
    Deadline,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Event {
    GatePassed {
        car: u32,
        gate: u32,
        gates_passed: u32,
    },
    LapCompleted {
        car: u32,
        laps: u32,
    },
    Finished {
        car: u32,
    },
    AssistStarted {
        car: u32,
    },
    Righted {
        car: u32,
    },
    Respawned {
        car: u32,
        why: Respawned,
    },
    RaceOver {
        why: RaceEnd,
    },
}

/// One car's race state.
#[derive(Clone, Debug, PartialEq)]
pub struct CarRace {
    pub gates_passed: u32,
    /// Index (race order) of the last gate passed: the anchor.
    pub last_gate: Option<usize>,
    pub anchor: SpawnPose,
    pub finished_at: Option<u64>,
    pub hold_until: u64,
    pub assist_since: Option<u64>,
    pub wrecks: u32,
    pub recoveries: u32,
    /// How far through the finishing tick's step the line was crossed, 0..=65535 (results order same-tick finishes by it).
    pub finish_fraction: u16,
    /// The legal-progress high-water mark (mm) and the tick it was reached: what unfinished entrants rank by.
    pub best_progress_mm: u64,
    pub best_progress_tick: u64,
    /// Joined mid-round through drop-in (P1-S06).
    pub late: bool,
    /// Recent legal progress, for placing a drop-in behind this car.
    history: Vec<ProgressSample>,
    rest_inverted: u64,
    slow: u64,
    last: Option<CarView>,
}

/// A row of the standings: finished cars by finish tick, then the rest by legal progress.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Standing {
    pub car: u32,
    pub finished_at: Option<u64>,
    pub laps: u32,
    pub gates_passed: u32,
    pub progress_m: f32,
}

#[derive(Clone, Debug)]
pub struct Race {
    pub course: Course,
    pub laps: u32,
    pub started_at: Option<u64>,
    pub first_finish: Option<u64>,
    pub over: Option<(u64, RaceEnd)>,
    cars: Vec<CarRace>,
    events: Vec<(u64, Event)>,
}

impl Race {
    pub fn new(course: Course) -> Self {
        Self {
            course,
            laps: DEFAULT_LAPS,
            started_at: None,
            first_finish: None,
            over: None,
            cars: Vec::new(),
            events: Vec::new(),
        }
    }

    pub fn add_car(&mut self, spawn: SpawnPose) {
        self.cars.push(CarRace {
            gates_passed: 0,
            last_gate: None,
            anchor: spawn,
            finished_at: None,
            hold_until: 0,
            assist_since: None,
            wrecks: 0,
            recoveries: 0,
            finish_fraction: 0,
            best_progress_mm: 0,
            best_progress_tick: 0,
            late: false,
            history: Vec::new(),
            rest_inverted: 0,
            slow: 0,
            last: None,
        });
    }

    /// A drop-in (P1-S06): a car joining at legal progress `progress_m` with the gate state there, marked late.
    pub fn add_late_car(&mut self, spawn: SpawnPose, progress_m: f32, tick: u64) {
        self.add_car(spawn);
        let gates = self.gates_for_progress(progress_m);
        let n = self.course.gates.len();
        let c = self.cars.last_mut().expect("just added");
        c.late = true;
        c.gates_passed = gates;
        c.best_progress_mm = (progress_m.max(0.0) * 1000.0) as u64;
        c.best_progress_tick = tick;
        if gates > 0 && n > 0 {
            let g = (gates as usize - 1) % n;
            c.last_gate = Some(g);
            c.anchor = self.course.anchor(g);
        }
    }

    /// How many in-order gate crossings a car at legal progress `p` (m) has made: the start line counts at 0 m.
    pub fn gates_for_progress(&self, p: f32) -> u32 {
        let n = self.course.gates.len();
        if n == 0 || p < 0.0 {
            return 0;
        }
        let mut k = 0u32;
        loop {
            let i = k as usize;
            let d = (i / n) as f32 * self.course.total + self.course.gates[i % n].from_finish;
            if d > p {
                return k;
            }
            k += 1;
        }
    }

    /// The route arc length of the finish line.
    pub fn finish_s(&self) -> f32 {
        self.course
            .gates
            .first()
            .map_or(0.0, |g| self.course.s[g.at])
    }

    /// The last still-racing car: the lowest legal progress among unfinished cars (then the lowest id).
    pub fn last_racer(&self) -> Option<u32> {
        self.started_at?;
        (0..self.cars.len() as u32)
            .filter(|&c| self.cars[c as usize].finished_at.is_none())
            .min_by(|&a, &b| {
                self.progress_m(a)
                    .total_cmp(&self.progress_m(b))
                    .then(a.cmp(&b))
            })
    }

    /// Where a drop-in goes (legal progress, m): where the last racer was 3 s ago, and at least
    /// [`DROP_IN_MIN_GAP_M`] behind where it is now. `None` before the race has that much history (use the grid).
    pub fn drop_in_progress(&self, tick: u64) -> Option<f32> {
        let last = self.last_racer()?;
        let then = tick.checked_sub(DROP_IN_BEHIND_TICKS)?;
        let sample = self.cars[last as usize]
            .history
            .iter()
            .rev()
            .find(|s| s.tick <= then)?;
        let p = sample
            .progress_m
            .min(self.progress_m(last) - DROP_IN_MIN_GAP_M);
        (p >= 0.0).then_some(p)
    }

    pub fn car(&self, car: u32) -> Option<&CarRace> {
        self.cars.get(car as usize)
    }

    /// Everything that happened, with the tick it happened at.
    pub fn events(&self) -> &[(u64, Event)] {
        &self.events
    }

    /// The race starts (countdown completion): progress counts from now.
    pub fn start(&mut self, tick: u64, laps: u32) {
        self.started_at = Some(tick);
        self.laps = laps.max(1);
    }

    /// The absolute deadline: `max(180 s, 2 × laps × refLap)` after the start.
    pub fn deadline(&self) -> Option<u64> {
        let lap = 2 * u64::from(self.laps) * self.course.ref_lap_ticks;
        self.started_at.map(|s| s + DEADLINE_MIN_TICKS.max(lap))
    }

    pub fn is_held(&self, car: u32, tick: u64) -> bool {
        self.cars
            .get(car as usize)
            .is_some_and(|c| tick < c.hold_until)
    }

    pub fn is_assisting(&self, car: u32) -> bool {
        self.cars
            .get(car as usize)
            .is_some_and(|c| c.assist_since.is_some())
    }

    pub fn is_finished(&self, car: u32) -> bool {
        self.cars
            .get(car as usize)
            .is_some_and(|c| c.finished_at.is_some())
    }

    /// A placement (setup or respawn) moved the car: the jump never crosses a gate.
    pub fn placed(&mut self, car: u32) {
        if let Some(c) = self.cars.get_mut(car as usize) {
            c.last = None;
        }
    }

    fn respawn(&mut self, tick: u64, car: u32, why: Respawned) -> Effect {
        let c = &mut self.cars[car as usize];
        c.hold_until = tick + RESPAWN_HOLD_TICKS;
        c.assist_since = None;
        c.rest_inverted = 0;
        c.slow = 0;
        c.last = None;
        match why {
            Respawned::Recover => c.recoveries += 1,
            Respawned::OutOfBounds | Respawned::FlipWreck => c.wrecks += 1,
        }
        self.events.push((tick, Event::Respawned { car, why }));
        Effect::Respawn {
            car,
            pose: c.anchor,
            why,
        }
    }

    /// The Recover button: allowed after 1 s under 3 m/s, or when inverted, and not during a hold.
    pub fn recover(&mut self, tick: u64, car: u32) -> Option<Effect> {
        let c = self.cars.get(car as usize)?;
        let inverted = c.last.is_some_and(|v| v.up_y < FLIP_UP_Y);
        if tick < c.hold_until || !(c.slow >= RECOVER_SLOW_TICKS || inverted) {
            return None;
        }
        Some(self.respawn(tick, car, Respawned::Recover))
    }

    /// After the step to `tick`: recovery, gates, laps, finish and the race end. Returns what the sim must apply.
    pub fn update(&mut self, tick: u64, views: &[CarView]) -> Vec<Effect> {
        let mut effects = Vec::new();
        for (i, &v) in views.iter().enumerate().take(self.cars.len()) {
            let car = i as u32;
            if tick < self.cars[i].hold_until {
                self.cars[i].last = Some(v);
                continue;
            }
            if self.course.out_of_bounds(v.position) {
                effects.push(self.respawn(tick, car, Respawned::OutOfBounds));
                continue;
            }
            // Flip assist: 1 s at rest inverted starts it; righted ends it; 3 s later still not righted is a wreck.
            let c = &mut self.cars[i];
            if let Some(since) = c.assist_since {
                if v.up_y >= RIGHTED_UP_Y {
                    c.assist_since = None;
                    c.rest_inverted = 0;
                    self.events.push((tick, Event::Righted { car }));
                } else if tick - since >= FLIP_ASSIST_TICKS {
                    effects.push(self.respawn(tick, car, Respawned::FlipWreck));
                    continue;
                }
            } else if v.up_y < FLIP_UP_Y && v.speed < FLIP_REST_SPEED {
                c.rest_inverted += 1;
                if c.rest_inverted >= FLIP_REST_TICKS {
                    c.assist_since = Some(tick);
                    self.events.push((tick, Event::AssistStarted { car }));
                }
            } else {
                c.rest_inverted = 0;
            }
            let c = &mut self.cars[i];
            c.slow = if v.speed < RECOVER_SPEED {
                c.slow + 1
            } else {
                0
            };
            if self.started_at.is_some()
                && c.finished_at.is_none()
                && let Some(prev) = c.last
            {
                self.cross(tick, car, prev, v, &mut effects);
            }
            self.cars[i].last = Some(v);
            if self.started_at.is_some() && self.cars[i].finished_at.is_none() {
                let mm = (self.progress_m(car) * 1000.0) as u64;
                let c = &mut self.cars[i];
                if mm > c.best_progress_mm {
                    c.best_progress_mm = mm;
                    c.best_progress_tick = tick;
                }
                if tick.is_multiple_of(HISTORY_EVERY_TICKS) {
                    let progress_m = self.progress_m(car);
                    let c = &mut self.cars[i];
                    c.history.push(ProgressSample { tick, progress_m });
                    let keep_from = tick.saturating_sub(HISTORY_KEEP_TICKS);
                    let old = c.history.iter().take_while(|s| s.tick < keep_from).count();
                    c.history.drain(..old);
                }
            }
        }
        self.check_end(tick);
        effects
    }

    fn cross(
        &mut self,
        tick: u64,
        car: u32,
        prev: CarView,
        now: CarView,
        effects: &mut Vec<Effect>,
    ) {
        let n = self.course.gates.len() as u32;
        if n == 0 {
            return;
        }
        let c = &self.cars[car as usize];
        let gi = (c.gates_passed % n) as usize;
        let g = &self.course.gates[gi];
        let f = |p: [f32; 3]| (p[0] - g.x) * g.tx + (p[2] - g.z) * g.tz;
        let lateral = ((now.position[0] - g.x) * -g.tz + (now.position[2] - g.z) * g.tx).abs();
        let (before, after) = (f(prev.position), f(now.position));
        if !(before < 0.0 && after >= 0.0 && lateral <= g.half_width + GATE_MARGIN_M) {
            return;
        }
        // Where in this tick's step the line was crossed, linearly between the two positions.
        let fraction = ((-before / (after - before)).clamp(0.0, 1.0) * 65535.0) as u16;
        let anchor = g.anchor;
        let c = &mut self.cars[car as usize];
        c.gates_passed += 1;
        c.last_gate = Some(gi);
        c.anchor = anchor;
        let passed = c.gates_passed;
        self.events.push((
            tick,
            Event::GatePassed {
                car,
                gate: gi as u32,
                gates_passed: passed,
            },
        ));
        // The first crossing of the finish line is the start; each later one completes a lap.
        if gi == 0 && passed > 1 {
            let laps = (passed - 1) / n;
            self.events.push((tick, Event::LapCompleted { car, laps }));
            if laps >= self.laps {
                let c = &mut self.cars[car as usize];
                c.finished_at = Some(tick);
                c.finish_fraction = fraction;
                self.first_finish.get_or_insert(tick);
                self.events.push((tick, Event::Finished { car }));
                effects.push(Effect::Ghost { car });
            }
        }
    }

    fn check_end(&mut self, tick: u64) {
        if self.over.is_some() {
            return;
        }
        let Some(deadline) = self.deadline() else {
            return;
        };
        let why = if !self.cars.is_empty() && self.cars.iter().all(|c| c.finished_at.is_some()) {
            Some(RaceEnd::AllFinished)
        } else if self
            .first_finish
            .is_some_and(|f| tick >= f + FINISH_WINDOW_TICKS)
        {
            Some(RaceEnd::Window)
        } else if tick >= deadline {
            Some(RaceEnd::Deadline)
        } else {
            None
        };
        if let Some(why) = why {
            self.over = Some((tick, why));
            self.events.push((tick, Event::RaceOver { why }));
        }
    }

    /// Laps completed.
    pub fn laps_completed(&self, car: u32) -> u32 {
        let n = self.course.gates.len() as u32;
        self.cars.get(car as usize).map_or(0, |c| {
            c.gates_passed.saturating_sub(1).checked_div(n).unwrap_or(0)
        })
    }

    /// Legal progress in metres: the route distance at the last gate passed plus the windowed progress towards the next.
    pub fn progress_m(&self, car: u32) -> f32 {
        let n = self.course.gates.len();
        let Some(c) = self.cars.get(car as usize) else {
            return 0.0;
        };
        if c.gates_passed == 0 || n == 0 {
            return 0.0;
        }
        let k = c.gates_passed as usize;
        let (g, next) = ((k - 1) % n, k % n);
        let base = ((k - 1) / n) as f32 * self.course.total + self.course.gates[g].from_finish;
        let pos = c.last.map_or([0.0; 3], |v| v.position);
        base + if c.finished_at.is_some() {
            0.0
        } else {
            self.course.window_progress(g, next, pos[0], pos[2])
        }
    }

    pub fn standings(&self) -> Vec<Standing> {
        let mut rows: Vec<Standing> = (0..self.cars.len() as u32)
            .map(|car| Standing {
                car,
                finished_at: self.cars[car as usize].finished_at,
                laps: self.laps_completed(car),
                gates_passed: self.cars[car as usize].gates_passed,
                progress_m: self.progress_m(car),
            })
            .collect();
        // The same order the session's results use (P1-N07c): finish time with its crossing fraction, then the progress
        // high-water mark and the tick it was reached.
        let key = |car: u32| {
            let c = &self.cars[car as usize];
            (
                c.finished_at.map(|t| (t, c.finish_fraction)),
                std::cmp::Reverse(c.best_progress_mm),
                c.best_progress_tick,
            )
        };
        rows.sort_by(|a, b| match (key(a.car), key(b.car)) {
            ((Some(x), ..), (Some(y), ..)) => x.cmp(&y).then(a.car.cmp(&b.car)),
            ((Some(_), ..), (None, ..)) => std::cmp::Ordering::Less,
            ((None, ..), (Some(_), ..)) => std::cmp::Ordering::Greater,
            ((None, pa, ta), (None, pb, tb)) => (pa, ta).cmp(&(pb, tb)).then(a.car.cmp(&b.car)),
        });
        rows
    }

    /// Bytes for the full-state hash: everything here that changes what happens next.
    pub fn hash_into(&self, out: &mut Vec<u8>) {
        for v in [self.started_at, self.first_finish] {
            out.extend(v.unwrap_or(u64::MAX).to_le_bytes());
        }
        out.extend(self.laps.to_le_bytes());
        for c in &self.cars {
            out.extend(c.gates_passed.to_le_bytes());
            out.extend(c.hold_until.to_le_bytes());
            out.extend(c.assist_since.unwrap_or(u64::MAX).to_le_bytes());
            out.extend(c.finished_at.unwrap_or(u64::MAX).to_le_bytes());
            out.extend(c.rest_inverted.to_le_bytes());
            out.extend(c.slow.to_le_bytes());
            out.extend(c.wrecks.to_le_bytes());
            out.extend(c.recoveries.to_le_bytes());
            out.extend(c.finish_fraction.to_le_bytes());
            out.extend(c.best_progress_mm.to_le_bytes());
            out.extend(c.best_progress_tick.to_le_bytes());
            out.push(u8::from(c.late));
            for s in &c.history {
                out.extend(s.tick.to_le_bytes());
                out.extend(s.progress_m.to_bits().to_le_bytes());
            }
        }
    }

    /// The flip-assist torque for an assisting car: PD about the axis turning its up towards world up (N·m).
    pub fn assist_torque(up: [f32; 3], forward: [f32; 3], angvel: [f32; 3]) -> [f32; 3] {
        // axis = up × Y; when exactly upside down it vanishes, so roll about the car's forward axis instead.
        let mut axis = [-up[2], 0.0, up[0]];
        let mut len = (axis[0] * axis[0] + axis[2] * axis[2]).sqrt();
        if len < 1e-3 {
            axis = forward;
            len = (forward[0] * forward[0] + forward[1] * forward[1] + forward[2] * forward[2])
                .sqrt()
                .max(1e-6);
        }
        let angle = libm::acosf(up[1].clamp(-1.0, 1.0));
        let k = (ASSIST_K * angle).min(ASSIST_MAX);
        [0, 1, 2].map(|i| axis[i] / len * k - ASSIST_D * angvel[i])
    }
}
