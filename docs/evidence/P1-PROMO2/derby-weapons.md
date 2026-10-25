# Derby weapon regression (br-r1ma.1)

The real 64-seat host capture reproduced 58 accepted boomerang pickups but zero throws: every use returned `notRacing`. `start_derby` starts its own ledger, while `item_context` only checked the race clock.

The eligibility now uses the active derby ledger when present, retaining the original race conditions otherwise. Spawn protection and the derby end still refuse offensive use. No item/card/physics parameters change.

The new lowest-level simulation regression fails at “an active derby accepts the throw” before the fix. Afterward it verifies a projectile, protection, expired-round refusal and exact journal replay. All 172 jj-sim tests pass, including existing boomerang and item queue suites. RCH refused all workers under critical pressure; these were focused per-crate tests on the Mac under the permitted 15 GiB target budget, not a workspace build.

Rebuilt the testing WASM host and recorded the real 64-car derby in Chromium on the Mac. The first volley in `/tmp/jj-promo-crowd3` accepted and fired 64 boomerangs; later volleys also fired, with visible projectiles and damage. Full state, selected frames and final result accompany the promotional-video receipt. The cohort is a sample, not a limit. Production WASM rebuild and the wider workspace matrix run in CI.
