# Current-form regression checks

`art/vehicles/pig-catcher/refs/check-shape.mjs` exports `runChecks({modelFile, paramsFile})`.
The oracle is the unchanged side sheet, whose lower engine casting loses width towards its bottom and whose shirt centreline is nearly upright. These are local shape envelopes rather than a claim of camera-calibrated dimensions.

The engine gate selects actual engine-swatch triangles, takes horizontal sections at 7%, 10% and 13% of their height, and limits mean width to 82% of the widest section. The old casting remains full-width at its bottom (1.0) and fails every tier; current rounded castings measure .608/.514/.310. The shirt gate takes current front/back centreline intersections at 1.22 and 1.50 m. A slope below .25 allows about 14 degrees of lean and faceting uncertainty. The actual old source measures .365/.326/.326 and fails; current source measures .172/.171/.171.

The baseline is actual rejected source, not an import error or synthetic parameter assertion. Reproduce with `node art/vehicles/pig-catcher/refs/check-shape.mjs --baseline`; inspect `shape-baseline.json` and the saved source under `baseline/`. Current geometry passes at every tier. The script pins the original reference hash. These local gates supplement the existing mask/camera/helmet/negative-space gates and renderer inspection; they do not certify every engine detail or human pose.
