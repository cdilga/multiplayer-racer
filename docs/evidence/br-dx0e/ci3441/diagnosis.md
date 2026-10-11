# CI3441 WebKit pixel comparison

The retained visible/hidden pair comes from GPU job7752 at 86bda2e1. The caption was empty. The drawer ends at y947.421875; the sampled strip is y956–980. It changed 273/11136 pixels. Looking at the amplified strip shows scattered ground-grit differences, not an opaque spill.

Pillow comparison also finds 682/18560 changed pixels at x16–480/y980–1020, 953/32000 at x600–1000/y900–980, and 10976/120000 at x700–1100/y500–800. Those latter regions are outside the drawer's influence. The two captures did not hold the same rendered world: the sim hold leaves the overview camera easing in the frame loop.

The regression now uses the existing `__jjRender.hold()` capture hook after an explicit frame, freezing the canvas for the visible/hidden pair. Subsequent samples explicitly draw again so viewport changes reach the backing store. The frame/shadow exclusion, colour tolerance and <1% threshold are unchanged. Focused Mac Chromium and WebKit: both passed, 25.11 seconds. Eris and CI validation remain required.

Inspected: the full visible PNG and the side-by-side amplified strip PNG. These exact lossless PNGs and the metadata preserve the failing comparison. This diagnoses the residual CI test difference; the original overflow compositor defect and its product repair are established in the earlier receipt.
