//! The device layer: what every backend reports, turned into per-device state and the page's messages.
//!
//! A backend names each open device by a `handle` (unique while it's open) and a `stable` key (its name, port and ids),
//! so a device unplugged and plugged back in gets its old id, and the page its old source and seat. Two identical
//! devices plugged in at once share a stable key and still get two ids. No count anywhere: ids grow as devices appear.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use crate::protocol::{Device, Kind, ToPage, axis};

/// One thing a backend saw.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "e", rename_all = "lowercase")]
pub enum DeviceEvent {
    Added {
        handle: u64,
        stable: String,
        kind: Kind,
        name: String,
    },
    Removed {
        handle: u64,
    },
    /// A key went down or up (`KeyboardEvent.code`). Repeats are not events.
    Key {
        handle: u64,
        code: String,
        down: bool,
    },
    /// A standard stick axis (0..4), −1..1, y down.
    Axis {
        handle: u64,
        axis: usize,
        value: f32,
    },
    /// A standard-mapping button.
    Button {
        handle: u64,
        button: u8,
        down: bool,
    },
    /// The end of one report from a pad: its frame goes out now if it changed.
    Sync {
        handle: u64,
    },
}

struct State {
    id: u32,
    stable: String,
    kind: Kind,
    name: String,
    connected: bool,
    keys: BTreeSet<String>,
    axes: [f32; 4],
    buttons: u32,
    /// The pad frame last sent (only changes go out).
    sent: Option<([f32; 4], u32)>,
}

#[derive(Default)]
pub struct Hub {
    /// Every device seen, by id (disconnected ones stay so the page shows them unplugged).
    devices: BTreeMap<u32, State>,
    open: HashMap<u64, u32>,
    next: u32,
}

impl Hub {
    pub fn new() -> Self {
        Self::default()
    }

    /// Applies one event; returns the messages it causes.
    pub fn apply(&mut self, ev: DeviceEvent) -> Vec<ToPage> {
        match ev {
            DeviceEvent::Added {
                handle,
                stable,
                kind,
                name,
            } => {
                // The same device back (same stable key, not connected now) gets its id again; else a new id.
                let reuse = self
                    .devices
                    .values()
                    .find(|d| !d.connected && d.stable == stable && d.kind == kind)
                    .map(|d| d.id);
                let id = reuse.unwrap_or_else(|| {
                    self.next += 1;
                    self.next
                });
                self.devices.insert(
                    id,
                    State {
                        id,
                        stable,
                        kind,
                        name,
                        connected: true,
                        keys: BTreeSet::new(),
                        axes: [0.0; 4],
                        buttons: 0,
                        sent: None,
                    },
                );
                self.open.insert(handle, id);
                vec![self.devices_msg()]
            }
            DeviceEvent::Removed { handle } => {
                let Some(id) = self.open.remove(&handle) else {
                    return vec![];
                };
                if let Some(d) = self.devices.get_mut(&id) {
                    d.connected = false;
                    d.keys.clear();
                    d.axes = [0.0; 4];
                    d.buttons = 0;
                    d.sent = None;
                }
                vec![self.devices_msg()]
            }
            DeviceEvent::Key { handle, code, down } => {
                let Some(d) = self.state(handle) else {
                    return vec![];
                };
                let changed = if down {
                    d.keys.insert(code)
                } else {
                    d.keys.remove(&code)
                };
                if changed { vec![keys_msg(d)] } else { vec![] }
            }
            DeviceEvent::Axis {
                handle,
                axis: a,
                value,
            } => {
                if let Some(d) = self.state(handle)
                    && a < 4
                {
                    d.axes[a] = axis(value);
                }
                vec![]
            }
            DeviceEvent::Button {
                handle,
                button,
                down,
            } => {
                if let Some(d) = self.state(handle)
                    && button < 32
                {
                    let bit = 1u32 << button;
                    d.buttons = if down {
                        d.buttons | bit
                    } else {
                        d.buttons & !bit
                    };
                }
                vec![]
            }
            DeviceEvent::Sync { handle } => {
                let Some(d) = self.state(handle) else {
                    return vec![];
                };
                let frame = (d.axes, d.buttons);
                if d.kind != Kind::Pad || d.sent == Some(frame) {
                    return vec![];
                }
                d.sent = Some(frame);
                vec![pad_msg(d)]
            }
        }
    }

    fn state(&mut self, handle: u64) -> Option<&mut State> {
        let id = *self.open.get(&handle)?;
        self.devices.get_mut(&id)
    }

    pub fn devices(&self) -> Vec<Device> {
        self.devices
            .values()
            .map(|d| Device {
                id: d.id,
                kind: d.kind,
                name: d.name.clone(),
                connected: d.connected,
            })
            .collect()
    }

    fn devices_msg(&self) -> ToPage {
        ToPage::Devices {
            devices: self.devices(),
        }
    }

    /// Everything a page that just paired needs: the device list and each connected device's current state.
    pub fn snapshot(&self) -> Vec<ToPage> {
        let mut out = vec![self.devices_msg()];
        for d in self.devices.values().filter(|d| d.connected) {
            out.push(match d.kind {
                Kind::Keyboard => keys_msg(d),
                Kind::Pad => pad_msg(d),
            });
        }
        out
    }

