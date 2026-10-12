//! wasm-bindgen facade for controllers (P1-N06): input semantics + protocol encoding only — no
//! sim, no renderer (the controller route never downloads the world).
//!
//! The controller app (C02) drives one [`WasmEndpoint`] per connection:
//!
//! 1. `add_source` per joined player on this device (a phone is one; a hub is one per pad).
//! 2. Raw float axes → [`apply_curve`] (the personal preference) → [`quantise`] → `sample`, at
//!    input-event rate; pointercancel / hidden / disconnect / pause → `neutralise`.
//! 3. Actions out of `sample` go to the `cmd` channel via [`encode_action`]; state goes out on
//!    `poll` as encoded `StateBatch`es (60 Hz change / 20 Hz refresh / prompt neutral).
//!
//! Times are JS `performance.now()` milliseconds (monotonic). Sizes: the facade plus `jj-input`
//! plus `jj-protocol` must stay ≤ 150 KB gzipped (plan DEFAULT; measured in
//! `docs/evidence/P1-N06/`).

pub mod cmd;

use jj_input::curve::StickCurve;
use jj_input::scheduler::SendScheduler;
use jj_input::source::{Neutralise, SampleFlags, SourceState};
use jj_protocol::cmd::{ActionKind, ControllerCmd};
use jj_types::{ActionId, LifeId, RoundId, SourceHandle};
use wasm_bindgen::prelude::wasm_bindgen;

/// The crate name and version this module was built from, for the build line in the UI.
#[wasm_bindgen(js_name = buildInfo)]
pub fn build_info() -> String {
    concat!(env!("CARGO_PKG_NAME"), " ", env!("CARGO_PKG_VERSION")).to_owned()
}

/// Quantises one shaped float axis (−1..=1) to the wire's `i16` (returned as `i32` for JS).
#[wasm_bindgen]
pub fn quantise(v: f32) -> i32 {
    i32::from(jj_types::axis::quantise_axis(v))
}

/// Applies the personal response curve to one raw float axis (dead zone + exponent). Apply per
/// axis before quantising; identity (0, 1) is valid.
#[wasm_bindgen]
pub fn apply_curve(v: f32, deadzone: f32, gamma: f32) -> f32 {
    StickCurve { deadzone, gamma }.apply(v)
}

/// Action kinds on the wire, as the facade's small integer tags.
pub const KIND_WHEELIE: u8 = 0;
pub const KIND_UTILITY_FORWARD: u8 = 1;
pub const KIND_UTILITY_REAR: u8 = 2;

/// Neutralisation reasons, as integer tags (`WasmEndpoint::neutralise`).
pub const WHY_POINTER_CANCEL: u8 = 0;
pub const WHY_HIDDEN: u8 = 1;
pub const WHY_DISCONNECTED: u8 = 2;
pub const WHY_PAUSED: u8 = 3;

/// One discrete action detected on a sample: send it as an `Action` command (encode with
/// [`encode_action`]) so a later neutral sample can't erase it.
#[wasm_bindgen]
pub struct WasmAction {
    id: u32,
    kind: u8,
    preload_ms: u16,
    at_source_seq: u16,
}

#[wasm_bindgen]
impl WasmAction {
    #[wasm_bindgen(getter)]
    pub fn id(&self) -> u32 {
        self.id
    }
    /// [`KIND_WHEELIE`], [`KIND_UTILITY_FORWARD`] or [`KIND_UTILITY_REAR`].
    #[wasm_bindgen(getter, js_name = kindTag)]
    pub fn kind_tag(&self) -> u8 {
        self.kind
    }
    #[wasm_bindgen(getter, js_name = preloadMs)]
    pub fn preload_ms(&self) -> u16 {
        self.preload_ms
    }
    #[wasm_bindgen(getter, js_name = atSourceSeq)]
    pub fn at_source_seq(&self) -> u16 {
        self.at_source_seq
    }
}

/// Send reasons, as integer tags (`WasmFlush::reason`).
pub const REASON_PROMPT: u8 = 0;
pub const REASON_CHANGED: u8 = 1;
pub const REASON_REFRESH: u8 = 2;

/// One scheduler flush: the encoded batches to send as separate state-channel messages, in order.
#[wasm_bindgen]
pub struct WasmFlush {
    reason: u8,
    batches: Vec<Vec<u8>>,
}

