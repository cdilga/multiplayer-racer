Vehicle Model Validation: FAIL for full global likeness qualification; named owner corrective pass and integration checks PASS.

# Six non-Hawk vehicles: parent integration

P1-V-roster-visual / br-8h3u.17, with P1-V-cruz-panels / br-8h3u.16. Hawk Dash remains untouched. This receipt distinguishes completed corrective work from global artistic acceptance. R81/R86/R90, the existing vehicle contracts, original references, qualified budgets and owner observations govern the work. No runtime loader, game renderer, material batching, sound or physics contract changed.

| Vehicle | Final intact triangles0/1/2 |
|---|---:|
|Cruz Missile|2052 / 897 / 590|
|AU Hawk|2096 / 880 / 600|
|Lion President|2321 / 892 / 564|
|Tradie Ute|1770 / 895 / 599|
|Postie Bike|2611 / 899 / 599|
|Pig Catcher|2595 / 898 / 599|

All qualified budgets are unchanged. Each vehicle directory records per-part counts and deterministic bake outputs. Global shared optimiser is reused unchanged; atlas faces/closed tyre shells, hidden-face pruning, fewer redundant layers and selective low-tier mechanics fund panel and silhouette geometry. The physical pivot fixtures record original AU/Lion door attachments exactly instead of moving gameplay hinges to follow new visual bounds; source/sidecar equality and injected drift rejection remain mandatory.

- PASS172 vehicle tests: `vehicle-tests.txt` (bake, material/paint key, mesh optimiser, spec twins, likeness references, original frozen pivots and all new panel regressions).
- PASS six native `jj.vehicle.v1` validations: `contract-check.txt`; per-vehicle deterministic `bake --check` receipts are committed beside their comparisons.
- CI9400 exposed a separate check omitted from that local pass: runtime-profile source-hash synchronization. TurquoiseSnow repaired it in506342b0 under br-dsq4: exactly one `source.lod0_sha256` change per revised profile, every physical/tuning value preserved, Hawk unchanged. All six affected profiles now pass `target/debug/jj validate assets/profiles/<id>.json`; the repair also records full-roster profile/sidecar and600tick settle/replay checks. The validation skill explicitly requires `jj vehicle sync` plus runtime-profile validation after every affected bake; sidecar validation alone is insufficient. The original frozen-file receipt remains evidence of f3c175d9, not a claim that later metadata is byte-identical.
- PASS24 unchanged physics/profile/contract files and39 untouched Hawk Dash files: `frozen-invariants.json` (LFS checked by content SHA).
- PASS all three changed modelling skills validate with skill-creator quick_validate; no references/tolerances/budgets weakened.
- PASS generated seven review pages contain every review-contract item and match source (`review/build.mjs --check`, `review/check.mjs`). Shaded comparison boards are directly visible.
- PASS local phone/TV before/after resize checks: `live-local.txt`. Separate browser fixtures preserve real clipping detection: `scroll-verifier.txt`.
- PASS deployed source integrity: POC run9388 succeeded for f3c175d9; all six deployed LOD0 GLB hashes equal the local bakes (`deployed-hashes.json`). All six model viewers reach ready without uncaught errors, and the shaded comparison images are visible in the inspected phone/TV contacts.
- FAIL automated deployed network smoke: `live-deployed-ready.txt` reports cancelled GLB fetches despite completed viewers. No request-failure rule was suppressed. Details and evidence limits are in `deployment.md`.
- FAIL Lion and both bikes remain below the approximately0.95 global silhouette target; individual validation reports disclose values and remaining form approximations. This corrective pass does not claim full artistic qualification.
- WARN no new handling/host performance/device/debris-lifetime qualification; see `self-review.md` for precise evidence limits.

The trailer handoff must use fresh host builds and these revised GLBs. Australian Maya1 uses the shared aussie-maya1-v1 recipe, with the voice owner maintaining the combined$2 budget. Existing81 Jammers raw clips are cached; the combined cross-project generation estimate is now$0.750426 including the reusable FrankenTTS derivative reference. Heard/transcript QA continues before installation/mux. No final trailer from pre-pass cars is authorised by this receipt.
