//! Windows: Raw Input, which names the device behind every keystroke (`RAWINPUT.header.hDevice`), so two keyboards are
//! two players; and HID game pads (usage page 1, usage 4/5) through the same Raw Input stream, parsed with the HID
//! parser (`HidP_*`), so there is no four-pad XInput limit. Bindings: `windows-sys` (MIT OR Apache-2.0).
//!
//! One thread owns a message-only window registered for keyboards, joysticks and pads with `RIDEV_INPUTSINK` (input
//! arrives while the browser has focus). It drains `WM_INPUT` every 2 ms and diffs `GetRawInputDeviceList` every
//! 500 ms for hotplug. `stop` ends the thread, unregisters and destroys the window. No admin rights, no driver; the
//! keys still reach the browser too (the page ignores its own copy while the helper has keyboards).
//!
//! Pads are mapped heuristically to the standard layout (X/Y left stick, Rx/Ry or Z/Rz right stick, buttons 1-10 in
//! Xbox order, the hat to the d-pad): owner real-device checks are rows in docs/playtests/owner-checklists.md §3.
#![allow(unsafe_code)] // FFI to user32/hid: every call is documented at its use.

use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows_sys::Win32::Devices::HumanInterfaceDevice::{
    HIDP_CAPS, HIDP_STATUS_SUCCESS, HIDP_VALUE_CAPS, HidP_GetCaps, HidP_GetUsageValue,
    HidP_GetUsages, HidP_GetValueCaps, HidP_Input,
};
use windows_sys::Win32::UI::Input::{
    GetRawInputData, GetRawInputDeviceInfoW, GetRawInputDeviceList, RAWINPUTDEVICE,
    RAWINPUTDEVICELIST, RAWINPUTHEADER, RID_DEVICE_INFO, RID_INPUT, RIDEV_INPUTSINK, RIDEV_REMOVE,
    RIDI_DEVICEINFO, RIDI_DEVICENAME, RIDI_PREPARSEDDATA, RIM_TYPEHID, RIM_TYPEKEYBOARD,
    RegisterRawInputDevices,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, DispatchMessageW, HWND_MESSAGE, MSG, PM_REMOVE, PeekMessageW,
    WM_INPUT,
};

use super::{Backend, Sink};
use crate::hub::DeviceEvent;
use crate::keymap::{self, button};
use crate::protocol::Kind;

pub struct RawInput {
    only: Option<String>,
    run: Option<(Arc<AtomicBool>, JoinHandle<()>)>,
}

impl RawInput {
    pub fn new(only: Option<String>) -> Self {
        Self { only, run: None }
    }
}

impl Backend for RawInput {
    fn start(&mut self, sink: Sink) {
        self.stop();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let only = self.only.clone();
        let t = std::thread::spawn(move || capture(&sink, &flag, only.as_deref()));
        self.run = Some((stop, t));
    }

    fn stop(&mut self) {
        if let Some((stop, t)) = self.run.take() {
            stop.store(true, Ordering::Relaxed);
            let _ = t.join();
        }
    }
}

/// A pad's parser state: the HID preparsed data and each value usage's logical range.
struct Pad {
    preparsed: Vec<u8>,
    ranges: HashMap<u16, (i32, i32)>,
    buttons: u32,
}

