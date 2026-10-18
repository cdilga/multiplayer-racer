//! macOS: IOHIDManager, which reports every HID value with the element and so the device it came from: keyboards
//! (usage page 7) per device, and joysticks/game pads (Generic Desktop 4/5) with no slot limit. Hand-written bindings
//! to IOKit and CoreFoundation (the system frameworks; no crate).
//!
//! Reading keyboards needs the **Input Monitoring** permission: on first capture the helper asks for it
//! (`IOHIDRequestAccess`), macOS shows its prompt, and the helper says where to switch it on if it's refused. The walk-through
//! and the unsigned-binary (Gatekeeper) steps are owner rows in docs/playtests/owner-checklists.md §3.
//!
//! One thread owns the manager on its own run loop, turning it in 50 ms slices so `stop` can end it; stopping closes
//! the manager (every device).
#![allow(unsafe_code)] // FFI to IOKit/CoreFoundation: every call is documented at its use.

use std::collections::HashMap;
use std::ffi::{CString, c_char, c_void};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

use super::{Backend, Sink};
use crate::hub::DeviceEvent;
use crate::keymap::{self, button};
use crate::protocol::Kind;

type Ref = *mut c_void;
type DeviceCb = extern "C" fn(ctx: *mut c_void, result: i32, sender: Ref, device: Ref);
type ValueCb = extern "C" fn(ctx: *mut c_void, result: i32, sender: Ref, value: Ref);

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOHIDManagerCreate(alloc: *const c_void, options: u32) -> Ref;
    fn IOHIDManagerSetDeviceMatching(m: Ref, matching: *const c_void);
    fn IOHIDManagerRegisterDeviceMatchingCallback(m: Ref, cb: DeviceCb, ctx: *mut c_void);
    fn IOHIDManagerRegisterDeviceRemovalCallback(m: Ref, cb: DeviceCb, ctx: *mut c_void);
    fn IOHIDManagerRegisterInputValueCallback(m: Ref, cb: ValueCb, ctx: *mut c_void);
    fn IOHIDManagerScheduleWithRunLoop(m: Ref, rl: Ref, mode: *const c_void);
    fn IOHIDManagerUnscheduleFromRunLoop(m: Ref, rl: Ref, mode: *const c_void);
    fn IOHIDManagerOpen(m: Ref, options: u32) -> i32;
    fn IOHIDManagerClose(m: Ref, options: u32) -> i32;
    fn IOHIDDeviceConformsTo(d: Ref, page: u32, usage: u32) -> u8;
    fn IOHIDDeviceGetProperty(d: Ref, key: *const c_void) -> *const c_void;
    fn IOHIDValueGetElement(v: Ref) -> Ref;
    fn IOHIDValueGetIntegerValue(v: Ref) -> isize;
    fn IOHIDElementGetDevice(e: Ref) -> Ref;
    fn IOHIDElementGetUsagePage(e: Ref) -> u32;
    fn IOHIDElementGetUsage(e: Ref) -> u32;
    fn IOHIDElementGetLogicalMin(e: Ref) -> isize;
    fn IOHIDElementGetLogicalMax(e: Ref) -> isize;
    fn IOHIDCheckAccess(request: u32) -> u32;
    fn IOHIDRequestAccess(request: u32) -> u8;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFRunLoopDefaultMode: *const c_void;
    fn CFRunLoopGetCurrent() -> Ref;
    fn CFRunLoopRunInMode(mode: *const c_void, seconds: f64, return_after_source: u8) -> i32;
    fn CFStringCreateWithCString(alloc: *const c_void, s: *const c_char, enc: u32)
    -> *const c_void;
    fn CFStringGetCString(s: *const c_void, buf: *mut c_char, size: isize, enc: u32) -> u8;
    fn CFGetTypeID(t: *const c_void) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFNumberGetTypeID() -> usize;
    fn CFNumberGetValue(n: *const c_void, ty: isize, out: *mut c_void) -> u8;
    fn CFRelease(t: *const c_void);
}

const UTF8: u32 = 0x0800_0100;
const NUMBER_SINT64: isize = 4;
/// `kIOHIDRequestTypeListenEvent` and `kIOHIDAccessTypeGranted`.
const LISTEN_EVENT: u32 = 1;
const GRANTED: u32 = 0;

