# Picture draft self-review P1-PROMO2

Status: **preparation only, not a completed/released trailer**. Owner's later vehicle gate (Agent Mail message 3900, 25 October 10:22 UTC): review the full vehicle rework first, then return to voices/video. Preserve the queued voice work and current edit; no new footage or final publication until the revised models are reviewed. The index still serves the original trailer. This candidate has silent narration placeholders and must not replace it.

## Looked at

- `picture-draft.jpg`: eleven 1280×720 scene samples assembled into a filmstrip. Checked headlines, controller inserts, both named vehicle mosaics, the four-biome montage, real 64-car derby, actual winner and website end card.
- Individually inspected the actual 64-seat lobby, 64-car ring, pileup, both weapon-volley attempts, full results and winner sequences, and the current phone UI. Raw frames remain under `/tmp/jj-promo-crowd*`.
- Individually inspected the committed C08 phone/gamepad and C12 keyboard source images before including them. These are provenance-labelled inserts, not a new hardware/network certification.
- Individually inspected the corrected full-size winner title and card. It names the actual winning seat and damage total from the round data.

## Defects found and fixed

- Derby weapons were all refused as `notRacing`. Fixed in br-r1ma.1 / d8ee872a; 172 simulation tests pass and rebuilt WASM accepts large volleys.
- Early circle poses put some cars outside the bowl. Revised all ring radii so all 64 are clearly in the arena.
- Silent synthetic controllers handed over to autopilot during staged shots. Refresh their real state stream and settle in small steps to preserve intended shot setup.
- The first editorial winner crop assumed a fixed result-card position. The actual game can show highlights there, so the crop contained scenery. Replaced it with a legible editorial card populated from the actual full ranking, seat number and damage points; inspected it again.
- Editor refuses the superseded Qwen manifest. Silent picture review writes only to `/tmp` and cannot overwrite website media.

## Remaining defects

- This draft's vehicle footage predates the owner-requested full roster rework. Recapture the reviewed models before final publication.
- Final Aussie Maya1 v1 takes are queued/owned by the shared audio session. Do not relabel or reuse old Qwen speech. Verify all eleven passing takes, performance, names and spoken URL before the final mix.
- In-game simultaneous launch/landing callouts overlap in the dense pileup. This is visible in real footage; the draft does not pretend otherwise or impose a count limit.

## Not covered

No final audio listening approval, final subtitle timing, new phone/gamepad hardware qualification, final movie playback/seek matrix or updated public deployment is claimed. Fresh Mac Chromium/Chrome local joins with STUN disabled returned ICE no-route; current controller UI state and existing C08/C12 evidence were used as explicitly labelled inserts. Run the index phone/desktop/WebKit/resize/full-screen checks on the finished trailer after the vehicle gate, then update this receipt.
