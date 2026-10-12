# Local self-review — P1-M-relief / br-xlvx.4 / br-293l

2026-10-12 local real jj-server, generator18 seed7 Rocks. Chromium reports ANGLE Metal Apple M1 Pro; Playwright WebKit reports Apple GPU. This is browser viewport emulation, not a physical phone/TV or Safari. Native and actual WASM-prepared routes match. R90 Place stages the actual seated car; unaided laps are qualified separately by the physical bank. Containing CI and deployed self-review remain required.

## Looked at

- [chromium-climb-412x915.jpg](local-final/chromium-climb-412x915.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [chromium-climb-915x412.jpg](local-final/chromium-climb-915x412.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [chromium-climb-375x667.jpg](local-final/chromium-climb-375x667.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [chromium-climb-1366x768.jpg](local-final/chromium-climb-1366x768.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [chromium-climb-1920x1080.jpg](local-final/chromium-climb-1920x1080.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [chromium-climb-fullscreen-true.jpg](local-final/chromium-climb-fullscreen-true.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [chromium-climb-after-resize.jpg](local-final/chromium-climb-after-resize.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [chromium-crest-1920x1080.jpg](local-final/chromium-crest-1920x1080.jpg): individually inspected the road view, badge/number, footer QR and screen edges; crest falls into the next run; dithered rock shadows retained.
- [chromium-field-around-driver-1920x1080.jpg](local-final/chromium-field-around-driver-1920x1080.jpg): individually inspected the road view, badge/number, footer QR and screen edges; the camera frames the seated driver/props, not the whole course.
- [webkit-climb-412x915.jpg](local-final/webkit-climb-412x915.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [webkit-climb-915x412.jpg](local-final/webkit-climb-915x412.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [webkit-climb-375x667.jpg](local-final/webkit-climb-375x667.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [webkit-climb-1366x768.jpg](local-final/webkit-climb-1366x768.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [webkit-climb-1920x1080.jpg](local-final/webkit-climb-1920x1080.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [webkit-climb-fullscreen-true.jpg](local-final/webkit-climb-fullscreen-true.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [webkit-climb-after-resize.jpg](local-final/webkit-climb-after-resize.jpg): individually inspected the road view, badge/number, footer QR and screen edges; long climb and crest visible with no blank HUD or obscuring input panel.
- [webkit-crest-1920x1080.jpg](local-final/webkit-crest-1920x1080.jpg): individually inspected the road view, badge/number, footer QR and screen edges; crest falls into the next run; dithered rock shadows retained.
- [webkit-field-around-driver-1920x1080.jpg](local-final/webkit-field-around-driver-1920x1080.jpg): individually inspected the road view, badge/number, footer QR and screen edges; the camera frames the seated driver/props, not the whole course.
- [reference-comparison.jpg](local-final/reference-comparison.jpg): inspected the owner Olgas reference beside the actual long-climb view. The generated run rises for a long stretch; the reference is much steeper and has a different art treatment. The candidate keeps its qualified driving envelope; no owner taste verdict is inferred.

## Defects found and fixed

- Initial WebKit screenshots showed near-black docked QR thumbnails. Waiting 1200 ms and changing CSS image sampling did not fix them. An isolated SVG reproduction identified `shape-rendering=crispEdges`; removing it restores the thumbnail's finder squares. Integer module sizing keeps large cards sharp. Compact QR decode/resize and full kit regressions pass.
- Initial WebKit screenshots sometimes captured blank badges during resize. Brush SVGs now declare intrinsic dimensions, and captures await font/image decode and two layout/paint frames. The repeated full matrix has no missing badge; the root cause of the transient first-frame mask painting is not asserted beyond this evidence.
- The old frame name overview incorrectly suggested full-course fitting. The product intentionally frames cars/props when a car is present; the capture now says field-around-driver. Zero-car whole-course review belongs to br-a92v.
- Native Chromium mode silently fell back to SwiftShader. The launch helper now enables the GPU, and captures record the actual renderer. Previous hardware labels are corrected in the churn receipt.

## Remaining defects

None observed in this local matrix. br-293l remains open pending containing CI and deployed repeated-resize qualification. br-a92v retains the complete course-overview contract. Dithered shadows are visible at the crest and retained; no owner taste acceptance is claimed.

## Not covered

Deployed preview, eris browser matrix, physical phones/pads/TV and owner taste review. Full roster and controller-selection journeys remain under their own beads. This local receipt is not the final deployed self-review.
