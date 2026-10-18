//! Each OS's key and pad codes to the browser's names: `KeyboardEvent.code` for keys (layout-independent, as the host's
//! key clusters use) and the Gamepad API's standard mapping for pads. Pure tables, tested on every platform.

/// Linux evdev key codes (`input-event-codes.h`) to `KeyboardEvent.code`. Codes 1..=88 are also PC scan-code set 1,
/// which Windows Raw Input reports (see [`windows_scancode`]).
pub fn linux_key(code: u16) -> Option<&'static str> {
    Some(match code {
        1 => "Escape",
        2 => "Digit1",
        3 => "Digit2",
        4 => "Digit3",
        5 => "Digit4",
        6 => "Digit5",
        7 => "Digit6",
        8 => "Digit7",
        9 => "Digit8",
        10 => "Digit9",
        11 => "Digit0",
        12 => "Minus",
        13 => "Equal",
        14 => "Backspace",
        15 => "Tab",
        16 => "KeyQ",
        17 => "KeyW",
        18 => "KeyE",
        19 => "KeyR",
        20 => "KeyT",
        21 => "KeyY",
        22 => "KeyU",
        23 => "KeyI",
        24 => "KeyO",
        25 => "KeyP",
        26 => "BracketLeft",
        27 => "BracketRight",
        28 => "Enter",
        29 => "ControlLeft",
        30 => "KeyA",
        31 => "KeyS",
        32 => "KeyD",
        33 => "KeyF",
        34 => "KeyG",
        35 => "KeyH",
        36 => "KeyJ",
        37 => "KeyK",
        38 => "KeyL",
        39 => "Semicolon",
        40 => "Quote",
        41 => "Backquote",
        42 => "ShiftLeft",
        43 => "Backslash",
        44 => "KeyZ",
        45 => "KeyX",
        46 => "KeyC",
        47 => "KeyV",
        48 => "KeyB",
        49 => "KeyN",
        50 => "KeyM",
        51 => "Comma",
        52 => "Period",
        53 => "Slash",
        54 => "ShiftRight",
        55 => "NumpadMultiply",
        56 => "AltLeft",
        57 => "Space",
        58 => "CapsLock",
        59 => "F1",
        60 => "F2",
        61 => "F3",
        62 => "F4",
        63 => "F5",
        64 => "F6",
        65 => "F7",
        66 => "F8",
        67 => "F9",
        68 => "F10",
        69 => "NumLock",
        70 => "ScrollLock",
        71 => "Numpad7",
        72 => "Numpad8",
        73 => "Numpad9",
        74 => "NumpadSubtract",
        75 => "Numpad4",
        76 => "Numpad5",
        77 => "Numpad6",
        78 => "NumpadAdd",
        79 => "Numpad1",
        80 => "Numpad2",
        81 => "Numpad3",
        82 => "Numpad0",
        83 => "NumpadDecimal",
        86 => "IntlBackslash",
        87 => "F11",
        88 => "F12",
        96 => "NumpadEnter",
        97 => "ControlRight",
        98 => "NumpadDivide",
        99 => "PrintScreen",
        100 => "AltRight",
        102 => "Home",
        103 => "ArrowUp",
        104 => "PageUp",
        105 => "ArrowLeft",
        106 => "ArrowRight",
        107 => "End",
        108 => "ArrowDown",
        109 => "PageDown",
        110 => "Insert",
        111 => "Delete",
        117 => "NumpadEqual",
        119 => "Pause",
        125 => "MetaLeft",
        126 => "MetaRight",
        127 => "ContextMenu",
        _ => return None,
    })
}

/// A Windows Raw Input keyboard report's make code (scan-code set 1) and its E0 prefix flag.
pub fn windows_scancode(make: u16, e0: bool) -> Option<&'static str> {
    if !e0 {
        // NumLock's make code with E1 is Pause; plain codes match Linux's up to F12.
        return if make <= 88 { linux_key(make) } else { None };
    }
    Some(match make {
        0x1c => "NumpadEnter",
        0x1d => "ControlRight",
        0x35 => "NumpadDivide",
        0x37 => "PrintScreen",
        0x38 => "AltRight",
        0x47 => "Home",
        0x48 => "ArrowUp",
        0x49 => "PageUp",
        0x4b => "ArrowLeft",
        0x4d => "ArrowRight",
        0x4f => "End",
        0x50 => "ArrowDown",
        0x51 => "PageDown",
        0x52 => "Insert",
        0x53 => "Delete",
        0x5b => "MetaLeft",
        0x5c => "MetaRight",
        0x5d => "ContextMenu",
        _ => return None,
    })
}

