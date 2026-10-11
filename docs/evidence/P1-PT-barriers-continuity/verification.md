# P1-PT-barriers-continuity

Child br-gw74.9.1 establishes geometry and validation. The parent br-gw74.9 retains compliant contact, steering help, damage protection, low-speed use, glancing blows, deterministic deflection and the speed/angle sweep. This child does not qualify those behaviours.

Root cause: fixed 4 m sections were centred at sampled route points. Outer-bend spacing differs from route arc spacing, leaving holes between sections. The previous validator looked near only the beginning, middle and end of each corner, so a nearby section could hide a gap.

Generated rails now join consecutive outside-edge endpoints. Each section's pose/length is derived from those endpoints, with 20 mm overlap for joints and integer-mm/yaw rounding. All sections remain Australian W-beam on posts (R105); no tyre wall substitution, count caps or dropped sections.

The wayfinding validator clips every outside-edge segment against the oriented rendered W-beam strips, unions coverage intervals and measures uncovered length. It uses the beam's 0.14×thickness profile width, not the larger post/collision box. It rejects gaps above 5 mm with 2 mm rounding allowance per strip. That is stricter than the inherited minimum of no gap longer than one section.

Validation:
- Re-ran the new coverage fixture with the old placement: it failed on the original generated map before defect injection.
- Joined placement: deleting the longest rail section or shortening it to 1 m both produce rejected gaps.
- Seed/recipe sweep with all waypoint/corner checks: 7 passed before refreshing goldens.
- Generator 12; updated seed and recipe goldens.
- Final RCH on eris: biome 8, biomes 5, procgen 5, signs 10 passed, 0 failures.
- Procgen WASM rebuilt through RCH; web built fresh.
- Actual generated round/chase journey passed in 17.62 s. All 7 phone/laptop/TV/fullscreen frames inspected.

The captured map has 160 joined sections versus 101 before; instancing still uses 90 draw calls in this one-car sample. These are measured samples, not limits. Renderer/browser/hardware and journaled placement are in frames/browser-run.json.

An initial capture used stale web/dist and still showed 101 sections. That exposed a harness trap: building the isolated kit did not rebuild the live pages. The capture test now builds fresh live pages unless JJ_DIST explicitly supplies a build. Only fresh 160-section captures are the after evidence.

Deployed preview check pending publication before close. Collision compliance is unfinished parent work, not a human blocker.