    /// Capture stopped (no paired page): every device is closed, so all read as unplugged until capture resumes.
    pub fn close_all(&mut self) -> Vec<ToPage> {
        if self.open.is_empty() {
            return vec![];
        }
        let handles: Vec<u64> = self.open.keys().copied().collect();
        for handle in handles {
            self.apply(DeviceEvent::Removed { handle });
        }
        vec![self.devices_msg()]
    }

    pub fn counts(&self) -> (usize, usize) {
        let live = |k| {
            self.devices
                .values()
                .filter(|d| d.connected && d.kind == k)
                .count()
        };
        (live(Kind::Keyboard), live(Kind::Pad))
    }
}

fn keys_msg(d: &State) -> ToPage {
    ToPage::Keys {
        id: d.id,
        down: d.keys.iter().cloned().collect(),
    }
}

fn pad_msg(d: &State) -> ToPage {
    ToPage::Pad {
        id: d.id,
        axes: d.axes,
        buttons: d.buttons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add(h: &mut Hub, handle: u64, kind: Kind, stable: &str) -> u32 {
        h.apply(DeviceEvent::Added {
            handle,
            stable: stable.into(),
            kind,
            name: stable.into(),
        });
        h.open[&handle]
    }

    /// AC1 (P1-C12.1): two keyboards and six pads become eight sources, each with its own state; unplugging one leaves
    /// every other device's id, state and messages alone; plugged back in, it gets its id again. (A sample, not a limit.)
    #[test]
    fn two_keyboards_and_six_pads_are_eight_sources_and_unplug_is_isolated() {
        let mut h = Hub::new();
        let mut ids = vec![];
        for k in 0..2 {
            ids.push(add(&mut h, k, Kind::Keyboard, &format!("kbd{k}")));
        }
        for p in 0..6 {
            ids.push(add(&mut h, 10 + p, Kind::Pad, &format!("pad{p}")));
        }
        let distinct: BTreeSet<u32> = ids.iter().copied().collect();
        assert_eq!(distinct.len(), 8, "eight devices, eight ids");
        assert_eq!(h.counts(), (2, 6));

        // Same key on both keyboards: two separate key sets (two players with the same WASD layout).
        let w = |handle| DeviceEvent::Key {
            handle,
            code: "KeyW".into(),
            down: true,
        };
        assert_eq!(
            h.apply(w(0)),
            vec![ToPage::Keys {
                id: ids[0],
                down: vec!["KeyW".into()]
            }]
        );
        assert_eq!(
            h.apply(w(1)),
            vec![ToPage::Keys {
                id: ids[1],
                down: vec!["KeyW".into()]
            }]
        );
        assert_eq!(h.apply(w(1)), vec![], "a repeat changes nothing");

        // Every pad its own frame.
        for p in 0..6u64 {
            h.apply(DeviceEvent::Axis {
                handle: 10 + p,
                axis: 1,
                value: -(p as f32) / 10.0,
            });
            let out = h.apply(DeviceEvent::Sync { handle: 10 + p });
            assert_eq!(
                out,
                vec![ToPage::Pad {
                    id: ids[2 + p as usize],
                    axes: [0.0, -(p as f32) / 10.0, 0.0, 0.0],
                    buttons: 0
                }]
            );
        }
        assert_eq!(
            h.apply(DeviceEvent::Sync { handle: 12 }),
            vec![],
            "unchanged frames stay home"
        );

        // Unplug pad 3: only it goes disconnected; the others keep their state and still report.
        let out = h.apply(DeviceEvent::Removed { handle: 13 });
        let ToPage::Devices { devices } = &out[0] else {
            panic!("{out:?}")
        };
        for d in devices {
            assert_eq!(
                d.connected,
                d.id != ids[5],
                "only the unplugged pad is gone: {d:?}"
            );
        }
        assert_eq!(
            h.apply(DeviceEvent::Axis {
                handle: 13,
                axis: 0,
                value: 1.0
            }),
            vec![]
        );
        assert_eq!(
            h.apply(DeviceEvent::Sync { handle: 13 }),
            vec![],
            "a closed handle says nothing"
        );
        h.apply(DeviceEvent::Button {
            handle: 14,
            button: 9,
            down: true,
        });
        assert_eq!(
            h.apply(DeviceEvent::Sync { handle: 14 }),
            vec![ToPage::Pad {
                id: ids[6],
                axes: [0.0, -0.4, 0.0, 0.0],
                buttons: 1 << 9
            }]
        );
        assert_eq!(h.counts(), (2, 5));
        let snap = h.snapshot();
        assert!(snap.contains(&ToPage::Keys {
            id: ids[1],
            down: vec!["KeyW".into()]
        }));

        // Back in, on a new handle: the same id (the page's same source and seat).
        assert_eq!(add(&mut h, 99, Kind::Pad, "pad3"), ids[5]);
        assert_eq!(h.counts(), (2, 6));
    }

    #[test]
    fn identical_devices_at_once_get_their_own_ids() {
        let mut h = Hub::new();
        let a = add(&mut h, 1, Kind::Keyboard, "same");
        let b = add(&mut h, 2, Kind::Keyboard, "same");
        assert_ne!(a, b);
        h.apply(DeviceEvent::Removed { handle: 2 });
        assert_eq!(add(&mut h, 3, Kind::Keyboard, "same"), b);
        let all = h.close_all();
        let ToPage::Devices { devices } = &all[0] else {
            panic!()
        };
        assert!(devices.iter().all(|d| !d.connected));
    }
}
