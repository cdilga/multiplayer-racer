//! Device backends. Each opens its devices on `start` and closes them all on `stop`: the helper captures only while a
//! paired page is connected.

use std::io::BufRead;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use crate::hub::DeviceEvent;
use crate::server::Event;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(windows)]
pub mod windows;

/// Where a capture's events go, tagged with its generation.
#[derive(Clone)]
pub struct Sink {
    generation: u64,
    tx: Sender<Event>,
}

impl Sink {
    pub fn new(generation: u64, tx: Sender<Event>) -> Self {
        Self { generation, tx }
    }

    /// False once the helper is gone (the backend's thread should end).
    pub fn send(&self, ev: DeviceEvent) -> bool {
        self.tx.send(Event::Device(self.generation, ev)).is_ok()
    }
}

pub trait Backend: Send {
    fn start(&mut self, sink: Sink);
    fn stop(&mut self);
}

/// The platform's own backend; `only` keeps devices whose name contains it (a test rig's virtual devices); `grab`
/// (Linux) takes the devices exclusively, so their keys reach the game and nothing else on the desktop.
pub fn native(only: Option<String>, grab: bool) -> Box<dyn Backend> {
    #[cfg(target_os = "linux")]
    let b: Box<dyn Backend> = Box::new(linux::Evdev::new(only, grab));
    #[cfg(not(target_os = "linux"))]
    if grab {
        eprintln!("--grab is Linux-only; ignored.");
    }
    #[cfg(target_os = "macos")]
    let b: Box<dyn Backend> = Box::new(macos::Hid::new(only));
    #[cfg(windows)]
    let b: Box<dyn Backend> = Box::new(windows::RawInput::new(only));
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    let b: Box<dyn Backend> = {
        let _ = only;
        Box::new(Scripted::stdin())
    };
    b
}

/// A scripted backend: one JSON [`DeviceEvent`] per line (stdin with `--backend stdin`), forwarded while capturing.
/// The journeys' fake helper endpoint is the real helper on this backend, so the socket, pairing and protocol are real.
pub struct Scripted {
    sink: Arc<Mutex<Option<Sink>>>,
}

impl Scripted {
    pub fn from_reader(r: impl BufRead + Send + 'static) -> Self {
        let sink: Arc<Mutex<Option<Sink>>> = Arc::default();
        let feed = sink.clone();
        std::thread::spawn(move || {
            for line in r.lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<DeviceEvent>(&line) {
                    Ok(ev) => {
                        if let Some(s) = feed.lock().expect("sink lock").as_ref() {
                            s.send(ev);
                        }
                    }
                    Err(e) => eprintln!("scripted backend: bad line ({e}): {line}"),
                }
            }
        });
        Self { sink }
    }

    pub fn stdin() -> Self {
        Self::from_reader(std::io::BufReader::new(std::io::stdin()))
    }
}

impl Backend for Scripted {
    fn start(&mut self, sink: Sink) {
        *self.sink.lock().expect("sink lock") = Some(sink);
    }
    fn stop(&mut self) {
        *self.sink.lock().expect("sink lock") = None;
    }
}
