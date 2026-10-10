//! The host's seat reducer (P1-N07a): idempotent claims, resume by secret hash, duplicate-tab fencing, a stable number
//! and colour per seat for any N, Identify with a rate limit, Leave/Sit out at tick boundaries.
//!
//! Pure and deterministic: inputs in, outputs out, time only through [`Input::Tick`]. The host's transport turns
//! `cmd`-channel messages into [`Input`]s (hashing the endpoint secret first, so no secret is stored) and sends the
//! [`Output`]s back as `Welcome`, `ClaimRejected`, the fencing card and Identify flashes.
//!
//! - Opening a URL never claims a seat: only [`Input::Claim`] does. One endpoint (a controller's stored id + secret)
//!   owns at most one seat per *source* (a phone is one source, [`PRIMARY_SOURCE`]; a hub's pads and key clusters are
//!   one source each, over the one connection), so retries, reconnects and duplicate tabs can't create a second car.
//! - Numbers count up from 1 and are never reused; colours cycle the identity palette (the number keeps cars apart).
//!   Nothing here counts or caps seats (R36).
//! - Leave keeps the seat (number, name, standings), withdraws the car at the next tick boundary and leaves its debris.

use std::collections::BTreeMap;

use jj_protocol::cmd::ClaimRejection;
use jj_types::{EndpointId, RequestId, SeatColour, SeatId, SeatNumber, SourceHandle, Tick};

pub mod names;
#[cfg(test)]
mod tests;

/// The host transport's id for one live connection (one browser tab).
pub type ConnId = u64;

/// The source a command without a source addresses: a phone's own sticks.
pub const PRIMARY_SOURCE: SourceHandle = SourceHandle(1);

/// The identity palette, in seat order (`art/ui/tokens.json` `identity.colors`, ordered so neighbours differ under CVD).
pub const IDENTITY_PALETTE: [[u8; 3]; 12] = [
    [0xE5, 0x32, 0x2D], // red
    [0x25, 0x63, 0xEB], // blue
    [0xFF, 0x7A, 0x1A], // orange
    [0x00, 0xB5, 0xB8], // teal
    [0xFF, 0xD2, 0x3F], // yellow
    [0xFF, 0x4F, 0xA3], // pink
    [0x2A, 0x2D, 0x34], // charcoal
    [0x22, 0xA4, 0x47], // green
    [0xF4, 0xF1, 0xEA], // white
    [0x8B, 0x3F, 0xD9], // purple
    [0x8E, 0x1B, 0x3F], // maroon
    [0x5E, 0xC8, 0xFF], // sky
];

#[derive(Clone, Debug)]
pub struct SeatConfig {
    /// Sim ticks per second (the Identify limit is in ticks).
    pub tick_hz: u32,
    /// Seconds between player-triggered Identify flashes for one seat: anti-spam only (owner playtest 1 found the old
    /// 3 s swallowing ordinary repeat presses; master §5.2's figure is superseded).
    pub identify_every_s: u32,
    pub palette: Vec<[u8; 3]>,
}

