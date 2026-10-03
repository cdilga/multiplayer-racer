//! Observation (P1-F05a, R90 "see"): what a car looks like at a tick as plain serialisable data, its progress along the
//! map's route, and the **outcome signature**: the numbers that say what happened over a run (plan §13b.1). `jj sim`
//! prints these as JSON and the browser surface (P1-F05b) uses the same shapes. Read-only: nothing here changes the sim.

use serde::{Deserialize, Serialize};

use jj_map::Map;
use jj_types::axis::dequantise_axis;

use crate::journal::SpawnPose;
use crate::sim::{CarId, Sim, TICK_HZ};

/// The route as a closed polyline in metres with cumulative arc lengths (built once per map).
#[derive(Clone, Debug)]
pub struct RouteGeom {
    pts: Vec<(f64, f64)>,
    s: Vec<f64>,
    total: f64,
}

/// Where a car is along the route.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteProgress {
    /// Distance along the route from point 0 to the nearest point on the centerline, metres.
    pub distance_m: f64,
    /// `distance_m` over the route length, 0..1.
    pub fraction: f64,
    /// The route segment's start point.
    pub route_point: u32,
    /// Signed distance from the centerline, metres (+ on the (−tz, tx) side, as the map validator measures it).
    pub lateral_m: f64,
}

impl RouteGeom {
    pub fn new(map: &Map) -> Self {
        let pts: Vec<(f64, f64)> = map
            .route
            .points
            .iter()
            .map(|p| (f64::from(p.x) / 1000.0, f64::from(p.z) / 1000.0))
            .collect();
        let mut s = Vec::with_capacity(pts.len());
        let mut total = 0.0;
        for i in 0..pts.len() {
            s.push(total);
            let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
            total += (b.0 - a.0).hypot(b.1 - a.1);
        }
        Self { pts, s, total }
    }

    pub fn length_m(&self) -> f64 {
        self.total
    }

