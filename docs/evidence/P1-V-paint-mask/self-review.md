# P1-V-paint-mask self-review (br-vhtm): the paint key filters correctly

**Change.** The bake stores paint as premultiplied coverage in the atlas alpha (`tools/vehicles/paint-key.mjs`): alpha is the
non-paint coverage, rgb is the livery times that coverage in linear light, and pure paint is (0,0,0,0). The host, the viewer
and the evidence page share one rule (`web/shared/render/paint-key.js`): colour = rgb + (1 − alpha) × tint. A filtered or
mipmapped edge between paint and a stripe therefore blends between the *tinted* paint and the stripe, never toward untinted white.

**How these images were made.** Playwright Chromium, headless, on eris. Before: 0779fd3f (old bakes and the old shader).
After: 4abc1edb / 25c8be6d (bakes and shader from 5b9cd389).
- `*-lod0-<paint>-before-after.png`: the LOD0 row (front, front 3/4, side, rear 3/4) of
  `node tools/vehicles/view/capture.mjs --asset … --sheet ladder --paint '#<paint>'` (software GL). Top half before, bottom half after.
  Seat paints: #2563EB (blue), #2A2D34 (charcoal), #FFD23F (yellow).
- `*-grid-24-{before,after}.png` and `hawk-dash-paints-strip-{before,after}.png`: `node tools/vehicles/evidence/run.mjs <car>` (software GL).
- `host-r13-cars-1-{before,after}.jpg`: the real host page from `web/tests/journeys/r13-identity.test.mjs` (`JJ_CHROMIUM_GPU=native`,
  eris's RTX 2080 Super), one followed Cruz with its seat pattern and roof number.
- `host-mixed-grid-12-{before,after}.png`: the real host page from `web/tests/journeys/v-roster-mixed.test.mjs` (software GL), 12 mixed roster cars.

These are not a real TV or phone. Every image named below was opened and looked at.

## Looked at

- `hawk-dash-lod0-2A2D34-before-after.png`, `hawk-dash-lod0-2563EB-before-after.png`, `hawk-dash-lod0-FFD23F-before-after.png`.
  - Before: every black stripe has a white border, worst on charcoal, where the stripes read as white lines.
  - After: the twin stripes, the side C graphic and its pinstripe are black straight onto the seat colour, with no light line.
- `hawk-dash-grid-24-before.png`, `hawk-dash-grid-24-after.png`.
  - Before: at grid size the twin stripes and the C graphic read light grey or white on every paint.
  - After: they read dark on every paint.
- `hawk-dash-paints-strip-before.png`, `hawk-dash-paints-strip-after.png`.
  - Before: grey and white borders around the bonnet stripes on all six paints.
  - After: black stripes on each paint. The 7 cm roof gap between the stripes blends to a darker tint at this distance, as filtering should.
- `lion-president-lod0-2A2D34-before-after.png`, `lion-president-lod0-2563EB-before-after.png`, `lion-president-lod0-FFD23F-before-after.png`.
  - Before: the pinstripe reads as a cream or white band, which was the fringe.
  - After: it is the thin black-and-gold line the atlas draws. Gold shows on charcoal and blue; on yellow it is a dark line.
- `lion-president-grid-24-before.png`, `lion-president-grid-24-after.png`.
  - Before: a light line along each flank.
  - After: a dark pinstripe line.
- `cruz-missile-lod0-2563EB-before-after.png`, `cruz-missile-lod0-2A2D34-before-after.png`, `cruz-missile-lod0-FFD23F-before-after.png`.
  - Before: the pink and lime slashes have white jagged outlines, most visible on charcoal.
  - After: the slashes meet the paint cleanly. The pale band inside each slash is the livery's own `white` swatch and stays.
- `cruz-missile-grid-24-before.png`, `cruz-missile-grid-24-after.png`.
  - Before: whitish speckle around the slashes.
  - After: none.
- `host-r13-cars-1-before.jpg`, `host-r13-cars-1-after.jpg` (AC3).
  - The R13 stripe pattern shows on the red paint only. It doesn't cover the lamps, the slashes, the glass or the roof number.
  - Before: the slashes on the flank have white jagged edges. After: they don't.
- `host-mixed-grid-12-before.png`, `host-mixed-grid-12-after.png`.
  - Every roster car still draws in its seat colour with its livery: Cruz, Ute, Hawk, Lion and both bikes.
  - The Hawk's (#3) stripes are dark after and light before.

## Defects found and fixed

- The paint-key fringe itself, on every car with livery edges: the Hawk Dash's stripes, the Lion's pinstripe and the Cruz's slashes.
- The first roster test demanded filtered paint edges on every atlas. The bikes' swatch atlases have none, since their cells are
  pixel-aligned. Fixed in 25c8be6d.

## Remaining defects

- The Lion's gold pinstripe is thin, so on a yellow seat it reads as a dark line, not gold. That is the atlas's drawing, which
  the fringe was hiding. Widening it would be a Lion livery change, not part of this bead.
- The Hawk's roof gap between the twin stripes merges into one dark band at grid-24 size. That is correct filtering of a 7 cm
  gap; the contact sheet's twin stripes would need a wider gap to stay separate at that size.

## Not covered

- Safari/WebKit decoding through an HTMLImageElement, which may premultiply on decode: pure paint (0,0,0,0) is immune and edge
  texels are already premultiplied, so only edge rounding can change. The r13 journey's WebKit host shots ran, but nobody
  looked at them closely for edge rounding.
- The picker hero renders (`art/ui/brand/renders/picker/`) weren't re-rendered. Their paint edges show the old fringe until the
  next `capture.mjs --heroes`.
- No real TV or phone.
