//! The helper's loop: a loopback WebSocket for host pages, pairing, and capture only while a paired page is connected.
//!
//! Threads, std only (no async runtime): one accepts connections, each connection has a reader and a writer, the
//! backend has its own, and everything meets on one channel this loop drains. The loop owns the [`Hub`] and the
//! [`Pairing`]; messages go only to paired sessions.

use std::collections::BTreeMap;
use std::io::{self, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::thread;

use crate::backend::{Backend, Sink};
use crate::hub::{DeviceEvent, Hub};
use crate::pairing::{Outcome, Pairing, host_ok, origin_ok};
use crate::protocol::{FromPage, ToPage, VERSION};
use crate::ws;

pub enum Event {
    /// A backend event, tagged with the capture it belongs to (late events from a stopped capture are dropped).
    Device(u64, DeviceEvent),
    Open {
        session: u64,
        origin: String,
        tx: Sender<Out>,
    },
    Text {
        session: u64,
        text: String,
    },
    Closed {
        session: u64,
    },
}

pub enum Out {
    Text(String),
    Pong(Vec<u8>),
    Close,
}

pub struct Config {
    /// 0 picks a free port (tests).
    pub port: u16,
    pub allowed: Vec<String>,
    pub store: Option<PathBuf>,
    /// A fixed first pairing code (tests); otherwise random.
    pub code: Option<String>,
}

struct Session {
    origin: String,
    tx: Sender<Out>,
    paired: bool,
}

pub struct Server {
    listener: TcpListener,
    port: u16,
    allowed: Vec<String>,
    pairing: Pairing,
}

pub const fn os() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

impl Server {
    pub fn bind(cfg: Config) -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, cfg.port))?;
        let port = listener.local_addr()?.port();
        let mut pairing = Pairing::new(cfg.store);
        if let Some(c) = &cfg.code {
            pairing.set_code(c);
        }
        Ok(Self {
            listener,
            port,
            allowed: cfg.allowed,
            pairing,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Runs until the process ends. `say` gets each status line the helper's window shows.
    pub fn run(mut self, mut backend: Box<dyn Backend>, say: &mut dyn FnMut(&str)) {
        let (tx, rx) = channel::<Event>();
        let listener = self.listener.try_clone().expect("listener clones");
        let (port, allowed) = (self.port, self.allowed.clone());
        let accept_tx = tx.clone();
        thread::spawn(move || {
            for (n, stream) in listener.incoming().flatten().enumerate() {
                let (tx, allowed) = (accept_tx.clone(), allowed.clone());
                let session = n as u64 + 1;
                thread::spawn(move || connection(stream, session, port, &allowed, tx));
            }
        });
        say(&format!(
            "Joystick Jammers input helper {} listening on 127.0.0.1:{} for {}",
            env!("CARGO_PKG_VERSION"),
            self.port,
            self.allowed.join(", ")
        ));
        say(&format!(
            "Pairing code: {} (type it into the game's Keys & pads drawer)",
            self.pairing.code()
        ));
        say("Not capturing: no game page is paired.");
        self.serve(rx, tx, backend.as_mut(), say);
    }

    fn serve(
        &mut self,
        rx: Receiver<Event>,
        tx: Sender<Event>,
        backend: &mut dyn Backend,
        say: &mut dyn FnMut(&str),
    ) {
        let mut sessions: BTreeMap<u64, Session> = BTreeMap::new();
        let mut hub = Hub::new();
        let mut generation = 0u64;
        let mut capturing = false;
        let send = |s: &Session, m: &ToPage| {
            let _ = s.tx.send(Out::Text(m.json()));
        };
        let status = |hub: &Hub, sessions: &BTreeMap<u64, Session>| {
            let (k, p) = hub.counts();
            let origins: Vec<&str> = sessions
                .values()
                .filter(|s| s.paired)
                .map(|s| s.origin.as_str())
                .collect();
            format!(
                "Capturing {k} keyboard{} and {p} pad{} for {} (only while that page is open).",
                if k == 1 { "" } else { "s" },
                if p == 1 { "" } else { "s" },
                origins.join(", ")
            )
        };
        while let Ok(ev) = rx.recv() {
            match ev {
                Event::Open {
                    session,
                    origin,
                    tx,
                } => {
                    let s = Session {
                        origin,
                        tx,
                        paired: false,
                    };
                    send(
                        &s,
                        &ToPage::Hello {
                            v: VERSION,
                            os: os().into(),
                            version: env!("CARGO_PKG_VERSION").into(),
                        },
                    );
                    sessions.insert(session, s);
                }
                Event::Text { session, text } => {
                    let Some(s) = sessions.get_mut(&session) else {
                        continue;
                    };
                    let Ok(FromPage::Pair { code, token }) = serde_json::from_str(&text) else {
                        continue;
                    };
                    let (outcome, rotated) =
                        self.pairing
                            .pair(&s.origin, code.as_deref(), token.as_deref());
                    match outcome {
                        Outcome::Paired(token) => {
                            let first = !s.paired;
                            s.paired = true;
                            send(s, &ToPage::Paired { token });
                            if first {
                                say(&format!("Paired with {}.", s.origin));
                            }
                            for m in hub.snapshot() {
                                send(s, &m);
                            }
                        }
                        Outcome::Refused(reason) => {
                            send(
                                s,
                                &ToPage::Unpaired {
                                    reason: reason.into(),
                                },
                            );
                        }
                    }
                    if rotated {
                        say(&format!("Pairing code: {}", self.pairing.code()));
                    }
                    if !capturing && sessions.values().any(|s| s.paired) {
                        capturing = true;
                        generation += 1;
                        backend.start(Sink::new(generation, tx.clone()));
                        say(&status(&hub, &sessions));
                    }
                }
                Event::Closed { session } => {
                    sessions.remove(&session);
                    if capturing && !sessions.values().any(|s| s.paired) {
                        capturing = false;
                        backend.stop();
                        hub.close_all();
                        say("Not capturing: no game page is paired.");
                    }
                }
                Event::Device(g, ev) => {
                    if !capturing || g != generation {
                        continue;
                    }
                    let listed =
                        matches!(ev, DeviceEvent::Added { .. } | DeviceEvent::Removed { .. });
                    for m in hub.apply(ev) {
                        for s in sessions.values().filter(|s| s.paired) {
                            send(s, &m);
                        }
                    }
                    if listed {
                        say(&status(&hub, &sessions));
                    }
                }
            }
        }
    }
}

/// One connection: the handshake's checks, then a writer thread and this thread reading.
fn connection(stream: TcpStream, session: u64, port: u16, allowed: &[String], tx: Sender<Event>) {
    let _ = stream.set_nodelay(true);
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let Ok((req, mut reader)) = ws::read_request_from(read_half) else {
        return;
    };
    let mut w = stream;
    let origin = req.header("origin").map(str::to_owned);
    let refusal = if !host_ok(req.header("host"), port) {
        Some("this helper only answers 127.0.0.1 and localhost")
    } else if !origin_ok(origin.as_deref(), allowed) {
        Some("this page's origin is not allowed (run the helper with --allow-origin to add one)")
    } else {
        None
    };
    let key = ws::upgrade_key(&req).map(str::to_owned);
    match (refusal, key) {
        (Some(why), _) => {
            let _ = ws::write_refusal(&mut w, "403 Forbidden", why);
            return;
        }
        (None, None) => {
            let _ = ws::write_refusal(&mut w, "400 Bad Request", "WebSocket only");
            return;
        }
        (None, Some(key)) => {
            if ws::write_accept(&mut w, &key).is_err() {
                return;
            }
        }
    }
    let (otx, orx) = channel::<Out>();
    let writer = thread::spawn(move || {
        for out in orx {
            let r = match out {
                Out::Text(t) => ws::write_text(&mut w, &t),
                Out::Pong(p) => ws::write_pong(&mut w, &p),
                Out::Close => {
                    let _ = ws::write_close(&mut w);
                    let _ = w.flush();
                    let _ = w.shutdown(std::net::Shutdown::Both);
                    break;
                }
            };
            if r.is_err() {
                break;
            }
        }
    });
    let origin = origin.unwrap_or_default();
    if tx
        .send(Event::Open {
            session,
            origin,
            tx: otx.clone(),
        })
        .is_err()
    {
        return;
    }
    loop {
        match ws::read_frame(&mut reader) {
            Ok(ws::Frame::Text(text)) => {
                if tx.send(Event::Text { session, text }).is_err() {
                    break;
                }
            }
            Ok(ws::Frame::Ping(p)) => {
                let _ = otx.send(Out::Pong(p));
            }
            Ok(ws::Frame::Pong) => {}
            Ok(ws::Frame::Close) | Err(_) => break,
        }
    }
    let _ = tx.send(Event::Closed { session });
    let _ = otx.send(Out::Close);
    drop(otx);
    let _ = writer.join();
}
