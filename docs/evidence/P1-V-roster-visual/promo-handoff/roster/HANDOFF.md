# Reviewed promo footage handoff

Each of the seven named MP4s contains 1.5 seconds of front three-quarter actual simulated driving, then 1.5 seconds of side view. Existing renderer URL orbit controls are used, with no renderer source edits. Each angle starts from a fresh page/fixture, eliminating previous-vehicle particles.

All footage: 1280×720, H264, 30 fps,90 frames. Source vehicles exactly match f3c175d95ffb7fca22194c90176e93a70652d1f9. Browser bundle revision8b3a9211fcee plus dirty checkout recorded in provenance; server runtime identifies as12f9a6477d2c57199c784ce8ed1d946714661dff. Build manifest SHA256 a0bb11a019c757e20d784cfbef21c5acd2453b8fb4a922facf8ec7e8b0385391. This is deterministic staged capture, not a live frame-rate measurement.

The final bike clips replace initial framing with increased distance and elevated target, keeping helmets and tyres visible through the final editor crop (scale640×360, crop y90→360). Final camera values and video hashes are in roster.json and media-validation.json. The bike-framing directory and initial-framing JSONs retain intermediate provenance.

Visually inspected named-angle-montage.jpg (all seven, two views each), bike front/side samples, and roster-editor-crop-2x2-2.jpg. No blank/wrong models. Body profiles, front bumpers and doors are readable. Natural headlamp/dust particles remain on bike shots; no previous-car dust.

Supplemental rear-only roster: /tmp/jj-promo-roster-reviewed-f3c175d9
Roads: /tmp/jj-promo-roads-reviewed-f3c175d9
Crowd/derby and controller inserts: /tmp/jj-promo-crowd-reviewed-f3c175d9

Crowd uses64 synthetic controller endpoints through the real input path, with actual weapon volleys, dynamic debris and actual round scoring. It is not64 humans or a participant cap. Rivalry remains overview because arena framing takes priority; winner replay has heavy smoke early, clearer later.

Controller phone is fresh from the same build's R90 state opener, without a room connection. Pad and keyboard inserts reuse named committed journey evidence, with both original and output hashes in controllers.json. No new device qualification is claimed.
