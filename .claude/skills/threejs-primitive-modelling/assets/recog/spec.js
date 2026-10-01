// spec.js — the Cruze's RECOGNITION invariants, measured from the orthographic references (recog/measure_side.py and the
// metric-grid overlays grid_front.png / grid_rear.png), then mapped into the toy's proportions.
//
// Rule for this asset: the things people use to recognise the car are copied from the reference and only *scaled*, never
// re-styled. Cuteness comes from proportion (bigger wheels, shorter wheelbase, softer volumes), not from redesigning shapes.
//
// REAL units: metres, +z toward the FRONT, y up from the ground, x lateral (measured on the image right side; the car is symmetric).
// Source images: spikes/art-pipeline/refs/{side,front,rear}.png (Codex orthographic turnarounds of a stock 2012 Holden Cruze).

export const REAL = {
  wheelbase: 2.657, length: 4.6, height: 1.507, halfWidth: 0.895,
  // top silhouette at the centreline (z, y): hood → windscreen → roof → fastback-style rear window → deck
  roof: [[2.165, 0.542], [1.864, 0.909], [1.564, 0.971], [1.263, 1.022], [0.962, 1.097], [0.661, 1.253], [0.36, 1.391], [0.06, 1.476],
    [-0.241, 1.504], [-0.542, 1.507], [-0.843, 1.488], [-1.144, 1.432], [-1.445, 1.319], [-1.745, 1.169], [-2.046, 1.087], [-2.347, 0.714]],
  // side "daylight opening" polygons (z, y)
  glass: {
    front: [[0.592, 1.131], [0.404, 1.25], [0.147, 1.363], [-0.229, 1.413], [-0.172, 1.043], [-0.085, 1.018], [0.41, 0.987], [0.498, 0.993]],
    rear: [[-0.379, 1.419], [-0.68, 1.407], [-0.862, 1.376], [-0.993, 1.338], [-0.968, 1.069], [-0.924, 1.056], [-0.454, 1.037], [-0.373, 1.043]],
    quarter: [[-1.025, 1.282], [-1.031, 1.325], [-1.131, 1.288], [-1.244, 1.231], [-1.257, 1.2], [-1.225, 1.075], [-1.137, 1.062], [-1.006, 1.069]],
  },
  // FRONT fascia, (x, y) on the image-right half; x from the centreline
  front: {
    lamp: [[0.483, 0.61], [0.78, 0.669], [0.802, 0.858], [0.498, 0.754]], projector: { x: 0.637, y: 0.716, r: 0.058 },
    bar: { hw: 0.416, y0: 0.746, y1: 0.793 },                              // thin slatted bar above the grille
    grille: { hwTop: 0.394, hwBot: 0.353, yTop: 0.703, yBot: 0.555 },      // chrome-framed hex trapezoid
    intake: { hwTop: 0.364, hwBot: 0.33, yTop: 0.38, yBot: 0.262 },        // wide honeycomb lower intake
    fog: { x0: 0.535, x1: 0.806, y0: 0.297, y1: 0.432 },                   // wide shallow recess
    plate: { hw: 0.226, y0: 0.39, y1: 0.505 },
  },
  rear: {
    lampOuter: { x0: 0.554, x1: 0.794, y0: 0.711, y1: 0.963 },             // wrap lamp on the quarter, lighter reverse section low
    lampInner: { x0: 0.389, x1: 0.575, y0: 0.753, y1: 0.918 },             // slanted lamp on the boot lid
    plate: { hw: 0.266, y0: 0.68, y1: 0.84 },
  },
};

// ── mapping into toy proportions ───────────────────────────────────────────────────────────────────────────
export const MAP = {
  sz: 2.30 / REAL.wheelbase,            // length scale (wheelbase 2.30 m in the toy)
  sx: 0.985,                            // lateral scale
  fy: (y) => 0.30 + (y - 0.19) * 0.83,  // front fascia height remap (toy chin at 0.30 m, real 0.19 m)
  ry: (y) => 0.34 + (y - 0.18) * 0.75,  // rear fascia height remap
};
const z = (v) => +(v * MAP.sz).toFixed(3);