    /// The nearest point on the centerline to `(x, z)`.
    pub fn progress(&self, x: f64, z: f64) -> RouteProgress {
        let mut best = (f64::INFINITY, 0usize, 0.0, 0.0);
        for i in 0..self.pts.len() {
            let (a, b) = (self.pts[i], self.pts[(i + 1) % self.pts.len()]);
            let (dx, dz) = (b.0 - a.0, b.1 - a.1);
            let len2 = dx * dx + dz * dz;
            let t = if len2 > 0.0 {
                (((x - a.0) * dx + (z - a.1) * dz) / len2).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let (px, pz) = (a.0 + t * dx, a.1 + t * dz);
            let d = (x - px).hypot(z - pz);
            if d < best.0 {
                let len = len2.sqrt().max(1e-9);
                // + on the (−tz, tx) side.
                let lateral = ((x - px) * (-dz) + (z - pz) * dx) / len;
                best = (d, i, t * len, lateral);
            }
        }
        let (_, i, along, lateral_m) = best;
        let distance_m = self.s.get(i).copied().unwrap_or(0.0) + along;
        RouteProgress {
            distance_m,
            fraction: if self.total > 0.0 {
                distance_m / self.total
            } else {
                0.0
            },
            route_point: i as u32,
            lateral_m,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputObs {
    pub throttle: f32,
    pub steer: f32,
    pub brake: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WheelObs {
    pub contact: bool,
    pub suspension_length: f32,
    pub suspension_force: f32,
    pub forward_impulse: f32,
    pub side_impulse: f32,
    pub steering: f32,
    pub slip_deg: f32,
}

/// A car's race state (P1-S05).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaceObs {
    pub gates_passed: u32,
    pub laps: u32,
    /// Legal progress, metres (gates in order, windowed between the last gate and the next).
    pub progress_m: f32,
    /// The route point of the anchor gate (`None` before the first gate).
    pub anchor_route_point: Option<u32>,
    pub held: bool,
    pub assisting: bool,
    pub finished_at: Option<u64>,
    pub ghost: bool,
    pub wrecks: u32,
    pub recoveries: u32,
    /// Joined mid-round (drop-in, P1-S06).
    pub late: bool,
    /// Under spawn protection (ghosted against cars and debris until clear).
    pub protected: bool,
}

/// One car at one tick.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CarObs {
    pub car: u32,
    pub position: [f32; 3],
    /// Quaternion x, y, z, w.
    pub rotation: [f32; 4],
    pub linvel: [f32; 3],
    pub angvel: [f32; 3],
    pub speed: f32,
    pub forward_speed: f32,
    /// Heading about +y, degrees (0 = +z).
    pub heading_deg: f32,
    pub up_y: f32,
    pub wheels_in_contact: u8,
    pub progress: RouteProgress,
    pub input: InputObs,
    pub wheels: Vec<WheelObs>,
    pub race: RaceObs,
}

pub fn observe_car(sim: &Sim, route: &RouteGeom, car: CarId) -> Option<CarObs> {
    let s = sim.car_state(car)?;
    let input = sim.input(car)?;
    let race = sim.race();
    let rc = race.car(car.0)?;
    let v = s.linvel;
    Some(CarObs {
        car: car.0,
        position: s.position,
        rotation: s.rotation,
        linvel: v,
        angvel: s.angvel,
        speed: (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt(),
        forward_speed: s.forward_speed,
        heading_deg: s.heading.to_degrees(),
        up_y: s.up_y,
        wheels_in_contact: s.wheels_in_contact,
        progress: route.progress(f64::from(s.position[0]), f64::from(s.position[2])),
        input: InputObs {
            throttle: dequantise_axis(input.throttle),
            steer: dequantise_axis(input.steer),
            brake: dequantise_axis(input.brake),
        },
        wheels: sim
            .wheel_states(car)?
            .iter()
            .map(|w| WheelObs {
                contact: w.in_contact,
                suspension_length: w.suspension_length,
                suspension_force: w.suspension_force,
                forward_impulse: w.forward_impulse,
                side_impulse: w.side_impulse,
                steering: w.steering,
                slip_deg: w.slip_deg,
            })
            .collect(),
        race: RaceObs {
            gates_passed: rc.gates_passed,
            laps: race.laps_completed(car.0),
            progress_m: race.progress_m(car.0),
            anchor_route_point: rc.last_gate.map(|g| race.course.gate_route_point(g) as u32),
            held: race.is_held(car.0, sim.tick()),
            assisting: race.is_assisting(car.0),
            finished_at: rc.finished_at,
            ghost: sim.is_ghost(car),
            wrecks: rc.wrecks,
            recoveries: rc.recoveries,
            late: rc.late,
            protected: sim.is_protected(car),
        },
    })
}

/// Every car in the sim, in id order.
pub fn observe_cars(sim: &Sim, route: &RouteGeom) -> Vec<CarObs> {
    sim.cars()
        .filter_map(|c| observe_car(sim, route, c))
        .collect()
}

/// A number that says what happened. The first eight are the car's state now; the rest accumulate over the run.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Metric {
    /// |v|, m/s.
    Speed,
    ForwardSpeed,
    UpY,
    /// Chassis y, m.
    Height,
    /// Horizontal distance from the spawn, m.
    Travel,
    /// Distance from the spawn's heading line, m.
    LateralDrift,
    /// |heading − spawn heading|, degrees.
    HeadingChangeDeg,
    WheelsInContact,
    MaxSpeed,
    /// Peak |yaw rate|, deg/s.
    MaxYawRateDegS,
    /// Peak |slip angle| over the wheels in contact, degrees.
    MaxSlipDeg,
    /// Time with no wheel on the ground, s.
    AirtimeS,
    MinUpY,
    /// Distance driven along the route, m (signed, unwrapped across the finish).
    ProgressM,
    /// Race (P1-S05): gates passed in order, laps completed, legal progress (m), wrecks and accepted Recovers.
    GatesPassed,
    LapsCompleted,
    LegalProgressM,
    Wrecks,
    Recoveries,
    /// 1 once the car has finished, else 0.
    Finished,
}

impl Metric {
    pub const ALL: [Metric; 20] = [
        Metric::Speed,
        Metric::ForwardSpeed,
        Metric::UpY,
        Metric::Height,
        Metric::Travel,
        Metric::LateralDrift,
        Metric::HeadingChangeDeg,
        Metric::WheelsInContact,
        Metric::MaxSpeed,
        Metric::MaxYawRateDegS,
        Metric::MaxSlipDeg,
        Metric::AirtimeS,
        Metric::MinUpY,
        Metric::ProgressM,
        Metric::GatesPassed,
        Metric::LapsCompleted,
        Metric::LegalProgressM,
        Metric::Wrecks,
        Metric::Recoveries,
        Metric::Finished,
    ];

    /// The camelCase name used in fixtures and JSON.
    pub fn name(self) -> &'static str {
        match self {
            Metric::Speed => "speed",
            Metric::ForwardSpeed => "forwardSpeed",
            Metric::UpY => "upY",
            Metric::Height => "height",
            Metric::Travel => "travel",
            Metric::LateralDrift => "lateralDrift",
            Metric::HeadingChangeDeg => "headingChangeDeg",
            Metric::WheelsInContact => "wheelsInContact",
            Metric::MaxSpeed => "maxSpeed",
            Metric::MaxYawRateDegS => "maxYawRateDegS",
            Metric::MaxSlipDeg => "maxSlipDeg",
            Metric::AirtimeS => "airtimeS",
            Metric::MinUpY => "minUpY",
            Metric::ProgressM => "progressM",
            Metric::GatesPassed => "gatesPassed",
            Metric::LapsCompleted => "lapsCompleted",
            Metric::LegalProgressM => "legalProgressM",
            Metric::Wrecks => "wrecks",
            Metric::Recoveries => "recoveries",
            Metric::Finished => "finished",
        }
    }
}

/// Accumulates one car's outcome signature, tick by tick.
#[derive(Clone, Debug)]
pub struct SignatureTracker {
    spawn: SpawnPose,
    route_length: f64,
    last: Option<CarObs>,
    max_speed: f64,
    max_yaw_rate: f64,
    max_slip: f64,
    airtime_ticks: u64,
    min_up_y: f64,
    progress_m: f64,
    last_distance: Option<f64>,
}

impl SignatureTracker {
    pub fn new(spawn: SpawnPose, route: &RouteGeom) -> Self {
        Self {
            spawn,
            route_length: route.length_m(),
            last: None,
            max_speed: 0.0,
            max_yaw_rate: 0.0,
            max_slip: 0.0,
            airtime_ticks: 0,
            min_up_y: 1.0,
            progress_m: 0.0,
            last_distance: None,
        }
    }

    /// Takes the car's observation after each tick (and once before the first).
    pub fn update(&mut self, o: &CarObs) {
        self.max_speed = self.max_speed.max(f64::from(o.speed));
        self.max_yaw_rate = self
            .max_yaw_rate
            .max(f64::from(o.angvel[1].abs()).to_degrees());
        for w in o.wheels.iter().filter(|w| w.contact) {
            self.max_slip = self.max_slip.max(f64::from(w.slip_deg.abs()));
        }
        if self.last.is_some() && o.wheels_in_contact == 0 {
            self.airtime_ticks += 1;
        }
        self.min_up_y = self.min_up_y.min(f64::from(o.up_y));
        let d = o.progress.distance_m;
        if let Some(prev) = self.last_distance {
            let mut delta = d - prev;
            let half = self.route_length / 2.0;
            if delta > half {
                delta -= self.route_length;
            } else if delta < -half {
                delta += self.route_length;
            }
            self.progress_m += delta;
        }
        self.last_distance = Some(d);
        self.last = Some(o.clone());
    }

    pub fn metric(&self, m: Metric) -> Option<f64> {
        let o = self.last.as_ref()?;
        let (dx, dz) = (
            f64::from(o.position[0] - self.spawn.x),
            f64::from(o.position[2] - self.spawn.z),
        );
        let (hx, hz) = (
            f64::from(self.spawn.heading.sin()),
            f64::from(self.spawn.heading.cos()),
        );
        Some(match m {
            Metric::Speed => f64::from(o.speed),
            Metric::ForwardSpeed => f64::from(o.forward_speed),
            Metric::UpY => f64::from(o.up_y),
            Metric::Height => f64::from(o.position[1]),
            Metric::Travel => dx.hypot(dz),
            Metric::LateralDrift => (dx * hz - dz * hx).abs(),
            Metric::HeadingChangeDeg => {
                let d = f64::from(o.heading_deg.to_radians() - self.spawn.heading);
                d.sin().atan2(d.cos()).abs().to_degrees()
            }
            Metric::WheelsInContact => f64::from(o.wheels_in_contact),
            Metric::MaxSpeed => self.max_speed,
            Metric::MaxYawRateDegS => self.max_yaw_rate,
            Metric::MaxSlipDeg => self.max_slip,
            Metric::AirtimeS => self.airtime_ticks as f64 / f64::from(TICK_HZ),
            Metric::MinUpY => self.min_up_y,
            Metric::ProgressM => self.progress_m,
            Metric::GatesPassed => f64::from(o.race.gates_passed),
            Metric::LapsCompleted => f64::from(o.race.laps),
            Metric::LegalProgressM => f64::from(o.race.progress_m),
            Metric::Wrecks => f64::from(o.race.wrecks),
            Metric::Recoveries => f64::from(o.race.recoveries),
            Metric::Finished => f64::from(u8::from(o.race.finished_at.is_some())),
        })
    }

    /// Every metric, in [`Metric::ALL`] order, as `(name, value)`.
    pub fn signature(&self) -> Vec<(&'static str, f64)> {
        Metric::ALL
            .iter()
            .filter_map(|&m| self.metric(m).map(|v| (m.name(), v)))
            .collect()
    }
}
