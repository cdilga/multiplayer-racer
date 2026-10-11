# Self-review br-61po

## Looked at

The earlier image-by-image review is in [P1-R09 self-review](../P1-R09/self-review.md).
Additionally inspected every image in `long-preview-qr/chromium` and `long-preview-qr/webkit`
(16 each: five viewports and their fullscreen attempts, three damage subjects, Hide, two controllers),
and all four `long-preview-qr/live-check` images (375x667 and 1920x1080, before/after resize).
Rows, names, points, QR and real actions are legible and separate; damage subjects have their
correct labels. The dense-QR fixture retains finish times. Its empty caption band is reserved
space, not rendered caption evidence; the WebKit real journey shows captions.

## Defects found and fixed

Timer widths moved Start; compact QR/action sizing squeezed rows; caption/drawer collisions.
Deployed preview review exposed a second narrow-screen squeeze with the long join URL; the
44/56 portrait split and long-URL regression fix it. Measured before: 10.2703px; all revised
focused/real journey assertions pass >=12px. The real roster-churn click passes with its existing
30s timeout (`roster-churn.log`).

## Remaining defects

No unresolved local defect in judged states. Containing green CI and deployed recapture of
the latest correction remain pending.

## Not covered

Physical devices, Safari, WAN TURN and GPU performance. Deployed preview v02-cc9b2c81 was
reviewed; the latest correction awaits publication. Headless fullscreen requests are attempts.