#[wasm_bindgen]
impl WasmFlush {
    /// [`REASON_PROMPT`], [`REASON_CHANGED`] or [`REASON_REFRESH`].
    #[wasm_bindgen(getter)]
    pub fn reason(&self) -> u8 {
        self.reason
    }
    /// How many batches to send (split by the byte target and the 255-record limit).
    #[wasm_bindgen(getter, js_name = batchCount)]
    pub fn batch_count(&self) -> usize {
        self.batches.len()
    }
    /// Batch `i` as bytes (one message on the state channel).
    #[wasm_bindgen(js_name = batch)]
    pub fn batch(&self, i: usize) -> Vec<u8> {
        self.batches.get(i).cloned().unwrap_or_default()
    }
}

/// One endpoint's sources and their send scheduler: everything a controller connection needs.
#[wasm_bindgen]
pub struct WasmEndpoint {
    sources: Vec<SourceState>,
    /// Per source: the player chose the old one-stick layout (it rides every record's flags; default R116 dual-stick).
    classic: Vec<bool>,
    scheduler: SendScheduler,
    /// The host's tuned input thresholds (br-2sdu.2), if it sent any: every source, now and later, reads them.
    profile: Option<(jj_input::Resolved, String)>,
}

#[wasm_bindgen]
impl WasmEndpoint {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            sources: Vec::new(),
            classic: Vec::new(),
            scheduler: SendScheduler::new(),
            profile: None,
        }
    }

    /// The host changed the input profile (`HostCmd::InputProfile`'s JSON: `InputThresholds`). Validated like the shipped
    /// file; returns false (and keeps the current thresholds) when it is refused. Applies to every source of the endpoint
    /// from its next sample.
    #[wasm_bindgen(js_name = setInputProfile)]
    pub fn set_input_profile(&mut self, json: &str) -> bool {
        let Ok(wire) = serde_json::from_str::<jj_protocol::cmd::InputThresholds>(json) else {
            return false;
        };
        let Ok(p) = jj_input::InputProfile::from_wire(&wire) else {
            return false;
        };
        let resolved = p.resolve();
        for s in &mut self.sources {
            s.set_profile(resolved);
        }
        self.profile = Some((resolved, serde_json::to_string(&p).unwrap_or_default()));
        true
    }

    /// The input profile the sources read now, as the profile file's JSON (`null`-free: the shipped one until the host
    /// tunes it). For the controller's introspection (R90).
    #[wasm_bindgen(js_name = inputProfileJson)]
    pub fn input_profile_json(&self) -> String {
        self.profile.as_ref().map_or_else(
            || serde_json::to_string(&jj_input::InputProfile::standard()).unwrap_or_default(),
            |(_, j)| j.clone(),
        )
    }

    /// Adds a source for a handle the host assigned on claim; returns its index (uncapped).
    #[wasm_bindgen(js_name = addSource)]
    pub fn add_source(&mut self, handle: u16) -> usize {
        let mut src = SourceState::new(SourceHandle(handle));
        if let Some((resolved, _)) = &self.profile {
            src.set_profile(*resolved);
        }
        self.sources.push(src);
        self.classic.push(false);
        self.sources.len() - 1
    }

    /// Chooses the layout for one source: `true` is the old one-stick layout (a personal setting), `false` the R116 default.
    #[wasm_bindgen(js_name = setClassic)]
    pub fn set_classic(&mut self, idx: usize, on: bool) {
        if let Some(c) = self.classic.get_mut(idx) {
            *c = on;
        }
    }

    /// Feeds one quantised sample (post personal curve) at `now_ms` (monotonic). Returns the
    /// actions this sample completed, if any.
    // One flat call per input event across the JS boundary; an options struct would allocate.
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen]
    pub fn sample(
        &mut self,
        idx: usize,
        drive_x: i32,
        drive_y: i32,
        action_x: i32,
        action_y: i32,
        drive_touch: bool,
        action_touch: bool,
        now_ms: f64,
    ) -> Vec<WasmAction> {
        let classic = self.classic.get(idx).copied().unwrap_or(false);
        let Some(src) = self.sources.get_mut(idx) else {
            return Vec::new();
        };
        let flags = SampleFlags {
            available: true,
            drive_touch,
            action_touch,
            menu_open: false,
            classic,
        };
        let clamp16 = |v: i32| v.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
        src.sample(
            [clamp16(drive_x), clamp16(drive_y)],
            [clamp16(action_x), clamp16(action_y)],
            flags,
            now_ms as u64,
        )
        .into_iter()
        .map(|a| WasmAction {
            id: a.action.0,
            kind: match a.kind {
                ActionKind::Wheelie { .. } => KIND_WHEELIE,
                ActionKind::UtilityForward => KIND_UTILITY_FORWARD,
                ActionKind::UtilityRear => KIND_UTILITY_REAR,
            },
            preload_ms: match a.kind {
                ActionKind::Wheelie { preload_ms } => preload_ms,
                _ => 0,
            },
            at_source_seq: a.at_source_seq,
        })
        .collect()
    }

    /// How much of the wheelie launch's cooldown is left at `now_ms`, as a fraction 0..=1 (0: ready): the ring on the left
    /// stick knob (P1-C11).
    #[wasm_bindgen(js_name = launchCooldown)]
    pub fn launch_cooldown(&self, idx: usize, now_ms: f64) -> f64 {
        self.sources.get(idx).map_or(0.0, |s| {
            let (left, total) = s.launch_cooldown(now_ms as u64);
            if total == 0 {
                0.0
            } else {
                left as f64 / total as f64
            }
        })
    }

    /// Neutralises a source (`WHY_*` tag): sticks read neutral, pending detections never fire.
    /// Also marks the endpoint due for a prompt send.
    #[wasm_bindgen]
    pub fn neutralise(&mut self, idx: usize, why: u8) {
        if let Some(src) = self.sources.get_mut(idx) {
            let why = match why {
                WHY_HIDDEN => Neutralise::Hidden,
                WHY_DISCONNECTED => Neutralise::Disconnected,
                WHY_PAUSED => Neutralise::Paused,
                _ => Neutralise::PointerCancel,
            };
            src.neutralise(why);
            self.scheduler.prompt();
        }
    }

    /// The pause menu closed: the source becomes available again.
    #[wasm_bindgen]
    pub fn resume(&mut self, idx: usize) {
        if let Some(src) = self.sources.get_mut(idx) {
            src.resume();
        }
    }

    /// What one source's sticks mean right now (for the controller's light HUD).
    #[wasm_bindgen(js_name = driveSteer)]
    pub fn drive_steer(&self, idx: usize) -> f32 {
        self.sources
            .get(idx)
            .map_or(0.0, |s| s.semantics().drive.steer)
    }
    #[wasm_bindgen(js_name = driveThrottle)]
    pub fn drive_throttle(&self, idx: usize) -> f32 {
        self.sources
            .get(idx)
            .map_or(0.0, |s| s.semantics().drive.throttle)
    }
    #[wasm_bindgen(js_name = driveBrake)]
    pub fn drive_brake(&self, idx: usize) -> f32 {
        self.sources
            .get(idx)
            .map_or(0.0, |s| s.semantics().drive.brake)
    }
    #[wasm_bindgen(js_name = driveReverse)]
    pub fn drive_reverse(&self, idx: usize) -> bool {
        self.sources
            .get(idx)
            .is_some_and(|s| s.semantics().drive.reverse)
    }
    #[wasm_bindgen(js_name = boostHeld)]
    pub fn boost_held(&self, idx: usize) -> bool {
        self.sources.get(idx).is_some_and(|s| s.semantics().boost)
    }
    #[wasm_bindgen(js_name = driftHeld)]
    pub fn drift_held(&self, idx: usize) -> bool {
        self.sources.get(idx).is_some_and(|s| s.semantics().drift)
    }
    #[wasm_bindgen(js_name = wheeliePreload)]
    pub fn wheelie_preload(&self, idx: usize) -> bool {
        self.sources
            .get(idx)
            .is_some_and(|s| s.semantics().wheelie_preload)
    }

    /// Age of the newest sample in ms, or `None` (JS `undefined`-as-NaN) before the first.
    #[wasm_bindgen(js_name = sampleAgeMs)]
    pub fn sample_age_ms(&self, idx: usize, now_ms: f64) -> f64 {
        self.sources
            .get(idx)
            .and_then(|s| s.age_ms(now_ms as u64))
            .map(|a| a as f64)
            .unwrap_or(f64::NAN)
    }

    /// Polls the scheduler at `now_ms`: returns the encoded `StateBatch`es to send on the state
    /// channel, or `null` when nothing is due.
    #[wasm_bindgen]
    pub fn poll(&mut self, now_ms: f64) -> Option<WasmFlush> {
        self.scheduler
            .poll(&self.sources, now_ms as u64)
            .map(|f| WasmFlush {
                reason: match f.reason {
                    jj_input::scheduler::SendReason::Prompt => REASON_PROMPT,
                    jj_input::scheduler::SendReason::Changed => REASON_CHANGED,
                    jj_input::scheduler::SendReason::Refresh => REASON_REFRESH,
                },
                batches: f
                    .batches
                    .iter()
                    .map(|b| {
                        b.encode()
                            .expect("split_into_batches never exceeds the record limit")
                    })
                    .collect(),
            })
    }
}

