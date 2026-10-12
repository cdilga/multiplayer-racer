# P1-R13 implementation receipt — local checks, not a close receipt

Five patterns are versioned UI data. The vehicle atlas paint key receives the pattern and roof number in the existing shared material; glass, tyres and other atlas regions retain their colours. Identity buffers are shared across LODs and remain on loose/detached parts and husks. HUD, lobby/results badges, phone/hub chips, Identify and other-view/Overview nameplate rings use the same catalogue. Seat combinations wrap without limiting seats; full u32 numbers survive GPU float storage through decimal chunks.

Validation: real Chromium and WebKit identity journeys both pass (`real-identity.txt`; its final cost assertion was subsequently repaired and passed in `draw-check.txt`). The actual material-on/off GPU counters are in `local/draw-counts.json`: 1/4/24 tiles have 38/116/651 total scene draws respectively, unchanged by patterns; triangles are identical too. There is one material per roster model, never per car. Particle effects are disabled only for that isolated comparison. No performance claim is made from this run.

`roster-fixture.txt`: 2 tests pass, including buffer growth, shared LOD attributes/materials, u32 maximum, withdrawn non-default husk identity and resource disposal. `bake.txt`: unchanged Cruz reproducibility/pivots, 16 checks pass. Typecheck passes.

The final 27 local captures were each inspected. Deployed review, containing green CI and a committed final vehicle-validation report remain required; this receipt does not close the bead.
