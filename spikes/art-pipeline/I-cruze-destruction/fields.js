// fields.js — the Cruze's deformation channels, each a smooth space-warp d(x,y,z) in KIT space
// (metres, +Z forward, +Y up, +X = the car's LEFT).
//
// Two families:
//   damage_FL/FR/RL/RR/ROOF  structural zones: one warp applied to EVERY attached part (chassis, its cavities, bonnet, bumper,
//                            doors, lamps, glass, wheel hubs), so neighbours move together instead of intersecting.
//   dent_<part>              panel-local: only the panel (and parts riding on it, e.g. lamps on a bumper) take it.
//
// Design rules (checked by gates.mjs):
//   * det(I + ∇d) stays well above 0 for every channel and for all zones at full weight together: the warp is a local
//     bijection, so nested surfaces (outer skin / inner skin / cavity / chassis) can never pass through each other.
//   * Panel dents are mostly *shears* (displacement along one axis as a function of the other two): det = 1 exactly, and the
//     closed shell only thins by 1/√(1+slope²).
//   * Dents never push a panel's inner skin past its cavity back: depth(dent) + panel thickness < cavity depth.
//   * Nothing moves below the ground.
// Shapes are designed for silhouette at gameplay distance: noses shoved back and up, corners folded in, roofs flattened with a
// twist, bonnets buckled into a tent, boots kinked, bumpers squashed and skewed — not 12 cm dents.
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const gauss = (x, s) => Math.exp(-(x * x) / (s * s));

export const ZONES = ['damage_FL', 'damage_FR', 'damage_RL', 'damage_RR', 'damage_ROOF'];

/** corner crush: sx = +1 left / −1 right, sz = +1 front / −1 rear */
function corner(sx, sz, D) {
  const zEnd = sz > 0 ? D.zFront : -D.zRear;
  return (x, y, z, o) => {
    const zz = sz * z;                                         // distance toward this end
    const a = sstep(0.45, zEnd + 0.05, zz), along = Math.pow(a, 1.25);
    const side = sstep(-0.75, 0.9, sx * x);                    // this corner hard, the other corner a little
    const w = along * side, near = sstep(0.15, 0.95, sx * x), top = sstep(0.62, 1.0, y), low = 1 - top;
    o[2] = -sz * 0.34 * w;                                       // end shoved back toward the cabin (compression: the only diagonal term)
    o[0] = -sx * (0.15 * w * near + 0.10 * Math.pow(a, 1.5))     // near flank folded in + the whole end bent away from the hit (a shear)
      + 0.045 * w * low * Math.sin(zz * 15 + 0.6);               // flank buckles (shear in z: free for the Jacobian)
    o[1] = 0.07 * w * sstep(0.2, 0.7, y)                         // kicked up (never down: stays off the ground)
      + 0.045 * w * top * Math.sin(zz * 14 + sx * x * 4);        // bonnet/boot-line crumple folds
  };
}
function roof() {
  return (x, y, z, o) => {
    const r = sstep(0.95, 1.6, y), zc = gauss(z + 0.3, 1.0);
    o[1] = -0.25 * r * zc * (1 - 0.3 * clamp((x / 0.75) ** 2)) + 0.022 * r * zc * Math.sin(z * 9);  // flattened, a bit more in the middle, rippled
    o[0] = 0.09 * r * zc * clamp((z + 0.3) / 1.0, -1, 1);       // and twisted (front of the roof one way, rear the other)
    o[2] = 0;
  };
}

/** panel-local dents. `P` carries the panel geometry facts the dent needs. */
export function panelDent(kind, P) {
  if (kind === 'door') {   // inward push centred on the door with a horizontal crease; a shear in x (det = 1)
    const { sgn, zc, yc } = P;
    return (x, y, z, o) => {
      const g = gauss(z - zc, 0.27) * gauss(y - yc, 0.24);
      o[0] = -sgn * (0.075 * g + 0.012 * g * Math.sin((y - yc) * 22)); o[1] = 0; o[2] = 0;
    };
  }
  if (kind === 'bonnet' || kind === 'boot') {   // buckled into a tent across the middle; a shear in y, plus a small shove
    const { z0, z1, sz } = P, L = z1 - z0;
    return (x, y, z, o) => {
      const t = clamp((z - z0) / L), xs = clamp(Math.abs(x) / 0.7);
      o[1] = (0.075 * Math.sin(Math.PI * t) ** 2 + 0.014 * Math.sin(3 * Math.PI * t)) * (1 - 0.45 * xs * xs) * (1 + 0.25 * Math.sign(x) * xs);
      o[2] = -sz * 0.045 * t; o[0] = 0;
    };
  }
  if (kind === 'bumper') {   // the LOWER bumper squashed back and skewed, drooping on one side. Zero above `yTop` (where the lamps sit),
    const { zCut, zEnd, sz, yTop, depth = 0.09 } = P;   // so nothing riding higher up can be pushed into
    return (x, y, z, o) => {
      const t = sstep(zCut, zEnd, sz * z), skew = 0.65 + 0.35 * clamp(x / 0.85, -1, 1), lowW = 1 - sstep(yTop - 0.2, yTop, y);
      o[2] = -sz * depth * t * skew * lowW; o[1] = -0.035 * t * clamp(x / 0.85, -1, 1) * lowW * sstep(0.25, 0.45, y); o[0] = 0;
    };
  }
  return (x, y, z, o) => { o[0] = o[1] = o[2] = 0; };
}

export function zoneFields(D) {
  return { damage_FL: corner(1, 1, D), damage_FR: corner(-1, 1, D), damage_RL: corner(1, -1, D), damage_RR: corner(-1, -1, D), damage_ROOF: roof() };
}
/** weighted sum of channels (used by gates and by the wheel-hub follower) */
export function combined(fields, weights) {
  const t = [0, 0, 0];
  return (x, y, z, o) => { o[0] = o[1] = o[2] = 0; for (const [k, w] of Object.entries(weights)) { if (!w || !fields[k]) continue; fields[k](x, y, z, t); o[0] += w * t[0]; o[1] += w * t[1]; o[2] += w * t[2]; } };
}
