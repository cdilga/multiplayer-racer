# br-b8lp: initial ICE recovery

The product had no recovery deadline for an initial connection. Recovery watched `disconnected`/`failed` and closed channels, but a missing TURN allocation can leave ICE and the peer connection `new`, with stable signalling and connecting channels. The Cloudflare request may return 503; that does not recover the original coturn path.

Captured reproduction: a UDP forwarding proxy drops the first TURN Allocate transaction (STUN type 0x0003) and every retransmission of that transaction. Other transactions pass. Each browser client has its own forwarding socket, preserving coturn's allocation 5-tuple. The host talks directly to the real coturn; only the controller goes through the proxy.

- Before: 7 dropped requests across 20 seconds, ICE/PC `new`, stable signalling, one registration, zero restarts/rebuilds. The connection deadline failed. See lost-allocate-before.json for coturn output and browser event timeline.
- After: 6 dropped requests, automatic ICE restart at 8 seconds, fresh Allocate transactions, both channels open and relayed gameplay observed at 8,219 ms. One registration, one restart, zero rebuilds. See lost-allocate-after.json. Selected path is relay/relay, coturn-relay UDP.
- Stated test bound: 20 seconds including browser navigation, signalling and recovery; watchdog starts recovery at 8 seconds, existing rebuild follows after 5 more if needed. Measured recovery here is 8.2 seconds.
- A separately lost initial signalling offer also recovers on the same endpoint at 8.3 seconds.
- All 25 shared transport tests passed with local coturn required, including WebKit, reconnect, server restart, credential refresh, lazy fallback and fallback merge. Fresh-controller retry wrappers are removed.

Build based on db7561e2 with the watchdog and tests; Mac arm64, Chromium 151.0.7922.34 and Playwright WebKit; coturn 4.18.0; real Rust server. Loopback test, not physical-device/WAN qualification. Only event/receipt diagnostics are collected; no product per-tick logs.

The original intermittent CI runs did not retain a packet trace. This demonstrates the product failure and recovery for the suspected allocation-loss class; it does not claim to identify the exact packet lost in those historic runs. Future connect failures now emit link state instead of silently replacing the controller. This is a product repair, not a harness-only defect; the harness-only conditional acceptance row is inapplicable.

No gameplay count limits, queues or WSS input fallback were introduced.