/// A USB HID keyboard usage (page 0x07), as macOS IOHIDManager reports it.
pub fn hid_usage(usage: u32) -> Option<&'static str> {
    const LETTERS: [&str; 26] = [
        "KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI", "KeyJ", "KeyK",
        "KeyL", "KeyM", "KeyN", "KeyO", "KeyP", "KeyQ", "KeyR", "KeyS", "KeyT", "KeyU", "KeyV",
        "KeyW", "KeyX", "KeyY", "KeyZ",
    ];
    const DIGITS: [&str; 10] = [
        "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9",
        "Digit0",
    ];
    const FKEYS: [&str; 12] = [
        "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
    ];
    const NUMPAD: [&str; 10] = [
        "Numpad1", "Numpad2", "Numpad3", "Numpad4", "Numpad5", "Numpad6", "Numpad7", "Numpad8",
        "Numpad9", "Numpad0",
    ];
    let u = usage as usize;
    Some(match usage {
        0x04..=0x1d => LETTERS[u - 0x04],
        0x1e..=0x27 => DIGITS[u - 0x1e],
        0x28 => "Enter",
        0x29 => "Escape",
        0x2a => "Backspace",
        0x2b => "Tab",
        0x2c => "Space",
        0x2d => "Minus",
        0x2e => "Equal",
        0x2f => "BracketLeft",
        0x30 => "BracketRight",
        0x31 => "Backslash",
        0x33 => "Semicolon",
        0x34 => "Quote",
        0x35 => "Backquote",
        0x36 => "Comma",
        0x37 => "Period",
        0x38 => "Slash",
        0x39 => "CapsLock",
        0x3a..=0x45 => FKEYS[u - 0x3a],
        0x46 => "PrintScreen",
        0x47 => "ScrollLock",
        0x48 => "Pause",
        0x49 => "Insert",
        0x4a => "Home",
        0x4b => "PageUp",
        0x4c => "Delete",
        0x4d => "End",
        0x4e => "PageDown",
        0x4f => "ArrowRight",
        0x50 => "ArrowLeft",
        0x51 => "ArrowDown",
        0x52 => "ArrowUp",
        0x53 => "NumLock",
        0x54 => "NumpadDivide",
        0x55 => "NumpadMultiply",
        0x56 => "NumpadSubtract",
        0x57 => "NumpadAdd",
        0x58 => "NumpadEnter",
        0x59..=0x62 => NUMPAD[u - 0x59],
        0x63 => "NumpadDecimal",
        0x64 => "IntlBackslash",
        0x65 => "ContextMenu",
        0x67 => "NumpadEqual",
        0xe0 => "ControlLeft",
        0xe1 => "ShiftLeft",
        0xe2 => "AltLeft",
        0xe3 => "MetaLeft",
        0xe4 => "ControlRight",
        0xe5 => "ShiftRight",
        0xe6 => "AltRight",
        0xe7 => "MetaRight",
        _ => return None,
    })
}

/// Standard-mapping button indices (W3C Gamepad §"Remapping").
pub mod button {
    pub const SOUTH: u8 = 0;
    pub const EAST: u8 = 1;
    pub const WEST: u8 = 2;
    pub const NORTH: u8 = 3;
    pub const LB: u8 = 4;
    pub const RB: u8 = 5;
    pub const LT: u8 = 6;
    pub const RT: u8 = 7;
    pub const VIEW: u8 = 8;
    pub const START: u8 = 9;
    pub const LS: u8 = 10;
    pub const RS: u8 = 11;
    pub const UP: u8 = 12;
    pub const DOWN: u8 = 13;
    pub const LEFT: u8 = 14;
    pub const RIGHT: u8 = 15;
    pub const HOME: u8 = 16;
}

/// A Linux gamepad button code (`BTN_*`) to its standard-mapping index.
pub fn linux_pad_button(code: u16) -> Option<u8> {
    use button::*;
    Some(match code {
        0x130 => SOUTH,
        0x131 => EAST,
        // BTN_NORTH is 0x133 and BTN_WEST 0x134 (the kernel's gamepad.rst): the top and left face buttons.
        0x133 => NORTH,
        0x134 => WEST,
        0x136 => LB,
        0x137 => RB,
        0x138 => LT,
        0x139 => RT,
        0x13a => VIEW,
        0x13b => START,
        0x13c => HOME,
        0x13d => LS,
        0x13e => RS,
        0x220 => UP,
        0x221 => DOWN,
        0x222 => LEFT,
        0x223 => RIGHT,
        _ => return None,
    })
}

