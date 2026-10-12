# Generated rooftop ramp-foot repair (generator 17)

CI 3621 seed 0 lot 2 failed identically on RCH and in the local per-crate build: release 11.763674 m/s, no roof landing. Ground ray probes differed from bilinear height by millimetres at the foot, ruling out a substantial terrain seam. The Cruz front proxy reaches 2.275 m forward at a minimum height of 0.1377 m; the wheels are at ±1.34 m. The short 2 m concave transition makes the low overhang meet the ramp before suspension lifts it, costing launch speed.

The data now uses a 10 m kicker and 6 m concave blend. Both old and new designs have a 0.3 lip slope (2.1 / (length - blend / 2)); lip height stays 2.1 m, and handling, friction and impulses are unchanged. The gentler foot reduces curvature from 0.15 to 0.05 per metre. Generator version advances to 17 so seed identities do not silently change.

The existing real Rapier/replay sweep is retained, with seed 0 lot 2 named as a regression. `ramp-foot-local.txt`: all 23 declared lots across town seeds 0–9 reach, land and remain on the actual roofs with four contacts, correct grip, no recovery/husk, and matching replay hashes. The repaired lot releases at 16.059341 m/s. A full affected-crate RCH run and deployed visual review remain pending.
