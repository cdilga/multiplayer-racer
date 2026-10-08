//! The controller's send scheduler (plan §5.4, master §4.4): when the endpoint's state goes out.
//!
//! - **Change flush** at up to 60 Hz: any source whose wire view changed since the last send goes
//!   out as soon as one [`CHANGE_INTERVAL_MS`] has passed (one send per 60 Hz frame; the ceiling is
//!   62.5 Hz at exactly 16 ms polls, still under R80's 2,000 B/s payload budget).
//! - **Refresh** at 20 Hz when nothing changed: unchanged state re-sent so the host always has
//!   fresh samples (it neutralises after 250 ms of silence; 50 ms refresh leaves four-fold margin).
//! - **Prompt**: neutral/cancel/unavailable goes out immediately, bypassing the change interval.
//!
//! A changed-state send satisfies the refresh deadline — there is never a second 20 Hz stream on
//! top of the change stream. Every flush carries **all** of the endpoint's sources; the split into
//! batches (byte target, 255 records, fair rotation) is [`jj_protocol::state::split_into_batches`],
//! and nothing is ever truncated or dropped.

use crate::source::SourceState;
use jj_protocol::state::{
    DEFAULT_BATCH_TARGET_BYTES, SplitOptions, StateBatch, StateRecord, split_into_batches,
};

/// Minimum spacing between change flushes (ms): one per 60 Hz frame (§5.4 "up to 60 Hz").
pub const CHANGE_INTERVAL_MS: u64 = 16;
/// Refresh cadence for unchanged state (ms): 20 Hz (§5.4).
pub const REFRESH_INTERVAL_MS: u64 = 50;

/// Why a flush went out.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SendReason {
    /// A prompt send: state became neutral, cancelled or unavailable (immediate, §5.4).
    Prompt,
    /// At least one source's wire view changed since the last send.
    Changed,
    /// Nothing changed; the 20 Hz refresh deadline arrived.
    Refresh,
}

/// One flush: the reason plus the encoded-ready batches to send on the state channel.
#[derive(Clone, Debug, PartialEq)]
pub struct Flush {
    pub reason: SendReason,
    pub batches: Vec<StateBatch>,
}

/// The per-endpoint send scheduler. Poll it from the controller's frame loop with all of the
/// endpoint's sources.
#[derive(Clone, Debug)]
pub struct SendScheduler {
    batch_seq: u16,
    flush_count: u64,
    last_send_ms: Option<u64>,
    prompt: bool,
    /// What each source looked like when it was last sent, indexed like the `sources` slice.
    last_sent: Vec<Option<WireView>>,
}

impl Default for SendScheduler {
    fn default() -> Self {
        Self::new()
    }
}

/// The parts of a record that count as its state (the `sourceSeq` is a sample identity, not state).
type WireView = ([i16; 2], [i16; 2], u8);

fn view_of(r: &StateRecord) -> WireView {
    (r.drive, r.action, r.flags.0)
}

impl SendScheduler {
    pub fn new() -> Self {
        Self {
            batch_seq: 0,
            flush_count: 0,
            last_send_ms: None,
            prompt: false,
            last_sent: Vec::new(),
        }
    }

    /// Marks the endpoint as due for a prompt send: a source went neutral, was cancelled or became
    /// unavailable since the last poll. The next [`SendScheduler::poll`] flushes immediately.
    pub fn prompt(&mut self) {
        self.prompt = true;
    }

