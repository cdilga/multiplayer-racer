//! Linux: every `/dev/input/event*` node that is a keyboard or a pad, read with the `evdev` crate (Apache-2.0 OR MIT).
//! Reading needs the `input` group (or a udev ACL); the helper says so when it can't open anything.
//!
//! One thread: rescans `/dev/input` every 500 ms (hotplug without udev), and drains every open device without blocking
//! every 2 ms. `stop` ends the thread, which closes every device.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use evdev::{AbsoluteAxisCode, Device, EventType, InputEvent, KeyCode};

use super::{Backend, Sink};
use crate::hub::DeviceEvent;
use crate::keymap::{self, PadAxis, button};
use crate::protocol::Kind;

pub struct Evdev {
    only: Option<String>,
    grab: bool,
    run: Option<(Arc<AtomicBool>, JoinHandle<()>)>,
}

impl Evdev {
    pub fn new(only: Option<String>, grab: bool) -> Self {
        Self {
            only,
            grab,
            run: None,
        }
    }
}

impl Backend for Evdev {
    fn start(&mut self, sink: Sink) {
        self.stop();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let (only, grab) = (self.only.clone(), self.grab);
        let t = std::thread::spawn(move || capture(&sink, &flag, only.as_deref(), grab));
        self.run = Some((stop, t));
    }

    fn stop(&mut self) {
        if let Some((stop, t)) = self.run.take() {
            stop.store(true, Ordering::Relaxed);
            let _ = t.join();
        }
    }
}

struct Open {
    dev: Device,
    handle: u64,
    kind: Kind,
    /// Each absolute axis's range.
    ranges: HashMap<u16, (i32, i32)>,
}

/// What a device is: a pad (a south face button and a stick) before a keyboard (letters), else nothing.
pub fn classify(keys: &[u16], abs: &[u16]) -> Option<Kind> {
    let has = |k: u16| keys.contains(&k);
    if (has(0x130) || has(0x120)) && abs.contains(&0) {
        Some(Kind::Pad)
    } else if [16, 17, 30, 31, 32, 44].into_iter().all(has) {
        Some(Kind::Keyboard)
    } else {
        None
    }
}

fn open(
    path: &PathBuf,
    only: Option<&str>,
    grab: bool,
    handle: u64,
) -> Option<(Open, DeviceEvent)> {
    let mut dev = Device::open(path).ok()?;
    let name = dev.name().unwrap_or("Input device").to_owned();
    if only.is_some_and(|o| !name.contains(o)) {
        return None;
    }
    let keys: Vec<u16> = dev
        .supported_keys()
        .map(|k| k.iter().map(KeyCode::code).collect())
        .unwrap_or_default();
    let abs: Vec<u16> = dev
        .supported_absolute_axes()
        .map(|a| a.iter().map(|c| c.0).collect())
        .unwrap_or_default();
    let kind = classify(&keys, &abs)?;
    dev.set_nonblocking(true).ok()?;
    if grab {
        dev.grab().ok()?;
    }
    let ranges = dev
        .get_absinfo()
        .map(|it| {
            it.map(|(c, i): (AbsoluteAxisCode, _)| (c.0, (i.minimum(), i.maximum())))
                .collect()
        })
        .unwrap_or_default();
    let id = dev.input_id();
    let stable = format!(
        "{name}|{}|{}|{:04x}:{:04x}",
        dev.physical_path().unwrap_or(""),
        dev.unique_name().unwrap_or(""),
        id.vendor(),
        id.product()
    );
    let added = DeviceEvent::Added {
        handle,
        stable,
        kind,
        name,
    };
    Some((
        Open {
            dev,
            handle,
            kind,
            ranges,
        },
        added,
    ))
}

/// One evdev event from a device of `kind` to the hub's events.
pub fn translate(
    kind: Kind,
    handle: u64,
    ranges: &HashMap<u16, (i32, i32)>,
    ev: &InputEvent,
) -> Vec<DeviceEvent> {
    let (t, code, value) = (ev.event_type(), ev.code(), ev.value());
    match (kind, t) {
        (Kind::Keyboard, EventType::KEY) if value != 2 => keymap::linux_key(code)
            .map(|c| DeviceEvent::Key {
                handle,
                code: c.into(),
                down: value == 1,
            })
            .into_iter()
            .collect(),
        (Kind::Pad, EventType::KEY) => keymap::linux_pad_button(code)
            .map(|b| DeviceEvent::Button {
                handle,
                button: b,
                down: value != 0,
            })
            .into_iter()
            .collect(),
        (Kind::Pad, EventType::ABSOLUTE) => {
            let (min, max) = ranges.get(&code).copied().unwrap_or((-1, 1));
            match keymap::linux_pad_axis(code) {
                Some(PadAxis::Stick(axis)) => vec![DeviceEvent::Axis {
                    handle,
                    axis,
                    value: keymap::normalise(value, min, max),
                }],
                Some(PadAxis::Trigger(b)) => vec![DeviceEvent::Button {
                    handle,
                    button: b,
                    down: keymap::normalise(value, min, max) > 0.0,
                }],
                Some(PadAxis::HatX) => hat(handle, value, button::LEFT, button::RIGHT),
                Some(PadAxis::HatY) => hat(handle, value, button::UP, button::DOWN),
                None => vec![],
            }
        }
        (Kind::Pad, EventType::SYNCHRONIZATION) if code == 0 => vec![DeviceEvent::Sync { handle }],
        _ => vec![],
    }
}

