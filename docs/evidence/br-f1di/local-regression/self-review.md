# Owner-flow local regression review

This supplements the original approved-flow receipt. Local Mac Playwright Chromium/WebKit, based on 8183b70c plus the current changes. Deployed review remains pending.

## Looked at

- `c07-short-landscape-640x300.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `c07-short-landscape-740x360.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `c07-short-landscape-800x300.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `c07-short-landscape-844x340.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `c07-short-landscape-844x390.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-bottom-1366x768.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-bottom-1920x1080.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-bottom-375x667.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-bottom-412x915.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-bottom-915x412.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-cleared-1366x768.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-cleared-1920x1080.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-cleared-375x667.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-cleared-412x915.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-cleared-915x412.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-top-1366x768.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-top-1920x1080.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-top-375x667.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-top-412x915.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `chromium-room-caption-top-915x412.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-bottom-1366x768.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-bottom-1920x1080.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-bottom-375x667.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-bottom-412x915.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-bottom-915x412.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-cleared-1366x768.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-cleared-1920x1080.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-cleared-375x667.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-cleared-412x915.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-cleared-915x412.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-top-1366x768.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-top-1920x1080.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-top-375x667.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-top-412x915.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.
- `webkit-room-caption-top-915x412.jpg`: inspected the final short-phone toolbar or Controllers caption/scroll matrix.

## Defects found and fixed

- Reliable keyboard Ready prevents a held key toggling readiness again during Preparing.
- Short landscape badge/button sizes preserve every toolbar action.
- Caption and footer space is reserved below the menu; page scrolling retains all controller rows.
- Churn exposed the legacy race-time hover fold collapsing controller rows inside the menu. The menu overrides that fold; content does not shrink behind its Back actions. The final behavioral rerun remains pending.

## Remaining defects

- Final churn/access rerun, green CI and deployed capture review pending. No close claimed.

## Not covered

- Physical owner devices and Safari.
- The screenshots were captured before the final hover-fold override; deployment recapture will cover the resulting layout.