    /// Returns the flush to send now, or `None` when nothing is due. Grows with the source list
    /// (one slot per source; no cap).
    pub fn poll(&mut self, sources: &[SourceState], now_ms: u64) -> Option<Flush> {
        if sources.is_empty() {
            return None;
        }
        if self.last_sent.len() != sources.len() {
            self.last_sent.resize(sources.len(), None);
        }
        let records: Vec<StateRecord> = sources.iter().map(SourceState::record).collect();
        let changed = records
            .iter()
            .zip(&self.last_sent)
            .any(|(r, last)| Some(&view_of(r)) != last.as_ref());

        let since = self
            .last_send_ms
            .map_or(u64::MAX, |t| now_ms.saturating_sub(t));
        let first = self.last_send_ms.is_none();
        let reason = if self.prompt {
            SendReason::Prompt
        } else if since >= CHANGE_INTERVAL_MS && (changed || first) {
            // The first flush is a change flush by definition; `since` is u64::MAX when `first`.
            SendReason::Changed
        } else if !changed && since >= REFRESH_INTERVAL_MS {
            SendReason::Refresh
        } else {
            return None;
        };

        let batches = split_into_batches(
            &records,
            SplitOptions {
                first_batch_seq: self.batch_seq,
                sent_at_ms: now_ms as u16,
                target_bytes: DEFAULT_BATCH_TARGET_BYTES,
                rotate: (self.flush_count as usize) % records.len(),
            },
        );
        self.batch_seq = self
            .batch_seq
            .wrapping_add(batches.len().min(u16::MAX as usize) as u16);
        self.flush_count = self.flush_count.wrapping_add(1);
        self.last_send_ms = Some(now_ms);
        self.prompt = false;
        self.last_sent = records.iter().map(view_of).map(Some).collect();
        Some(Flush { reason, batches })
    }

