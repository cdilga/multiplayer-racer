//! The session side of `jj sim`: seats claimed through the real seat reducer (P1-N07a) and the round director (P1-N07b)
//! driven to a phase through its own inputs, never by writing its state. Ticks keep both in step with the sim.

use serde::Deserialize;
use serde_json::{Value, json};

use jj_session::director::{self, Director, Phase};
use jj_session::seats::{self, Seats};
use jj_types::{EndpointId, RequestId, SeatId, Tick};

use super::SeatSpec;

/// A phase a fixture can start in.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PhaseTarget {
    Lobby,
    Countdown,
    Running,
    Intermission,
}

pub struct Session {
    seats: Seats,
    director: Director,
    /// The fixture's seat → car binding, in claim order.
    claimed: Vec<(SeatId, Option<u32>)>,
    elapsed_ms: u64,
}

impl Session {
    /// Claims each seat as a controller would: Hello (endpoint + secret hash), Claim, then a tick boundary.
    pub fn new(specs: &[SeatSpec]) -> Result<Self, String> {
        let mut s = Self {
            seats: Seats::default(),
            director: Director::default(),
            claimed: Vec::new(),
            elapsed_ms: 0,
        };
        for (i, spec) in specs.iter().enumerate() {
            let conn = i as u64 + 1;
            s.seats.apply(seats::Input::Hello {
                conn,
                endpoint: EndpointId(format!("jj-sim-seat-{i}")),
                secret_hash: [i as u8 + 1; 32],
            });
            let out = s.seats.apply(seats::Input::Claim {
                conn,
                request: RequestId(1),
                name: spec.name.clone(),
            });
            let seat = out
                .iter()
                .find_map(|o| match o {
                    seats::Output::Welcome { seat, .. } => Some(*seat),
                    _ => None,
                })
                .ok_or_else(|| {
                    format!(
                        "seats[{i}] ({:?}): the claim was refused: {out:?}",
                        spec.name
                    )
                })?;
            s.claimed.push((seat, spec.car));
        }
        s.seats.apply(seats::Input::Tick(Tick(1)));
        for &(seat, _) in &s.claimed {
            s.director.apply(director::Input::SetEligible {
                seat,
                eligible: true,
            });
        }
        Ok(s)
    }

    /// Drives the director to `target` with the host's own buttons and map results.
    pub fn jump(&mut self, target: PhaseTarget) -> Result<(), String> {
        if target != PhaseTarget::Lobby {
            let out = self.director.apply(director::Input::StartNow);
            let id = out
                .iter()
                .find_map(|o| match o {
                    director::Output::PrepareRequested { id, .. } => Some(*id),
                    _ => None,
                })
                .ok_or("Start now didn't request a map (no seats claimed?)")?;
            self.director
                .apply(director::Input::PrepareFinished { id, ok: true });
            if target != PhaseTarget::Countdown {
                // Start now again skips the countdown.
                self.director.apply(director::Input::StartNow);
            }
            if target == PhaseTarget::Intermission {
                self.director.apply(director::Input::RoundOver);
                self.director
                    .apply(director::Input::ResultsCommitted { saved: true });
            }
        }
        let want = match target {
            PhaseTarget::Lobby => Phase::Lobby,
            PhaseTarget::Countdown => Phase::Countdown,
            PhaseTarget::Running => Phase::Running,
            PhaseTarget::Intermission => Phase::Intermission,
        };
        if self.director.phase() == want {
            Ok(())
        } else {
            Err(format!(
                "couldn't reach {target:?}: the director is in {:?}",
                self.director.phase()
            ))
        }
    }

    /// After sim tick `tick`: the seats' tick boundary and the director's clock (120 Hz in whole milliseconds).
    pub fn step(&mut self, tick: u64) {
        self.seats.apply(seats::Input::Tick(Tick(tick + 1)));
        let ms = tick * 1000 / u64::from(jj_sim::TICK_HZ);
        let dt = ms - self.elapsed_ms;
        self.elapsed_ms = ms;
        self.director
            .apply(director::Input::Elapsed { ms: dt as u32 });
    }

    pub fn observe(&self) -> Value {
        let seats: Vec<Value> = self
            .seats
            .seats()
            .map(|s| {
                let car = self
                    .claimed
                    .iter()
                    .find(|(id, _)| *id == s.id)
                    .and_then(|(_, c)| *c);
                json!({
                    "seat": s.id.0,
                    "number": s.number.0,
                    "colour": s.colour,
                    "name": self.seats.display_name(s.id),
                    "presence": format!("{:?}", s.presence),
                    "connected": s.conn.is_some(),
                    "source": s.source.0,
                    "hasCar": s.has_car,
                    "car": car,
                    "ready": self.director.is_ready(s.id),
                })
            })
            .collect();
        json!({
            "phase": format!("{:?}", self.director.phase()),
            "round": self.director.round().map(|r| r.0),
            "remainingMs": self.director.remaining_ms(),
            "readyRevision": self.director.ready_revision(),
            "driving": format!("{:?}", self.director.driving()),
            "seats": seats,
        })
    }
}
