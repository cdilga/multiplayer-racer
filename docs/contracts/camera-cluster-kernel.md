# Camera Cluster Kernel Contract

`static/js/geometry/CameraClusterKernel.js` owns the pure host-side grouping step
that decides which cars share a camera before any viewport tiling or live camera
mutation happens.

## Architecture Guard

- Local mode: the host renderer owns full-world camera grouping.
- Local phones and keyboards are controllers or light HUDs only; they do not
  render the world and are not camera-clustering consumers.
- Remote viewers are a separate consumer path that may degrade independently.

## Rules

- Plain data only: arrays, objects, numbers, booleans, strings.
- No `window`, `document`, `THREE`, scene mutation, wall-clock time, or random
  draws.
- Ground-plane distance and pair diagnostics come from
  `measurePairwiseSpawnDistances(...)` in `GeometryKernel.js` rather than a
  duplicate ad hoc distance helper.
- The pure kernel computes natural groups, hysteresis-friendly grouping, and
  budget coarsening. The runtime camera director still owns debounce persistence
  and viewport tiling.

## Public API

- `listCameraClusterModes()`
  - Returns the three locked grouping modes:
    `all-cars-in-view`, `cluster-director`, and `wifes-grid-mode`.
- `listCameraClusterTunables()`
  - Returns host-only tuning descriptors for the debug panel and docs:
    `mergeDist`, `splitDist`, `debounceFrames`, `maxAutoViewports`,
    `importance.carCountWeight`, and `importance.actionWeight`.
- `resolveCameraClusterOptions(options)`
  - Sanitizes runtime input into a deterministic option bundle.
- `buildCameraClusters(cars, options)`
  - Produces `camera-cluster-kernel/v1` output with:
    `architecture`, `options`, `groups`, and machine-readable `diagnostics`.

## Tunable Defaults and Ranges

These are starting points for the host-side camera tuning panel, not final
playtest gospel:

| Tunable | Default | Range | Meaning |
|---|---:|---:|---|
| `mergeDist` | `28` | `8..160` | Ground-plane distance where separate cars/groups merge. |
| `splitDist` | `40` | `10..220` | Hysteresis release distance for previously shared groups. |
| `debounceFrames` | `10` | `0..60` | Frames a cluster-count change should persist before retile. |
| `maxAutoViewports` | `4` | `1..16` | Cluster-director viewport budget before coarsening. |
| `importance.carCountWeight` | `1.0` | `0..4` | Population weight for viewport importance. |
| `importance.actionWeight` | `0.35` | `0..4` | Recent-action bonus for viewport importance. |

## Behavior Notes

- `all-cars-in-view`
  - One shared host cluster containing every active car.
- `cluster-director`
  - Natural single-linkage grouping on ground-plane distances.
  - If natural groups exceed `maxAutoViewports`, nearest/regional merges reduce
    the count while preferring bounded cluster sizes.
  - Previous-group membership can hold a pair together up to `splitDist`, making
    the result safe for runtime hysteresis/debounce handling.
- `wifes-grid-mode`
  - One camera group per player for opt-in per-player follow panes.

## Evidence Hooks

- `groups[*].carIds`
  - Proves no player was dropped.
- `diagnostics.naturalClusterCount` and `diagnostics.finalClusterCount`
  - Show natural grouping versus budget-capped output.
- `diagnostics.mergeHistory`
  - Records each nearest/regional coarsen step.
- `diagnostics.tuningPanelDescriptors`
  - Carries the exact tunable descriptors for later host-side panel wiring.