export const TOY = {
  wheelbase: 2.30, wheelZ: 1.15,
  roof: REAL.roof.map(([zz, y]) => [z(zz), y]),
  glass: Object.fromEntries(Object.entries(REAL.glass).map(([k, p]) => [k, p.map(([zz, y]) => [z(zz), y])])),
  front: {
    lamp: REAL.front.lamp.map(([x, y]) => [+(x * MAP.sx).toFixed(3), +MAP.fy(y).toFixed(3)]),
    projector: { x: +(REAL.front.projector.x * MAP.sx).toFixed(3), y: +MAP.fy(REAL.front.projector.y).toFixed(3), r: 0.05 },
    bar: { hw: +(REAL.front.bar.hw * MAP.sx).toFixed(3), y0: +MAP.fy(REAL.front.bar.y0).toFixed(3), y1: +MAP.fy(REAL.front.bar.y1).toFixed(3) },
    grille: { hwTop: +(REAL.front.grille.hwTop * MAP.sx).toFixed(3), hwBot: +(REAL.front.grille.hwBot * MAP.sx).toFixed(3), yTop: +MAP.fy(REAL.front.grille.yTop).toFixed(3), yBot: +MAP.fy(REAL.front.grille.yBot).toFixed(3) },
    intake: { hwTop: +(REAL.front.intake.hwTop * MAP.sx).toFixed(3), hwBot: +(REAL.front.intake.hwBot * MAP.sx).toFixed(3), yTop: +MAP.fy(REAL.front.intake.yTop).toFixed(3), yBot: +MAP.fy(REAL.front.intake.yBot).toFixed(3) },
    fog: { x0: +(REAL.front.fog.x0 * MAP.sx).toFixed(3), x1: +(REAL.front.fog.x1 * MAP.sx).toFixed(3), y0: +MAP.fy(REAL.front.fog.y0).toFixed(3), y1: +MAP.fy(REAL.front.fog.y1).toFixed(3) },
    plate: { hw: +(REAL.front.plate.hw * MAP.sx).toFixed(3), y0: +MAP.fy(REAL.front.plate.y0).toFixed(3), y1: +MAP.fy(REAL.front.plate.y1).toFixed(3) },
  },
  rear: {
    lampOuter: { x0: +(REAL.rear.lampOuter.x0 * MAP.sx).toFixed(3), x1: +(REAL.rear.lampOuter.x1 * MAP.sx).toFixed(3), y0: +MAP.ry(REAL.rear.lampOuter.y0).toFixed(3), y1: +MAP.ry(REAL.rear.lampOuter.y1).toFixed(3) },
    lampInner: { x0: +(REAL.rear.lampInner.x0 * MAP.sx).toFixed(3), x1: +(REAL.rear.lampInner.x1 * MAP.sx).toFixed(3), y0: +MAP.ry(REAL.rear.lampInner.y0).toFixed(3), y1: +MAP.ry(REAL.rear.lampInner.y1).toFixed(3) },
    plate: { hw: +(REAL.rear.plate.hw * MAP.sx).toFixed(3), y0: +MAP.ry(REAL.rear.plate.y0).toFixed(3), y1: +MAP.ry(REAL.rear.plate.y1).toFixed(3) },
  },
};

/** piecewise-linear y at z along a (z,y) polyline (clamped), polyline sorted by ascending OR descending z */
export function polyY(pts, zz) {
  const p = pts.slice().sort((a, b) => a[0] - b[0]);
  if (zz <= p[0][0]) return p[0][1]; if (zz >= p[p.length - 1][0]) return p[p.length - 1][1];
  for (let i = 0; i < p.length - 1; i++) if (zz <= p[i + 1][0]) { const t = (zz - p[i][0]) / (p[i + 1][0] - p[i][0]); return p[i][1] + (p[i + 1][1] - p[i][1]) * t; }
}

/** recognition checks the gate script runs against renders/geometry: name → tolerance */
export const RECOGNITION_GATES = {
  roofPeakZ: { want: TOY.roof.reduce((a, b) => (b[1] > a[1] ? b : a))[0], tol: 0.12, note: 'roof peaks behind the wheelbase centre' },
  windscreenRakeDeg: { want: 24, tol: 5, note: 'long shallow windscreen (real ≈ 20°, toy slightly steeper)' },
  lightsPerSide: { want: 3, note: 'six-light greenhouse: front door, rear door, quarter light' },
  bootLenFrac: { want: 0.16, tol: 0.05, note: 'short deck: boot length / overall length' },
};