struct Dev {
    handle: u64,
    kind: Kind,
    pad: Option<Pad>,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The device's interface path (`\\?\HID#VID_046D&PID_C31C…`): the stable key, and the source of its name.
fn device_name(h: *mut c_void) -> String {
    let mut len = 0u32;
    // SAFETY: a null buffer asks for the length in characters.
    unsafe { GetRawInputDeviceInfoW(h, RIDI_DEVICENAME, std::ptr::null_mut(), &mut len) };
    let mut buf = vec![0u16; len as usize + 1];
    // SAFETY: `buf` holds `len` characters.
    let n =
        unsafe { GetRawInputDeviceInfoW(h, RIDI_DEVICENAME, buf.as_mut_ptr().cast(), &mut len) };
    if n == u32::MAX {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
        .trim_end_matches('\0')
        .to_owned()
}

/// "Keyboard (046D:C31C)" from an interface path.
pub fn friendly(kind: Kind, path: &str) -> String {
    let up = path.to_ascii_uppercase();
    let id = |k: &str| {
        up.find(k)
            .map(|i| up[i + k.len()..].chars().take(4).collect::<String>())
    };
    let what = match kind {
        Kind::Keyboard => "Keyboard",
        Kind::Pad => "Pad",
    };
    match (id("VID_"), id("PID_")) {
        (Some(v), Some(p)) => format!("{what} ({v}:{p})"),
        _ => what.to_owned(),
    }
}

fn hid_usage(h: *mut c_void) -> Option<(u16, u16)> {
    let mut info: RID_DEVICE_INFO = unsafe { std::mem::zeroed() };
    info.cbSize = size_of::<RID_DEVICE_INFO>() as u32;
    let mut len = info.cbSize;
    // SAFETY: `info` is a RID_DEVICE_INFO with cbSize set, as RIDI_DEVICEINFO requires.
    let n = unsafe { GetRawInputDeviceInfoW(h, RIDI_DEVICEINFO, (&raw mut info).cast(), &mut len) };
    if n == u32::MAX || info.dwType != RIM_TYPEHID {
        return None;
    }
    // SAFETY: dwType is RIM_TYPEHID, so the union holds `hid`.
    let hid = unsafe { info.Anonymous.hid };
    Some((hid.usUsagePage, hid.usUsage))
}

fn pad_parser(h: *mut c_void) -> Option<Pad> {
    let mut len = 0u32;
    // SAFETY: a null buffer asks for the size in bytes.
    unsafe { GetRawInputDeviceInfoW(h, RIDI_PREPARSEDDATA, std::ptr::null_mut(), &mut len) };
    let mut preparsed = vec![0u8; len as usize];
    // SAFETY: `preparsed` holds `len` bytes.
    let n = unsafe {
        GetRawInputDeviceInfoW(
            h,
            RIDI_PREPARSEDDATA,
            preparsed.as_mut_ptr().cast(),
            &mut len,
        )
    };
    if n == u32::MAX {
        return None;
    }
    let pp = preparsed.as_ptr() as _;
    let mut caps: HIDP_CAPS = unsafe { std::mem::zeroed() };
    // SAFETY: `pp` is this device's preparsed data.
    if unsafe { HidP_GetCaps(pp, &mut caps) } != HIDP_STATUS_SUCCESS {
        return None;
    }
    let mut vcaps: Vec<HIDP_VALUE_CAPS> =
        vec![unsafe { std::mem::zeroed() }; caps.NumberInputValueCaps as usize];
    let mut count = caps.NumberInputValueCaps;
    // SAFETY: `vcaps` holds `count` entries.
    unsafe { HidP_GetValueCaps(HidP_Input, vcaps.as_mut_ptr(), &mut count, pp) };
    let mut ranges = HashMap::new();
    for c in vcaps.iter().take(count as usize) {
        if c.UsagePage != 1 {
            continue;
        }
        // SAFETY: IsRange picks the union member.
        let (lo, hi) = unsafe {
            if c.IsRange {
                (c.Anonymous.Range.UsageMin, c.Anonymous.Range.UsageMax)
            } else {
                (c.Anonymous.NotRange.Usage, c.Anonymous.NotRange.Usage)
            }
        };
        for u in lo..=hi {
            ranges.insert(u, (c.LogicalMin, c.LogicalMax));
        }
    }
    Some(Pad {
        preparsed,
        ranges,
        buttons: 0,
    })
}

fn pad_report(d: &mut Dev, report: &[u8], sink: &Sink) {
    let Some(p) = d.pad.as_mut() else { return };
    let pp = p.preparsed.as_ptr() as _;
    let has_rx = p.ranges.contains_key(&0x33);
    let mut events = vec![];
    for (&usage, &(lo, hi)) in &p.ranges {
        let mut v = 0u32;
        // SAFETY: `report` is one input report of this device; `pp` its preparsed data.
        let st = unsafe {
            HidP_GetUsageValue(
                HidP_Input,
                1,
                0,
                usage,
                &mut v,
                pp,
                report.as_ptr(),
                report.len() as u32,
            )
        };
        if st != HIDP_STATUS_SUCCESS {
            continue;
        }
        let v = v as i32;
        if usage == 0x39 {
            let dirs = keymap::hat_dirs(v - lo);
            for (b, on) in [button::UP, button::RIGHT, button::DOWN, button::LEFT]
                .into_iter()
                .zip(dirs)
            {
                events.push((b, on));
            }
        } else if let Some(axis) = keymap::hid_pad_axis(usage, has_rx) {
            sink.send(DeviceEvent::Axis {
                handle: d.handle,
                axis,
                value: keymap::normalise(v, lo, hi),
            });
        }
    }
    let mut usages = [0u16; 64];
    let mut n = usages.len() as u32;
    // SAFETY: `usages` holds `n` entries.
    let st = unsafe {
        HidP_GetUsages(
            HidP_Input,
            9,
            0,
            usages.as_mut_ptr(),
            &mut n,
            pp,
            report.as_ptr().cast_mut(),
            report.len() as u32,
        )
    };
    let mut pressed = 0u32;
    if st == HIDP_STATUS_SUCCESS {
        for &u in &usages[..n as usize] {
            if let Some(b) = keymap::hid_pad_button(u) {
                pressed |= 1 << b;
            }
        }
    }
    for (b, on) in events {
        pressed = if on {
            pressed | 1 << b
        } else {
            pressed & !(1 << b)
        };
    }
    for b in 0..17u8 {
        let bit = 1u32 << b;
        if (pressed ^ p.buttons) & bit != 0 {
            sink.send(DeviceEvent::Button {
                handle: d.handle,
                button: b,
                down: pressed & bit != 0,
            });
        }
    }
    p.buttons = pressed;
    sink.send(DeviceEvent::Sync { handle: d.handle });
}

fn list() -> Vec<RAWINPUTDEVICELIST> {
    let mut n = 0u32;
    let size = size_of::<RAWINPUTDEVICELIST>() as u32;
    // SAFETY: a null list asks for the count.
    unsafe { GetRawInputDeviceList(std::ptr::null_mut(), &mut n, size) };
    let mut v: Vec<RAWINPUTDEVICELIST> = vec![unsafe { std::mem::zeroed() }; n as usize];
    // SAFETY: `v` holds `n` entries.
    let got = unsafe { GetRawInputDeviceList(v.as_mut_ptr(), &mut n, size) };
    if got == u32::MAX {
        return vec![];
    }
    v.truncate(got as usize);
    v
}

fn register(hwnd: *mut c_void, flags: u32) -> bool {
    let devs = [(1u16, 6u16), (1, 4), (1, 5)].map(|(page, usage)| RAWINPUTDEVICE {
        usUsagePage: page,
        usUsage: usage,
        dwFlags: flags,
        hwndTarget: if flags & RIDEV_REMOVE != 0 {
            std::ptr::null_mut()
        } else {
            hwnd
        },
    });
    // SAFETY: `devs` is an array of RAWINPUTDEVICE.
    unsafe {
        RegisterRawInputDevices(
            devs.as_ptr(),
            devs.len() as u32,
            size_of::<RAWINPUTDEVICE>() as u32,
        ) != 0
    }
}

fn capture(sink: &Sink, stop: &AtomicBool, only: Option<&str>) {
    let class = wide("STATIC");
    let title = wide("jj-input-helper");
    // SAFETY: a message-only window of the system STATIC class, owned by this thread.
    let hwnd = unsafe {
        CreateWindowExW(
            0,
            class.as_ptr(),
            title.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        )
    };
    if hwnd.is_null() || !register(hwnd, RIDEV_INPUTSINK) {
        eprintln!("Raw Input registration failed; no devices will be read.");
        return;
    }
    let mut devs: HashMap<usize, Dev> = HashMap::new();
    let mut ignored: HashSet<usize> = HashSet::new();
    let mut next = 0u64;
    let mut scanned: Option<Instant> = None;
    let mut buf = vec![0u8; 4096];
    let header = size_of::<RAWINPUTHEADER>();
    'run: while !stop.load(Ordering::Relaxed) {
        if scanned.is_none_or(|t| t.elapsed() >= Duration::from_millis(500)) {
            scanned = Some(Instant::now());
            let present = list();
            let live: HashSet<usize> = present.iter().map(|d| d.hDevice as usize).collect();
            ignored.retain(|h| live.contains(h));
            let gone: Vec<usize> = devs.keys().filter(|h| !live.contains(h)).copied().collect();
            for h in gone {
                if let Some(d) = devs.remove(&h) {
                    sink.send(DeviceEvent::Removed { handle: d.handle });
                }
            }
            for d in present {
                let h = d.hDevice as usize;
                if devs.contains_key(&h) || ignored.contains(&h) {
                    continue;
                }
                let kind = if d.dwType == RIM_TYPEKEYBOARD {
                    Some(Kind::Keyboard)
                } else if d.dwType == RIM_TYPEHID
                    && matches!(hid_usage(d.hDevice), Some((1, 4 | 5)))
                {
                    Some(Kind::Pad)
                } else {
                    None
                };
                let path = device_name(d.hDevice);
                let Some(kind) = kind.filter(|_| only.is_none_or(|o| path.contains(o))) else {
                    ignored.insert(h);
                    continue;
                };
                let pad = if kind == Kind::Pad {
                    pad_parser(d.hDevice)
                } else {
                    None
                };
                if kind == Kind::Pad && pad.is_none() {
                    ignored.insert(h);
                    continue;
                }
                next += 1;
                devs.insert(
                    h,
                    Dev {
                        handle: next,
                        kind,
                        pad,
                    },
                );
                if !sink.send(DeviceEvent::Added {
                    handle: next,
                    stable: path.clone(),
                    kind,
                    name: friendly(kind, &path),
                }) {
                    break 'run;
                }
            }
        }
        let mut msg: MSG = unsafe { std::mem::zeroed() };
        // SAFETY: drains this thread's queue without blocking.
        while unsafe { PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
            if msg.message == WM_INPUT {
                let mut size = buf.len() as u32;
                // SAFETY: `buf` holds `size` bytes; lParam is the HRAWINPUT of this WM_INPUT.
                let n = unsafe {
                    GetRawInputData(
                        msg.lParam as _,
                        RID_INPUT,
                        buf.as_mut_ptr().cast(),
                        &mut size,
                        header as u32,
                    )
                };
                if n != u32::MAX && n as usize >= header {
                    let ty = u32::from_le_bytes(buf[0..4].try_into().unwrap());
                    let h =
                        usize::from_le_bytes(buf[8..8 + size_of::<usize>()].try_into().unwrap());
                    if let Some(d) = devs.get_mut(&h) {
                        let body = &buf[header..n as usize];
                        if ty == RIM_TYPEKEYBOARD && d.kind == Kind::Keyboard && body.len() >= 4 {
                            // RAWKEYBOARD: MakeCode u16, Flags u16 (RI_KEY_BREAK 1, RI_KEY_E0 2).
                            let make = u16::from_le_bytes([body[0], body[1]]);
                            let flags = u16::from_le_bytes([body[2], body[3]]);
                            if let Some(code) = keymap::windows_scancode(make, flags & 2 != 0) {
                                sink.send(DeviceEvent::Key {
                                    handle: d.handle,
                                    code: code.into(),
                                    down: flags & 1 == 0,
                                });
                            }
                        } else if ty == RIM_TYPEHID && body.len() >= 8 {
                            // RAWHID: dwSizeHid u32, dwCount u32, then dwCount reports.
                            let each = u32::from_le_bytes(body[0..4].try_into().unwrap()) as usize;
                            let count = u32::from_le_bytes(body[4..8].try_into().unwrap()) as usize;
                            for r in 0..count {
                                let start = 8 + r * each;
                                if let Some(report) = body.get(start..start + each) {
                                    pad_report(d, report, sink);
                                }
                            }
                        }
                    }
                }
            }
            // SAFETY: lets the system clean up WM_INPUT (DefWindowProc via the STATIC class).
            unsafe { DispatchMessageW(&msg) };
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    register(hwnd, RIDEV_REMOVE);
    // SAFETY: the window this thread created.
    unsafe { DestroyWindow(hwnd) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_pad_mapping() {
        assert_eq!(
            friendly(Kind::Keyboard, r"\\?\HID#VID_046D&PID_C31C&MI_00#7&1"),
            "Keyboard (046D:C31C)"
        );
    }
}
