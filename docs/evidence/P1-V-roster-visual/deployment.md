# Deployed corrective vehicle pass

Source f3c175d95ffb7fca22194c90176e93a70652d1f9; Gitea POC deploy9388 completed successfully. Public review route: https://jammers-preview.dilger.dev/poc/vehicles/ . Checked on the repository Mac with Playwright Chromium151.0.7922.34, software rendering, 25 October2026. No deployment workflow or verifier network rule was changed.

The first `live-deployed.txt` run checks800ms after load. This page builds asynchronously after token, module and JSON requests, so many images were still pending; it even briefly remained at Loading. Those initial missing-image observations do not establish missing deployed files. Their log is retained, but scratch screenshots from that premature sample are not qualification evidence.

The second run uses the existing explicit readiness option:

```sh
node art/ui/lib/live-check.mjs --viewports 412x915,1920x1080 --fullscreen --ready '#msg[hidden]' --out docs/evidence/P1-V-roster-visual/live-deployed-ready '/poc/vehicles/review.html?v=cruz-missile' '/poc/vehicles/review.html?v=au-hawk' '/poc/vehicles/review.html?v=lion-president' '/poc/vehicles/review.html?v=tradie-ute' '/poc/vehicles/review.html?v=postie-bike' '/poc/vehicles/review.html?v=pig-catcher'
```

All twelve cases reach model readiness, show no missing-image/clipping/blank-canvas errors and produce before/after-resize captures. They still FAIL on a cancelled GLB request. The underlying browser CDP event is HTTP200 followed by `Network.loadingFailed`, `net::ERR_ABORTED`, `canceled:true`, on the GLB fetch; the observed response used HTTP3. GLTF parsing nevertheless completes, controls are installed and the model is rendered. A separate browser-context download of each of the six GLBs returns200 and matches the local file SHA256 and byte length (`deployed-hashes.json`). The cancellation cause is not established; an attempted HTTP2 diagnostic did not reach readiness in30s and does not qualify any alternate transport.

`deployed-viewers.json` records six ready markers/no uncaught errors. Its image booleans were sampled immediately at model readiness and remain false: that diagnostic was intended to capture the viewer, not to wait for every image. The complete-page readiness smoke above subsequently checks those images and retains the actual remaining network failure. Six dedicated `viewer-*.png` crops and the two phone/TV contacts were visually inspected. Local full readiness checks remain green. Deployed content integrity and visible rendering pass; automated deployed network smoke remains unresolved and must not be described as green.
