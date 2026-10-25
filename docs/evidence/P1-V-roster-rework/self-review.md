# P1-V roster rework self-review

## Looked at
- `docs/evidence/P1-V-roster-rework/local-interactions-contact-1.jpg`: every constituent capture inspected for shape/state, paint, loading and layout.
- `docs/evidence/P1-V-roster-rework/local-interactions-contact-2.jpg`: every constituent capture inspected for shape/state, paint, loading and layout.
- `docs/evidence/P1-V-roster-rework/local-interactions-contact-3.jpg`: every constituent capture inspected for shape/state, paint, loading and layout.
- `docs/evidence/P1-V-roster-rework/local-interactions-contact-4.jpg`: every constituent capture inspected for shape/state, paint, loading and layout.
- `docs/evidence/P1-V-roster-rework/local-interactions-contact-5.jpg`: every constituent capture inspected for shape/state, paint, loading and layout.
- `docs/evidence/P1-V-roster-rework/local-interactions-contact-6.jpg`: every constituent capture inspected for shape/state, paint, loading and layout.
- `docs/evidence/P1-V-roster-rework/local-layout-contact-1.jpg`: every constituent capture inspected for shape/state, paint, loading and layout.
- `docs/evidence/P1-V-roster-rework/local-layout-contact-2.jpg`: every constituent capture inspected for shape/state, paint, loading and layout.
- `docs/evidence/P1-V-roster-rework/local-layout/top-poc_vehicles_375x667.png`: every constituent capture inspected for shape/state, paint, loading and layout.
- `docs/evidence/P1-V-roster-rework/local-layout/top-poc_vehicles_review_html_v_cruz_missile_1920x1080.png`: every constituent capture inspected for shape/state, paint, loading and layout.
- `docs/evidence/P1-V-roster-rework/local-layout/top-poc_vehicles_review_html_v_cruz_missile_412x915.png`: every constituent capture inspected for shape/state, paint, loading and layout.

Per-car self-review.md files enumerate the large shape comparisons, reference sheets, actual-loader LOD ladders, collider overlays, damage, paints and tile grids. Parent personally inspected helper comparisons and sent concrete corrections before accepting outputs.

## Defects found and fixed
Cruz short proportions, flat nose and ramp lamps; sedan cabin/window/shoulder geometry and rear-glass gaps; ute pointed nose and facet mismatch; bike rider/engine/helmet form. New persistent checks reject actual baseline defects. Stale review evidence was replaced alongside assets.

## Remaining defects
The whole-view and coarse-tier limitations in validation.md remain under owner review on br-rgw6. Global silhouette is not uniformly improved. live-check viewport-edge warnings are normal vertical-page clipping; actual controls have no horizontal overflow or missing assets.

## Not covered
Physical devices, exact photographic camera recovery, fresh host GPU/draw-cost and dynamic damage qualification. WebKit is Playwright WebKit, not Safari on a real iPhone. Public-byte and browser verification follows publication.