/// What a Linux absolute axis is on a standard pad.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PadAxis {
    /// One of the four standard stick axes (0 left x, 1 left y, 2 right x, 3 right y).
    Stick(usize),
    /// An analogue trigger, reported as its standard button (pressed past half travel).
    Trigger(u8),
    /// A hat's x (left/right buttons) or y (up/down buttons).
    HatX,
    HatY,
}

pub fn linux_pad_axis(code: u16) -> Option<PadAxis> {
    Some(match code {
        0x00 => PadAxis::Stick(0),
        0x01 => PadAxis::Stick(1),
        0x03 => PadAxis::Stick(2),
        0x04 => PadAxis::Stick(3),
        0x02 => PadAxis::Trigger(button::LT),
        0x05 => PadAxis::Trigger(button::RT),
        0x10 => PadAxis::HatX,
        0x11 => PadAxis::HatY,
        _ => return None,
    })
}

/// Generic Desktop usages to standard stick axes: X/Y left; Rx/Ry right, or Z/Rz on pads without them.
pub fn hid_pad_axis(usage: u16, has_rx: bool) -> Option<usize> {
    match (usage, has_rx) {
        (0x30, _) => Some(0),
        (0x31, _) => Some(1),
        (0x33, true) | (0x32, false) => Some(2),
        (0x34, true) | (0x35, false) => Some(3),
        _ => None,
    }
}

/// HID button numbers (page 9, from 1) in Xbox order to standard indices.
pub fn hid_pad_button(n: u16) -> Option<u8> {
    use button::*;
    [SOUTH, EAST, WEST, NORTH, LB, RB, VIEW, START, LS, RS, HOME]
        .get(usize::from(n).checked_sub(1)?)
        .copied()
}

/// A hat value (0 = up, clockwise in eighths; anything else centred) to the d-pad buttons pressed.
pub fn hat_dirs(v: i32) -> [bool; 4] {
    // [up, right, down, left]
    match v {
        0 => [true, false, false, false],
        1 => [true, true, false, false],
        2 => [false, true, false, false],
        3 => [false, true, true, false],
        4 => [false, false, true, false],
        5 => [false, false, true, true],
        6 => [false, false, false, true],
        7 => [true, false, false, true],
        _ => [false; 4],
    }
}

/// A raw axis value in `min..=max` to −1..1.
pub fn normalise(v: i32, min: i32, max: i32) -> f32 {
    if max <= min {
        return 0.0;
    }
    let t = (v.clamp(min, max) - min) as f32 / (max - min) as f32;
    t * 2.0 - 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cluster_keys_map_on_every_os() {
        // Keys A (clusters.json): WASD, T/G, Q/E. Linux and Windows share set-1 codes; HID usages differ.
        let linux = [(17, "KeyW"), (30, "KeyA"), (31, "KeyS"), (32, "KeyD")];
        for (code, name) in linux {
            assert_eq!(linux_key(code), Some(name));
            assert_eq!(windows_scancode(code, false), Some(name));
        }
        assert_eq!(hid_usage(0x1a), Some("KeyW"));
        assert_eq!(hid_usage(0x04), Some("KeyA"));
        assert_eq!(hid_usage(0x60), Some("Numpad8"));
        assert_eq!(linux_key(72), Some("Numpad8"));
        assert_eq!(windows_scancode(0x48, true), Some("ArrowUp"));
        assert_eq!(windows_scancode(0x48, false), Some("Numpad8"));
        assert_eq!(linux_key(103), Some("ArrowUp"));
        assert_eq!(hid_usage(0x52), Some("ArrowUp"));
    }

    #[test]
    fn pad_codes_follow_the_standard_mapping() {
        assert_eq!(linux_pad_button(0x13a), Some(button::VIEW));
        assert_eq!(linux_pad_button(0x13b), Some(button::START));
        assert_eq!(linux_pad_axis(0x03), Some(PadAxis::Stick(2)));
        assert_eq!(normalise(-32768, -32768, 32767), -1.0);
        assert_eq!(normalise(32767, -32768, 32767), 1.0);
        assert!((normalise(128, 0, 255) - 0.0039).abs() < 0.01);
        // Generic HID pads (Windows Raw Input, macOS IOHIDManager).
        assert_eq!(hid_pad_button(1), Some(button::SOUTH));
        assert_eq!(hid_pad_button(8), Some(button::START));
        assert_eq!(hid_pad_button(0), None);
        assert_eq!(hid_pad_axis(0x33, true), Some(2));
        assert_eq!(hid_pad_axis(0x32, false), Some(2));
        assert_eq!(hat_dirs(2), [false, true, false, false]);
        assert_eq!(hat_dirs(8), [false; 4]);
    }
}
