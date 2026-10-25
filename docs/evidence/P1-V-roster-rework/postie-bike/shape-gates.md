# Curved helmet-face regression

`art/vehicles/postie-bike/refs/check-shape.mjs` exports `runChecks({modelFile, paramsFile})`.
The unchanged generated rider reference has a face/visor opening which returns around the cheeks into the helmet, rather than the old rectangular skin wafer in front of its shell. Rays through the current skin triangles compare the centre face against both cheeks at the same height. A minimum 1.5 cm return retains that qualitative curvature through faceting; it is not a calibrated anthropometric measurement. Existing reference-envelope tests keep the helmet in its intended location.

Current cheek return is .040/.058/.052 m across the tiers. Actual rejected source has zero return at LOD0/1 and no face at LOD2, so all tiers fail. Missing samples fail explicitly. Reproduce with `node art/vehicles/postie-bike/refs/check-shape.mjs --baseline`; inspect `shape-baseline.json` and the saved actual source in `baseline/`. The reference image hash remains pinned and unchanged.

This check cannot prove visor transparency, visual attachment, every helmet curve or complete likeness. The real-loader close-ups, existing feature gates and source/reference comparison remain necessary. The primary CB50 photo governs the bike's single right exhaust independently of the generated sheet's contradictory pipe cues.