impl Default for SeatConfig {
    fn default() -> Self {
        Self {
            tick_hz: 60,
            identify_every_s: 1,
            palette: IDENTITY_PALETTE.to_vec(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presence {
    Active,
    SittingOut,
    Left,
}

/// Changes that wait for the next tick boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Pending {
    Join,
    Leave,
    SitOut,
    Return,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Withdraw {
    Left,
    SatOut,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seat {
    pub id: SeatId,
    pub number: SeatNumber,
    pub colour: SeatColour,
    /// As typed and cleaned; `None` uses the default. See [`Seats::display_name`].
    pub name: Option<String>,
    pub endpoint: EndpointId,
    /// The live connection driving the seat, if any.
    pub conn: Option<ConnId>,
    pub source: SourceHandle,
    pub presence: Presence,
    /// One car per seat: present only for an active seat, from the tick boundary after it joins or returns.
    pub has_car: bool,
    identify_last: Option<Tick>,
    pending: Option<Pending>,
}

#[derive(Clone, Debug)]
struct Endpoint {
    secret_hash: [u8; 32],
    /// One seat per source (R36: no cap on the number of sources).
    seats: BTreeMap<SourceHandle, SeatId>,
    conn: Option<ConnId>,
}

#[derive(Clone, Debug)]
struct Conn {
    endpoint: EndpointId,
    fenced: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Input {
    /// A connection's first message: its endpoint and the SHA-256 of its endpoint secret (`Hello.resume`).
    Hello {
        conn: ConnId,
        endpoint: EndpointId,
        secret_hash: [u8; 32],
    },
    Claim {
        conn: ConnId,
        source: SourceHandle,
        request: RequestId,
        name: String,
    },
    SetName {
        conn: ConnId,
        source: SourceHandle,
        name: String,
    },
    Identify {
        conn: ConnId,
        source: SourceHandle,
    },
    Leave {
        conn: ConnId,
        source: SourceHandle,
    },
    /// The host removed this seat (P1-G07): it leaves at the next tick boundary like a Leave, and its endpoint forgets
    /// it, so the same phone joining again is a new claim with a new number. Only the host's UI sends this; no
    /// controller frame decodes to it.
    HostRemove {
        seat: SeatId,
    },
    SitOut {
        conn: ConnId,
        source: SourceHandle,
        on: bool,
    },
    Disconnect {
        conn: ConnId,
    },
    /// From the sim: the seat's car respawned (Identify auto-fires).
    Respawned {
        seat: SeatId,
    },
    /// A tick boundary: pending joins, returns, leaves and sit-outs take effect here.
    Tick(Tick),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Output {
    Welcome {
        conn: ConnId,
        seat: SeatId,
        number: SeatNumber,
        colour: SeatColour,
        source: SourceHandle,
    },
    ClaimRejected {
        conn: ConnId,
        reason: ClaimRejection,
    },
    /// Another tab took over this endpoint: show "Playing in another tab".
    Fenced {
        conn: ConnId,
    },
    /// The endpoint id is known with a different secret: no seat for this connection.
    Refused {
        conn: ConnId,
    },
    /// Flash this seat's car (Identify).
    Identify {
        seat: SeatId,
    },
    IdentifyLimited {
        conn: ConnId,
        retry_in_ticks: u64,
    },
    CarAdded {
        seat: SeatId,
    },
    CarWithdrawn {
        seat: SeatId,
        why: Withdraw,
    },
    NameChanged {
        seat: SeatId,
    },
}

#[derive(Clone, Debug)]
pub struct Seats {
    cfg: SeatConfig,
    now: Tick,
    seats: BTreeMap<SeatId, Seat>,
    endpoints: BTreeMap<EndpointId, Endpoint>,
    conns: BTreeMap<ConnId, Conn>,
    next_seat: u32,
    next_number: u32,
}

impl Default for Seats {
    fn default() -> Self {
        Self::new(SeatConfig::default())
    }
}

impl Seats {
    pub fn new(cfg: SeatConfig) -> Self {
        Self {
            cfg,
            now: Tick(0),
            seats: BTreeMap::new(),
            endpoints: BTreeMap::new(),
            conns: BTreeMap::new(),
            next_seat: 1,
            next_number: 1,
        }
    }

    pub fn now(&self) -> Tick {
        self.now
    }

    pub fn seat(&self, id: SeatId) -> Option<&Seat> {
        self.seats.get(&id)
    }

    pub fn seats(&self) -> impl Iterator<Item = &Seat> {
        self.seats.values()
    }

    /// The primary source's seat on a connection (a phone), if it's the endpoint's live, unfenced connection.
    pub fn seat_of(&self, conn: ConnId) -> Option<SeatId> {
        self.seat_at(conn, PRIMARY_SOURCE)
    }

    /// The seat one source of a connection drives, if it's the endpoint's live, unfenced connection.
    pub fn seat_at(&self, conn: ConnId, source: SourceHandle) -> Option<SeatId> {
        let c = self.conns.get(&conn).filter(|c| !c.fenced)?;
        let e = self.endpoints.get(&c.endpoint)?;
        if e.conn != Some(conn) {
            return None;
        }
        e.seats.get(&source).copied()
    }

    /// Routes a state record: the seat whose car it drives, or `None` (the input is stale and neutralised): unknown or
    /// fenced connection, a source handle that isn't the seat's, or a seat without a car.
    pub fn input_seat(&self, conn: ConnId, source: SourceHandle) -> Option<SeatId> {
        let id = self.seat_at(conn, source)?;
        self.seats[&id].has_car.then_some(id)
    }

    /// The name shown for a seat: the cleaned name or the default, plus ` #<number>` when an earlier seat (lower number)
    /// has the same name, case-folded. Earlier seats keep their plain name, so a suffix never moves to someone else.
    pub fn display_name(&self, id: SeatId) -> Option<String> {
        let seat = self.seats.get(&id)?;
        let base = Self::base_name(seat);
        let key = names::fold(&base);
        let earlier = self
            .seats
            .values()
            .any(|s| s.number < seat.number && names::fold(&Self::base_name(s)) == key);
        Some(if earlier {
            format!("{base} #{}", seat.number.0)
        } else {
            base
        })
    }

    fn base_name(seat: &Seat) -> String {
        seat.name
            .clone()
            .unwrap_or_else(|| format!("Player {}", seat.number.0))
    }

    fn identify_ticks(&self) -> u64 {
        u64::from(self.cfg.tick_hz) * u64::from(self.cfg.identify_every_s)
    }

    fn welcome(conn: ConnId, s: &Seat) -> Output {
        Output::Welcome {
            conn,
            seat: s.id,
            number: s.number,
            colour: s.colour,
            source: s.source,
        }
    }

    pub fn apply(&mut self, input: Input) -> Vec<Output> {
        let mut out = Vec::new();
        match input {
            Input::Hello {
                conn,
                endpoint,
                secret_hash,
            } => {
                if self.conns.contains_key(&conn) {
                    return out; // a second Hello on one connection changes nothing
                }
                match self.endpoints.get_mut(&endpoint) {
                    Some(e) if e.secret_hash != secret_hash => {
                        out.push(Output::Refused { conn });
                        return out;
                    }
                    Some(e) => {
                        // Resume, or a duplicate tab: the newest connection wins and the older one is fenced.
                        if let Some(old) = e.conn.replace(conn)
                            && let Some(c) = self.conns.get_mut(&old)
                        {
                            c.fenced = true;
                            out.push(Output::Fenced { conn: old });
                        }
                        for id in e.seats.values() {
                            let seat = self.seats.get_mut(id).expect("an endpoint's seat exists");
                            seat.conn = Some(conn);
                            out.push(Self::welcome(conn, seat));
                        }
                    }
                    None => {
                        self.endpoints.insert(
                            endpoint.clone(),
                            Endpoint {
                                secret_hash,
                                seats: BTreeMap::new(),
                                conn: Some(conn),
                            },
                        );
                    }
                }
                self.conns.insert(
                    conn,
                    Conn {
                        endpoint,
                        fenced: false,
                    },
                );
            }
            Input::Claim {
                conn,
                source,
                request: _,
                name,
            } => {
                let Some(c) = self.conns.get(&conn).filter(|c| !c.fenced) else {
                    return out;
                };
                let ep = c.endpoint.clone();
                if self.endpoints[&ep].conn != Some(conn) {
                    return out;
                }
                // Idempotent: whatever the request id, a source that has a seat gets that seat back.
                if let Some(&id) = self.endpoints[&ep].seats.get(&source) {
                    let seat = self.seats.get_mut(&id).expect("an endpoint's seat exists");
                    if seat.presence == Presence::Left && seat.pending.is_none() {
                        seat.pending = Some(Pending::Return);
                    }
                    out.push(Self::welcome(conn, seat));
                    return out;
                }
                let name = match names::clean_name(&name) {
                    Ok(n) => n,
                    Err(_) => {
                        out.push(Output::ClaimRejected {
                            conn,
                            reason: ClaimRejection::Name,
                        });
                        return out;
                    }
                };
                let (id, number) = (SeatId(self.next_seat), SeatNumber(self.next_number));
                self.next_seat += 1;
                self.next_number += 1;
                let palette = &self.cfg.palette;
                let ordinal = (number.0 - 1) as usize;
                let colour = SeatColour {
                    index: (ordinal % (usize::from(u16::MAX) + 1)) as u16,
                    rgb: palette[ordinal % palette.len()],
                };
                let seat = Seat {
                    id,
                    number,
                    colour,
                    name,
                    endpoint: ep.clone(),
                    conn: Some(conn),
                    source,
                    presence: Presence::Active,
                    has_car: false,
                    identify_last: Some(self.now),
                    pending: Some(Pending::Join),
                };
                out.push(Self::welcome(conn, &seat));
                out.push(Output::Identify { seat: id }); // auto-fires on join
                self.seats.insert(id, seat);
                self.endpoints
                    .get_mut(&ep)
                    .expect("hello registered it")
                    .seats
                    .insert(source, id);
            }
            Input::SetName { conn, source, name } => {
                let Some(id) = self.seat_at(conn, source) else {
                    return out;
                };
                match names::clean_name(&name) {
                    Ok(n) => {
                        self.seats.get_mut(&id).expect("seat").name = n;
                        out.push(Output::NameChanged { seat: id });
                    }
                    Err(_) => out.push(Output::ClaimRejected {
                        conn,
                        reason: ClaimRejection::Name,
                    }),
                }
            }
            Input::Identify { conn, source } => {
                let Some(id) = self.seat_at(conn, source) else {
                    return out;
                };
                let every = self.identify_ticks();
                let now = self.now;
                let seat = self.seats.get_mut(&id).expect("seat");
                match seat.identify_last {
                    Some(last) if now.0 < last.0 + every => out.push(Output::IdentifyLimited {
                        conn,
                        retry_in_ticks: last.0 + every - now.0,
                    }),
                    _ => {
                        seat.identify_last = Some(now);
                        out.push(Output::Identify { seat: id });
                    }
                }
            }
            Input::Respawned { seat } => {
                // The respawn's own flash doesn't use up the player's press (owner playtest 1: autopilot respawns made
                // the next press look ignored).
                if self.seats.contains_key(&seat) {
                    out.push(Output::Identify { seat });
                }
            }
            Input::Leave { conn, source } => {
                if let Some(id) = self.seat_at(conn, source) {
                    let seat = self.seats.get_mut(&id).expect("seat");
                    if seat.presence != Presence::Left {
                        seat.pending = Some(Pending::Leave);
                    }
                }
            }
            Input::HostRemove { seat } => {
                if let Some(s) = self.seats.get_mut(&seat)
                    && s.presence != Presence::Left
                {
                    s.pending = Some(Pending::Leave);
                    if let Some(e) = self.endpoints.get_mut(&s.endpoint)
                        && e.seats.get(&s.source) == Some(&seat)
                    {
                        e.seats.remove(&s.source);
                    }
                }
            }
            Input::SitOut { conn, source, on } => {
                if let Some(id) = self.seat_at(conn, source) {
                    let seat = self.seats.get_mut(&id).expect("seat");
                    match (on, seat.presence) {
                        (true, Presence::Active) => seat.pending = Some(Pending::SitOut),
                        (false, Presence::SittingOut) => seat.pending = Some(Pending::Return),
                        _ => {}
                    }
                }
            }
            Input::Disconnect { conn } => {
                if let Some(c) = self.conns.remove(&conn)
                    && let Some(e) = self.endpoints.get_mut(&c.endpoint)
                    && e.conn == Some(conn)
                {
                    e.conn = None;
                    for id in e.seats.values() {
                        // The seats and their cars stay (autopilot takes over after 2 s, S07); a reconnect resumes them.
                        self.seats.get_mut(id).expect("seat").conn = None;
                    }
                }
            }
            Input::Tick(t) => {
                self.now = Tick(self.now.0.max(t.0));
                for seat in self.seats.values_mut() {
                    match seat.pending.take() {
                        Some(Pending::Join) | Some(Pending::Return) => {
                            seat.presence = Presence::Active;
                            if !seat.has_car {
                                seat.has_car = true;
                                out.push(Output::CarAdded { seat: seat.id });
                            }
                        }
                        Some(Pending::Leave) => {
                            seat.presence = Presence::Left;
                            if std::mem::take(&mut seat.has_car) {
                                out.push(Output::CarWithdrawn {
                                    seat: seat.id,
                                    why: Withdraw::Left,
                                });
                            }
                        }
                        Some(Pending::SitOut) => {
                            seat.presence = Presence::SittingOut;
                            if std::mem::take(&mut seat.has_car) {
                                out.push(Output::CarWithdrawn {
                                    seat: seat.id,
                                    why: Withdraw::SatOut,
                                });
                            }
                        }
                        None => {}
                    }
                }
            }
        }
        out
    }
}
