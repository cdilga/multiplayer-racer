# Vehicle validation · P1-R09

PASS for the scope changed: recorded vehicle identity/paint/damage presentation and a separate replay world's lifecycle.
Canonical code-built meshes, baked contracts, colliders, LODs and materials are reused unchanged. The reproducible bake
and contract check passes (`vehicle-contract.log`). This is not a new silhouette or model performance measurement.

The real two-car replay was inspected in Chromium and WebKit at laptop, TV, small/large portrait phone and landscape
sizes, including fullscreen attempts and resize. Red Roo and blue Gazza retain their numbers, names and paint; separate
damage states/debris are reconstructed from complete frames. The camera follows each event subject. Hide disposes the
replay renderer while cached vehicle assets remain cache-owned; the live scene and hash remain unchanged.

Earlier model acceptance remains canonical for geometry/IoU/LOD cost. No spike performance numbers are presented as
measurements from this bead. Deployed visual checks remain required before close.