    /// The reason the next poll would flush (for HUD/debug: "sending because…").
    pub fn next_reason(&self, sources: &[SourceState], now_ms: u64) -> Option<SendReason> {
        let mut probe = self.clone();
        probe.poll(sources, now_ms).map(|f| f.reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::SampleFlags;
    use jj_types::SourceHandle;
    use jj_types::axis::quantise_axis;
    use proptest::prelude::*;

    fn source(handle: u16) -> SourceState {
        SourceState::new(SourceHandle(handle))
    }

    fn on(handle: u16) -> SourceState {
        let mut s = source(handle);
        s.sample([0, 0], [0, 0], on_flags(), 0);
        s
    }

    const fn on_flags() -> SampleFlags {
        SampleFlags {
            available: true,
            drive_touch: false,
            action_touch: false,
            menu_open: false,
            classic: true,
        }
    }

    #[test]
    fn the_first_poll_flushes_the_initial_state() {
        let mut sched = SendScheduler::new();
        let srcs = [on(1)];
        let f = sched.poll(&srcs, 0).expect("initial state goes out");
        assert_eq!(f.reason, SendReason::Changed);
        assert_eq!(f.batches.len(), 1);
        assert_eq!(f.batches[0].records.len(), 1);
    }

    #[test]
    fn cadence_is_60_on_change_and_20_at_rest() {
        let mut sched = SendScheduler::new();
        let mut s = on(1);
        sched.poll(&[s.clone()], 0);

        // Unchanged: quiet until the refresh deadline.
        assert!(sched.poll(&[s.clone()], 16).is_none());
        assert!(sched.poll(&[s.clone()], 49).is_none());
        let f = sched.poll(&[s.clone()], 50).expect("refresh at 20 Hz");
        assert_eq!(f.reason, SendReason::Refresh);
        assert!(
            sched.poll(&[s.clone()], 70).is_none(),
            "refresh resets its own clock"
        );

        // Changed: quiet inside the change interval, then a change flush.
        s.sample([quantise_axis(0.5), 0], [0, 0], on_flags(), 80);
        assert!(
            sched.poll(&[s.clone()], 60).is_none(),
            "not yet: only 10 ms since the refresh"
        );
        let f = sched.poll(&[s.clone()], 66).expect("change flush at 60 Hz");
        assert_eq!(f.reason, SendReason::Changed);
        // …and that change flush satisfied the refresh deadline: no second stream on top.
        let unchanged_until = 66 + REFRESH_INTERVAL_MS - 1;
        assert!(sched.poll(&[s.clone()], unchanged_until).is_none());
        assert_eq!(
            sched
                .poll(&[s.clone()], 66 + REFRESH_INTERVAL_MS)
                .unwrap()
                .reason,
            SendReason::Refresh
        );
    }

    #[test]
    fn a_prompt_send_bypasses_the_change_interval() {
        let mut sched = SendScheduler::new();
        let mut s = on(1);
        sched.poll(&[s.clone()], 0);
        s.neutralise(crate::source::Neutralise::PointerCancel);
        sched.prompt();
        let f = sched
            .poll(&[s.clone()], 5)
            .expect("neutral goes out immediately");
        assert_eq!(f.reason, SendReason::Prompt);
    }

    #[test]
    fn every_flush_carries_every_source_and_splits_fairly() {
        let mut sched = SendScheduler::new();
        // 90 sources × 20 B = 1,800 B > the 1,000 B target: two batches, never truncation.
        let srcs: Vec<SourceState> = (0..90).map(on).collect();
        let f = sched.poll(&srcs, 0).unwrap();
        let total: usize = f.batches.iter().map(|b| b.records.len()).sum();
        assert_eq!(total, 90);
        assert!(f.batches.len() >= 2);
        assert!(f.batches.iter().all(|b| b.records.len() <= 255));
        // The next flush rotates who leads.
        let f2 = sched.poll(&srcs, REFRESH_INTERVAL_MS).unwrap();
        assert_ne!(
            f.batches[0].records[0].source,
            f2.batches[0].records[0].source
        );
        // batchSeq counts up across the flush.
        assert_eq!(
            f2.batches[0].batch_seq,
            f.batches.last().unwrap().batch_seq.wrapping_add(1)
        );
    }

    #[test]
    fn the_wheelie_preload_bit_counts_as_change() {
        let mut sched = SendScheduler::new();
        let mut s = on(1);
        sched.poll(&[s.clone()], 0);
        s.sample([0, quantise_axis(-0.9)], [0, 0], on_flags(), 20);
        let f = sched.poll(&[s.clone()], 36).expect("the flag byte changed");
        assert_eq!(f.reason, SendReason::Changed);
    }

    proptest! {
        // AC5: refresh never stacks on change sends. Over random value/noise patterns:
        // every send is either ≥ CHANGE_INTERVAL_MS after the last and carries a change, or
        // ≥ REFRESH_INTERVAL_MS after the last and carries none.
        #[test]
        fn refresh_never_stacks_on_change_sends(
            events in prop::collection::vec((0u64..40, any::<i16>()), 20..200),
            poll_step in 1u64..8,
        ) {
            let mut sched = SendScheduler::new();
            let mut s = on(1);
            let mut t = 0u64;
            let mut events = events;
            events.sort_by_key(|(dt, _)| std::cmp::Reverse(*dt)); // pop() yields the earliest
            let mut next_event = events.pop();
            let mut last: Option<u64> = None; // time of the last send
            loop {
                if let Some((dt, v)) = next_event
                    && t >= dt
                {
                    s.sample([v, 0], [0, 0], on_flags(), t);
                    next_event = events.pop();
                }
                if let Some(f) = sched.poll(&[s.clone()], t) {
                    let changed = f.reason == SendReason::Changed;
                    if let Some(t0) = last {
                        let gap = t - t0;
                        if changed {
                            prop_assert!(gap >= CHANGE_INTERVAL_MS, "change send {gap} ms after the last");
                        } else {
                            prop_assert!(f.reason != SendReason::Refresh || gap >= REFRESH_INTERVAL_MS,
                                "refresh {gap} ms after the last send");
                        }
                    }
                    last = Some(t);
                }
                t += poll_step;
                if t > 20_000 {
                    break;
                }
            }
            prop_assert!(last.is_some(), "the run sent something");
        }

        // An all-neutral source is refreshed at 20 Hz, not 60.
        #[test]
        fn idle_stream_is_20hz(spans_ms in prop::collection::vec(51u64..500, 3..12)) {
            let mut sched = SendScheduler::new();
            let s = on(1);
            let mut t = 0u64;
            let mut sends = 0u32;
            for span in &spans_ms {
                let until = t + span;
                while t < until {
                    if sched.poll(std::slice::from_ref(&s), t).is_some() {
                        sends += 1;
                    }
                    t += 1;
                }
            }
            // ~20 per second of idle stream, plus the initial; never ~60.
            let total_ms = spans_ms.iter().sum::<u64>();
            let expected = (total_ms / REFRESH_INTERVAL_MS) as u32;
            prop_assert!(sends <= expected + 2, "{} sends over {} ms idle", sends, total_ms);
            prop_assert!(sends >= expected, "refreshes must actually happen");
        }
    }
}
