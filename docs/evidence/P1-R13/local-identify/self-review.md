# Local crowded Identify review — br-p1-r13-ovr

Mac Playwright full Chromium/native GPU selection; real host with synthetic command endpoints (24/120 sample cohorts, not physical phones). The Identity code is from ab11f4f9; terrain tuning is work in progress in this checkout and is not evaluated here. Deployed review remains pending.

## Looked at

- `identify-24.jpg`:1920x1080, inspected #7’s Cooee pulse, own badge and patterned nameplates across24 tiles.
- `identify-108.jpg`:1920x1080, inspected #108’s live Cooee pulse and three-digit badge across120 tiles; the label stays within its tile, no tile is blank.

## Defects found and fixed

The journey waited for any Identify history event, then read the transient DOM in a separate round trip. It now waits for this seat’s own new event and captures pulse, mark and badge geometry atomically. CDP captures the real compositor immediately, without the normal screenshot’s font/layout stability delay consuming the1.6s pulse. All original badge/number/pulse/isolation assertions remain. Two local runs pass; the final capture contains the live #108 pulse.

## Remaining defects

No local defect found in these images. Containing CI and deployed self-review pending.

## Not covered

Physical TV/phones, Safari, deployed assets, GPU-lane timing claims. Synthetic endpoints verify rendering; the separate real identity journey covers WebRTC phones.