impl Default for WasmEndpoint {
    fn default() -> Self {
        Self::new()
    }
}

/// Encodes a `ControllerCmd::Action` for the `cmd` channel (ordered, reliable). `kind_tag` is one
/// of the `KIND_*` tags; `round` and `life` echo `RoomState.you`.
#[wasm_bindgen(js_name = encodeAction)]
pub fn encode_action(
    action_id: u32,
    source: u16,
    kind_tag: u8,
    preload_ms: u16,
    round: u32,
    life: u32,
    at_source_seq: u16,
) -> Vec<u8> {
    let kind = match kind_tag {
        KIND_UTILITY_FORWARD => ActionKind::UtilityForward,
        KIND_UTILITY_REAR => ActionKind::UtilityRear,
        _ => ActionKind::Wheelie { preload_ms },
    };
    ControllerCmd::Action {
        action: ActionId(action_id),
        source: SourceHandle(source),
        kind,
        round: RoundId(round),
        life: LifeId(life),
        at_source_seq,
    }
    .encode()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The facade is a thin translation layer; the semantics live in `jj-input` and are property
    /// tested there. Here: the translations round-trip.
    #[test]
    fn actions_translate_and_encode() {
        let bytes = encode_action(7, 3, KIND_WHEELIE, 320, 12, 1, 44);
        let cmd = ControllerCmd::decode(&bytes).expect("decodes");
        match cmd {
            ControllerCmd::Action {
                action,
                source,
                kind,
                round,
                life,
                at_source_seq,
            } => {
                assert_eq!(action, ActionId(7));
                assert_eq!(source, SourceHandle(3));
                assert_eq!(kind, ActionKind::Wheelie { preload_ms: 320 });
                assert_eq!(round, RoundId(12));
                assert_eq!(life, LifeId(1));
                assert_eq!(at_source_seq, 44);
            }
            other => panic!("wrong command: {other:?}"),
        }
    }

    #[test]
    fn an_endpoint_detects_and_sends() {
        // R116 (the default layout): a quick flick up on the right stick fires the forward utility, once.
        let mut ep = WasmEndpoint::new();
        let idx = ep.add_source(5);
        assert_eq!(ep.sample(idx, 0, 0, 0, 0, false, false, 0.0).len(), 0);
        let actions = ep.sample(idx, 0, 0, 0, 32_767, true, true, 30.0);
        assert_eq!(actions.len(), 1, "the flick up fires");
        assert_eq!(actions[0].kind_tag(), KIND_UTILITY_FORWARD);
        // One tap between sends: exactly one action, and the release adds nothing.
        let actions = ep.sample(idx, 0, 0, 0, 0, false, false, 35.0);
        assert_eq!(actions.len(), 0, "the release itself fires nothing");
        let flush = ep.poll(16.0).expect("the initial flush is due");
        assert_eq!(
            flush.batch_count(),
            1,
            "the flush carries the endpoint's sources"
        );
        assert_eq!(flush.batch(0)[0], 0x10, "a StateBatch on the state channel");
        assert_eq!(flush.reason(), REASON_CHANGED);
    }

    #[test]
    fn the_old_layout_is_a_per_source_setting_and_fires_on_entry() {
        let mut ep = WasmEndpoint::new();
        let idx = ep.add_source(5);
        ep.set_classic(idx, true);
        let actions = ep.sample(idx, 0, 0, 0, 32_767, true, true, 0.0);
        assert_eq!(actions.len(), 1, "the old sector fires on entry");
        assert_eq!(actions[0].kind_tag(), KIND_UTILITY_FORWARD);
    }

    #[test]
    fn the_launch_cooldown_reads_as_a_fraction_that_empties() {
        let mut ep = WasmEndpoint::new();
        let idx = ep.add_source(5);
        let mut t = 0.0;
        while t < 500.0 {
            ep.sample(idx, 0, -32_767, 0, 0, true, false, t);
            t += 20.0;
        }
        assert_eq!(ep.launch_cooldown(idx, t), 0.0, "ready before a launch");
        let fired = ep.sample(idx, 0, 32_767, 0, 0, true, false, t + 40.0);
        assert_eq!(fired.len(), 1, "pull then snap launches");
        let full = ep.launch_cooldown(idx, t + 40.0);
        assert!(full > 0.99, "the ring starts full: {full}");
        let half = ep.launch_cooldown(idx, t + 40.0 + 2_000.0);
        assert!(half > 0.4 && half < 0.6, "and empties: {half}");
        assert_eq!(ep.launch_cooldown(idx, t + 40.0 + 5_000.0), 0.0);
    }
}
