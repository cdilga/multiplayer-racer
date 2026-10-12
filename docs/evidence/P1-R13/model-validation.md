# Vehicle Model Validation: PENDING deployed gate

Active scope: P1-R13 paint/identity and renderer lifetime. Requirement source: R81/R86, Playtest-1 §6/P1-R13, master §5.1 and §12.3–12.5. Local build based on 8183b70c plus this change.

- PASS local: existing code-built geometry and bake/pivots unchanged (16 checks); no new topology or collider.
- PASS local: atlas white-key paint; one shared material per roster kind; no additional GPU draws or triangles at 1/4/24 tiles.
- PASS local: shared buffers across LOD/live/loose/detached/interior and retained number/paint/model for a withdrawn husk; disposal checked by roster fixture.
- PASS local: final captures show neutral tyres, visible patterns and clear roof numbers, including 24 tiles; CVD sheets include all 60 combinations, wrap and large labels.
- Physics/damage source geometry and profiles are unchanged; existing production receipts retain those results. Dynamic lifetime is not altered.

Remaining blockers: containing green CI; deployed real-room and live-check visual review. Full gate is not yet PASS.
