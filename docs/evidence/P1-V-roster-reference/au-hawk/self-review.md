# AU Hawk: visual self-review

Bead br-rgw6; 2026-10-25. Working-tree build over `9388bd30581aca3647ddfa95649d589ef54727b5`; Mac headless Playwright Chromium 151.0.7922.34/software WebGL.

The vehicle-specific fit, GLTFLoader and shared-parts-renderer capture tools were used because these changes are vehicle source meshes rather than UI routes. The parent owns design-site/host integration. This receipt does not claim a phone, Safari, physical TV, host game or hardware performance run.

Inspected individually: both authoritative sheets; `before-lod0/sheet.png`, `before-lod1/sheet.png`, `before-lod2/sheet.png`; all three `after-lodN/sheet.png`; their horizontal front/rear diagnostic heroes; `rear-review.png`; and every `loader/` PNG (`views`, `paints`, `lods`, `colliders`, `damage-strip`, `damage-strip-overview`, `paints-strip`, `grid-1`, `grid-4`, `grid-24`). The final AU refresh was inspected after the extra LOD1 arch station was baked. All scenes load, the contact-sheet views are framed, and the reviewed captures have no blank tiles or missing resources.

The AU keeps the long rounded sedan, tall glasshouse, swept teardrop headlamps and oval grille. The most useful fixes were the disconnected lamp/decal facets, the flank roll at raised arch crowns, and the lower bumper substrate. Decals now clip to actual body triangles rather than an independent grid. The nose underside was lowered to support the slot and fog lamps at LOD0/1. The cabin dimensions were retained after an unhelpful roof experiment. LOD1 uses an extra arch station to avoid a triangular crown. Five thin silver spokes replace the repeated thick wheel geometry at LOD0/1; LOD2 uses the simple silver discs in its lowest-tier sheet.

The paint sheets keep lamps/glass/tyres neutral as body colour changes. Loose poses follow preserved hinges; missing front/rear/doors expose dark bays. The coarse tiers preserve the main recognition cues but visibly simplify wheels, guards and small graphics. Grid captures show colour/LOD continuity; roof numbers and HUD are absent in that viewer and remain unproven here.

The generated reference includes a wing. The established deliberate base-sedan no-wing interpretation is retained, so this is not a literal match to that accessory. LOD2 loses the fog/slot detail and has deliberately coarse guards and disc wheels. The small blank rear badge remains partly occluded at some coarse views. At LOD2, tiny body-colour pixels can appear in the glass region in the tilted grid view; this is visible in grid-4/grid-24 and has not been claimed fixed. The roof/window treatment remains more angular than the sheet.

The weighted/per-view gains and regressions, reference uncertainty, exact physics preservation, defect sensitivity and all remaining production gates are recorded in [validation.md](validation.md). The candidate is ready for parent integration and owner visual review; this is a bounded visual review, not a blanket production PASS.
