# Vehicle validation · P1-PT-rooftop

PASS for the changed scope: roof-contact physics and the authored kicker's rendering. Cruz Missile source, GLBs,
sidecar, LODs, atlas, identity, damage states, collider proxies and instanced materials are reused unchanged.
`node tools/vehicles/bake.mjs --check` passes reproducibility and contracts. Native/WASM loading, stable roof contact,
four suspension contacts, no wreck and exact replay pass. All Chromium/WebKit roof images were inspected.

Canonical earlier geometry/IoU/identity/damage evidence remains authoritative; no new silhouette or batching cost is
claimed here. Deployed visual review is pending. Generated stunt access is outside this partial validation result and
remains unfinished in the parent bead.