pub struct Hid {
    only: Option<String>,
    run: Option<(Arc<AtomicBool>, JoinHandle<()>)>,
}

impl Hid {
    pub fn new(only: Option<String>) -> Self {
        Self { only, run: None }
    }
}

impl Backend for Hid {
    fn start(&mut self, sink: Sink) {
        self.stop();
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let only = self.only.clone();
        let t = std::thread::spawn(move || capture(sink, &flag, only));
        self.run = Some((stop, t));
    }

    fn stop(&mut self) {
        if let Some((stop, t)) = self.run.take() {
            stop.store(true, Ordering::Relaxed);
            let _ = t.join();
        }
    }
}

struct Dev {
    handle: u64,
    kind: Kind,
    /// Seen an Rx/Ry element: the right stick is there, not on Z/Rz.
    has_rx: bool,
}

/// The callbacks' context: lives on the capture thread's stack for the manager's whole life.
struct Ctx {
    sink: Sink,
    only: Option<String>,
    devs: HashMap<usize, Dev>,
    next: u64,
}

fn cf_string(s: &str) -> *const c_void {
    let c = CString::new(s).expect("no NUL");
    // SAFETY: a NUL-terminated UTF-8 string; the caller releases the result.
    unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8) }
}

/// A device property as a string or a number (both rendered as text), if present.
fn property(d: Ref, key: &str) -> Option<String> {
    let k = cf_string(key);
    // SAFETY: `d` is a live IOHIDDevice; the property is borrowed (Get rule), `k` released after.
    let v = unsafe { IOHIDDeviceGetProperty(d, k) };
    unsafe { CFRelease(k) };
    if v.is_null() {
        return None;
    }
    // SAFETY: type-checked before reading.
    unsafe {
        if CFGetTypeID(v) == CFStringGetTypeID() {
            let mut buf = [0 as c_char; 256];
            if CFStringGetCString(v, buf.as_mut_ptr(), buf.len() as isize, UTF8) != 0 {
                return Some(
                    std::ffi::CStr::from_ptr(buf.as_ptr())
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        } else if CFGetTypeID(v) == CFNumberGetTypeID() {
            let mut n = 0i64;
            if CFNumberGetValue(v, NUMBER_SINT64, (&raw mut n).cast()) != 0 {
                return Some(format!("{n:x}"));
            }
        }
    }
    None
}

extern "C" fn matched(ctx: *mut c_void, _r: i32, _s: Ref, device: Ref) {
    // SAFETY: `ctx` is the capture thread's `Ctx`, alive while the manager is scheduled.
    let ctx = unsafe { &mut *ctx.cast::<Ctx>() };
    // SAFETY: `device` is the matched, live device.
    let kind = unsafe {
        if IOHIDDeviceConformsTo(device, 1, 6) != 0 {
            Kind::Keyboard
        } else if IOHIDDeviceConformsTo(device, 1, 5) != 0
            || IOHIDDeviceConformsTo(device, 1, 4) != 0
        {
            Kind::Pad
        } else {
            return;
        }
    };
    let name = property(device, "Product").unwrap_or_else(|| match kind {
        Kind::Keyboard => "Keyboard".into(),
        Kind::Pad => "Pad".into(),
    });
    if ctx.only.as_deref().is_some_and(|o| !name.contains(o)) {
        return;
    }
    let stable = format!(
        "{name}|{}|{}:{}",
        property(device, "LocationID").unwrap_or_default(),
        property(device, "VendorID").unwrap_or_default(),
        property(device, "ProductID").unwrap_or_default()
    );
    ctx.next += 1;
    let handle = ctx.next;
    ctx.devs.insert(
        device as usize,
        Dev {
            handle,
            kind,
            has_rx: false,
        },
    );
    ctx.sink.send(DeviceEvent::Added {
        handle,
        stable,
        kind,
        name,
    });
}

extern "C" fn removed(ctx: *mut c_void, _r: i32, _s: Ref, device: Ref) {
    // SAFETY: as in `matched`.
    let ctx = unsafe { &mut *ctx.cast::<Ctx>() };
    if let Some(d) = ctx.devs.remove(&(device as usize)) {
        ctx.sink.send(DeviceEvent::Removed { handle: d.handle });
    }
}

extern "C" fn value(ctx: *mut c_void, _r: i32, _s: Ref, value: Ref) {
    // SAFETY: as in `matched`; `value` is valid for this call.
    let ctx = unsafe { &mut *ctx.cast::<Ctx>() };
    let (page, usage, v, lo, hi, device) = unsafe {
        let e = IOHIDValueGetElement(value);
        (
            IOHIDElementGetUsagePage(e),
            IOHIDElementGetUsage(e),
            IOHIDValueGetIntegerValue(value) as i32,
            IOHIDElementGetLogicalMin(e) as i32,
            IOHIDElementGetLogicalMax(e) as i32,
            IOHIDElementGetDevice(e),
        )
    };
    let Some(d) = ctx.devs.get_mut(&(device as usize)) else {
        return;
    };
    let handle = d.handle;
    match (d.kind, page) {
        (Kind::Keyboard, 7) => {
            if let Some(code) = keymap::hid_usage(usage) {
                ctx.sink.send(DeviceEvent::Key {
                    handle,
                    code: code.into(),
                    down: v != 0,
                });
            }
        }
        (Kind::Pad, 9) => {
            if let Some(b) = u16::try_from(usage).ok().and_then(keymap::hid_pad_button) {
                ctx.sink.send(DeviceEvent::Button {
                    handle,
                    button: b,
                    down: v != 0,
                });
                ctx.sink.send(DeviceEvent::Sync { handle });
            }
        }
        (Kind::Pad, 1) if usage == 0x39 => {
            let dirs = keymap::hat_dirs(v - lo);
            for (b, on) in [button::UP, button::RIGHT, button::DOWN, button::LEFT]
                .into_iter()
                .zip(dirs)
            {
                ctx.sink.send(DeviceEvent::Button {
                    handle,
                    button: b,
                    down: on,
                });
            }
            ctx.sink.send(DeviceEvent::Sync { handle });
        }
        (Kind::Pad, 1) => {
            // Pads with Rx/Ry put the right stick there; others on Z/Rz (values arrive per element: Rx/Ry once seen).
            d.has_rx |= matches!(usage, 0x33 | 0x34);
            let has_rx = d.has_rx;
            if let Some(axis) = u16::try_from(usage)
                .ok()
                .and_then(|u| keymap::hid_pad_axis(u, has_rx))
            {
                ctx.sink.send(DeviceEvent::Axis {
                    handle,
                    axis,
                    value: keymap::normalise(v, lo, hi),
                });
                ctx.sink.send(DeviceEvent::Sync { handle });
            }
        }
        _ => {}
    }
}

fn capture(sink: Sink, stop: &AtomicBool, only: Option<String>) {
    // SAFETY: plain queries of the TCC state; the request shows macOS's own prompt once.
    unsafe {
        if IOHIDCheckAccess(LISTEN_EVENT) != GRANTED {
            IOHIDRequestAccess(LISTEN_EVENT);
        }
    }
    let mut ctx = Ctx {
        sink,
        only,
        devs: HashMap::new(),
        next: 0,
    };
    let cx: *mut c_void = (&raw mut ctx).cast();
    // SAFETY: the manager lives on this thread and is closed and released before `ctx` goes out of scope.
    unsafe {
        let m = IOHIDManagerCreate(std::ptr::null(), 0);
        if m.is_null() {
            eprintln!("IOHIDManager unavailable; no devices will be read.");
            return;
        }
        IOHIDManagerSetDeviceMatching(m, std::ptr::null());
        IOHIDManagerRegisterDeviceMatchingCallback(m, matched, cx);
        IOHIDManagerRegisterDeviceRemovalCallback(m, removed, cx);
        IOHIDManagerRegisterInputValueCallback(m, value, cx);
        let rl = CFRunLoopGetCurrent();
        IOHIDManagerScheduleWithRunLoop(m, rl, kCFRunLoopDefaultMode);
        if IOHIDManagerOpen(m, 0) != 0 {
            eprintln!(
                "macOS refused access to keyboards: open System Settings > Privacy & Security > Input Monitoring, \
                 switch on jj-input-helper (or the Terminal you ran it from), then pair again."
            );
        }
        while !stop.load(Ordering::Relaxed) {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, 0);
        }
        IOHIDManagerUnscheduleFromRunLoop(m, rl, kCFRunLoopDefaultMode);
        IOHIDManagerClose(m, 0);
        CFRelease(m);
    }
}
