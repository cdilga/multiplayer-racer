// lod.js — render LOD selection by projected size AND a global quality bias, with hysteresis.
//
//   selectLod(px, bias, current)   px = projected diameter of the object's bounding sphere in device pixels.
//                                  bias ≥ 0 makes everything cheaper (each +1 halves the effective size → ~one rung), bias < 0 richer.
//   QualityGovernor                watches sustained frame time and nudges the scene-wide bias; never touches physics, entity counts
//                                  or debris — only how much geometry is drawn.
// Thresholds come from the projected-size captures (out/lod_ladder_*.png): the rung below becomes indistinguishable at about these sizes.
export const LOD_PX = [520, 190, 70];        // ≥520 px → L0, ≥190 → L1, ≥70 → L2, else L3
export const HYST = 0.15;                    // ±15 % band around each threshold
export const MAX_LOD = 3;

export function selectLod(px, bias = 0, current = null) {
  const eff = px / Math.pow(2, bias);
  let lod = MAX_LOD;
  for (let i = 0; i < LOD_PX.length; i++) if (eff >= LOD_PX[i]) { lod = i; break; }
  if (current == null || current === lod) return lod;
  // only move if we are clearly past the boundary between current and candidate
  if (lod < current) { const edge = LOD_PX[lod]; return eff >= edge * (1 + HYST) ? lod : current; }
  const edge = LOD_PX[current]; return eff < edge * (1 - HYST) ? lod : current;
}

const _v = { x: 0, y: 0, z: 0 };
/** projected diameter in px of a world-space sphere for a perspective camera and a viewport height */
export function projectedPx(camera, centre, radius, viewportH) {
  const dx = centre.x - camera.position.x, dy = centre.y - camera.position.y, dz = centre.z - camera.position.z;
  const d = Math.max(1e-3, Math.hypot(dx, dy, dz));
  const f = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
  return (2 * radius * f) / d;
}

/** Sustained-pressure governor. Feed it every frame's CPU+GPU time (ms). bias moves in 0.5 steps with dwell + hysteresis. */
export class QualityGovernor {
  constructor({ budgetMs = 16.7, startBias = 0, min = -1, max = 3, up = 1.1, down = 0.7, upHold = 1.0, downHold = 4.0 } = {}) {
    Object.assign(this, { budgetMs, bias: startBias, min, max, up, down, upHold, downHold }); this.ema = budgetMs * 0.6; this.over = 0; this.under = 0; this.changes = [];
  }
  update(frameMs, dt, now = 0) {
    this.ema += (frameMs - this.ema) * Math.min(1, dt * 4);
    if (this.ema > this.budgetMs * this.up) { this.over += dt; this.under = 0; } else if (this.ema < this.budgetMs * this.down) { this.under += dt; this.over = 0; } else { this.over = this.under = 0; }
    if (this.over > this.upHold && this.bias < this.max) { this.bias += 0.5; this.over = 0; this.changes.push({ t: now, bias: this.bias, ema: +this.ema.toFixed(2) }); }
    if (this.under > this.downHold && this.bias > this.min) { this.bias -= 0.5; this.under = 0; this.changes.push({ t: now, bias: this.bias, ema: +this.ema.toFixed(2) }); }
    return this.bias;
  }
}