fn hat(handle: u64, value: i32, neg: u8, pos: u8) -> Vec<DeviceEvent> {
    vec![
        DeviceEvent::Button {
            handle,
            button: neg,
            down: value < 0,
        },
        DeviceEvent::Button {
            handle,
            button: pos,
            down: value > 0,
        },
    ]
}

fn capture(sink: &Sink, stop: &AtomicBool, only: Option<&str>, grab: bool) {
    let mut open_devs: HashMap<PathBuf, Open> = HashMap::new();
    // Nodes that aren't keyboards or pads (or can't be opened), until they disappear.
    let mut ignored: HashSet<PathBuf> = HashSet::new();
    let mut next = 0u64;
    let mut scanned: Option<Instant> = None;
    let mut warned = false;
    while !stop.load(Ordering::Relaxed) {
        if scanned.is_none_or(|t| t.elapsed() >= Duration::from_millis(500)) {
            scanned = Some(Instant::now());
            let present: HashSet<PathBuf> = std::fs::read_dir("/dev/input")
                .map(|d| {
                    d.flatten()
                        .map(|e| e.path())
                        .filter(|p| {
                            p.file_name()
                                .and_then(|n| n.to_str())
                                .is_some_and(|n| n.starts_with("event"))
                        })
                        .collect()
                })
                .unwrap_or_default();
            ignored.retain(|p| present.contains(p));
            let mut unreadable = 0;
            for p in &present {
                if open_devs.contains_key(p) || ignored.contains(p) {
                    continue;
                }
                if std::fs::File::open(p).is_err() {
                    unreadable += 1;
                    continue;
                }
                next += 1;
                match open(p, only, grab, next) {
                    Some((o, added)) => {
                        open_devs.insert(p.clone(), o);
                        if !sink.send(added) {
                            return;
                        }
                    }
                    None => {
                        ignored.insert(p.clone());
                    }
                }
            }
            if unreadable > 0 && open_devs.is_empty() && !warned {
                warned = true;
                eprintln!(
                    "Can't read {unreadable} input device(s): add yourself to the `input` group (sudo usermod -aG input $USER, then log in again)."
                );
            }
        }
        let mut gone = vec![];
        for (path, o) in open_devs.iter_mut() {
            let Open {
                dev,
                handle,
                kind,
                ranges,
            } = o;
            match dev.fetch_events() {
                Ok(events) => {
                    for ev in events {
                        for out in translate(*kind, *handle, ranges, &ev) {
                            if !sink.send(out) {
                                return;
                            }
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => gone.push(path.clone()),
            }
        }
        for p in gone {
            if let Some(o) = open_devs.remove(&p) {
                sink.send(DeviceEvent::Removed { handle: o.handle });
            }
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_keyboards_and_pads() {
        let letters: Vec<u16> = (1..=88).collect();
        assert_eq!(classify(&letters, &[]), Some(Kind::Keyboard));
        assert_eq!(
            classify(&[0x130, 0x131, 0x13b], &[0, 1, 3, 4]),
            Some(Kind::Pad)
        );
        assert_eq!(classify(&[0x110, 0x111], &[]), None, "a mouse is neither");
    }

    #[test]
    fn translates_keys_sticks_triggers_and_hats() {
        let ev = |t: EventType, c: u16, v: i32| InputEvent::new(t.0, c, v);
        let k = translate(
            Kind::Keyboard,
            1,
            &HashMap::new(),
            &ev(EventType::KEY, 17, 1),
        );
        assert_eq!(
            k,
            vec![DeviceEvent::Key {
                handle: 1,
                code: "KeyW".into(),
                down: true
            }]
        );
        assert!(
            translate(
                Kind::Keyboard,
                1,
                &HashMap::new(),
                &ev(EventType::KEY, 17, 2)
            )
            .is_empty(),
            "autorepeat is not an event"
        );
        let ranges = HashMap::from([(0u16, (-32768, 32767)), (2u16, (0, 255))]);
        assert_eq!(
            translate(Kind::Pad, 2, &ranges, &ev(EventType::ABSOLUTE, 0, -32768)),
            vec![DeviceEvent::Axis {
                handle: 2,
                axis: 0,
                value: -1.0
            }]
        );
        assert_eq!(
            translate(Kind::Pad, 2, &ranges, &ev(EventType::ABSOLUTE, 2, 255)),
            vec![DeviceEvent::Button {
                handle: 2,
                button: button::LT,
                down: true
            }]
        );
        assert_eq!(
            translate(Kind::Pad, 2, &ranges, &ev(EventType::ABSOLUTE, 0x11, -1))[0],
            DeviceEvent::Button {
                handle: 2,
                button: button::UP,
                down: true
            }
        );
        assert_eq!(
            translate(Kind::Pad, 2, &ranges, &ev(EventType::KEY, 0x13b, 1)),
            vec![DeviceEvent::Button {
                handle: 2,
                button: button::START,
                down: true
            }]
        );
        assert_eq!(
            translate(Kind::Pad, 2, &ranges, &ev(EventType::SYNCHRONIZATION, 0, 0)),
            vec![DeviceEvent::Sync { handle: 2 }]
        );
    }
}
