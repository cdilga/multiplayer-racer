# Identify snapshot ordering — local self-review

## Looked at

Mac, Playwright native Chromium (GPU), candidate after 5d9160ba, real local Rust server. Inspected identify-24.jpg and identify-108.jpg in this directory. Both show the correct isolated tile pulse and Cooee label; #108 is readable inside the three-digit tile. Billboard identity appears over the target car in views that can see it. These are browser viewport samples, not physical-device evidence.

## Defects found and fixed

GPU CI3651 found a live tile pulse with no billboard. A reliable Identify event can reach main before the new car is present in the interpolated snapshot. IdentifyMarks previously disposed the mark on that older snapshot. It now keeps it pending until its car arrives or the normal flash expires. Introspection reports visible sprites; the real journey observes the visible billboard and tile pulse together, preserving isolation/clipping assertions. The CDP capture session is opened before the press to avoid a session handshake spending the short transient.

The first local run passed state assertions but its 120-seat image missed the transient. Repeated isolated capture with the pre-opened session passed and visibly captured #108. The receipt records the final run: 1/1, 165s, cohorts 24 and 120 (samples, no player cap).

## Remaining defects

None observed in these two final captures. Crowded tiles still use the existing automatic render resolution; this receipt does not claim performance qualification.

## Not covered

Containing green GPU CI and deployed review are still required. Physical phones, laptop-to-TV output and actual gamepads are not covered here.
