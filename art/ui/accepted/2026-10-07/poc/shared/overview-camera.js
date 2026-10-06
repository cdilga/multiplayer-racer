// overview-camera.js — the Derby Overview camera rig (P1-U05.4, R107), shared by the TV mock and the in-world mock. Pure
// maths: cars in, a camera pose out; the values live in framing.json `overview` (the TUNE inputs for P1-R11).
//
// Round 0 refitted the box round every car on every frame: each car's wobble moved the camera, and a spread or a regroup
// zoomed it in a frame or two. The owner found it made him motion sick (POC2-06). This rig:
//   - frames where the cars are going: each car's position now and `lookAheadS` ahead from its velocity, so the frame
//     opens before the pack spreads and drivers see what's coming (POC2-07, predictive);
//   - moves the centre and the zoom on critically damped springs with speed limits, zooms out quicker than in (cars never
//     leave the frame) and ignores changes inside a small dead zone (no jitter from single cars);
//   - never rotates: a fixed pitch and heading;
//   - stays anchored to the arena, drifting at most `maxDriftM` from its centre, between `minFrameM` and `maxFrameM` of
//     ground, so the bowl and its dressing stay where the arena design puts them (near-fixed, POC2-08).

/** Critically damped spring toward `target` with a speed limit (the classic SmoothDamp). Returns [value, velocity]. */
export function smoothDamp(cur, target, vel, smoothTime, maxSpeed, dt) {
  const st = Math.max(1e-4, smoothTime), omega = 2 / st, x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * st;
  const change = Math.max(-maxChange, Math.min(maxChange, cur - target));
  const to = cur - change;
  const temp = (vel + omega * change) * dt;
  // No overshoot snap: zeroing the velocity in one step is a jerk spike, and the critically damped step barely overshoots.
  return [to + (change + temp) * exp, (vel - omega * temp) * exp];
}

/** The ground height the frame must show for a box of `sx` × `sz` metres at this pitch and aspect. */
const needFrame = (sx, sz, pitch, aspect) => Math.max(sz * Math.sin(pitch) + 4, sx / aspect);

/**
 * A rig for one view. `cfg` is framing.json `overview`; `anchor` is the arena centre {x, z}.
 * update(cars [{x, z}], dt, aspect) → { position [x, y, z], target [x, 0, z], frame, centre {x, z} }.
 */
export function createOverviewRig(cfg, anchor) {
  const pitch = (cfg.pitchDeg * Math.PI) / 180, vfov = (cfg.fovDeg * Math.PI) / 180;
  const st = { cx: anchor.x, cz: anchor.z, frame: cfg.maxFrameM, vx: 0, vz: 0, vf: 0, gx: 0, gz: 0, gf: 0, init: false };
  let prev = [], vel = [];
  const ease = (dt, tau) => 1 - Math.exp(-dt / Math.max(1e-4, tau));
  // A soft dead zone: the goal only moves by how far the target is beyond it, so it never steps.
  const soft = (cur, target, dz) => { const d = target - cur; return Math.abs(d) <= dz ? cur : target - Math.sign(d) * dz; };
  const pose = () => {
    const dist = st.frame / 2 / Math.tan(vfov / 2) + 6;
    return { position: [st.cx, Math.sin(pitch) * dist, st.cz + Math.cos(pitch) * dist], target: [st.cx, 0, st.cz], frame: st.frame, centre: { x: st.cx, z: st.cz } };
  };
  return {
    cfg,
    reset() { st.init = false; prev = []; },
    update(cars, dt, aspect) {
      if (!cars.length) return pose();
      // Each car's velocity (smoothed over velocitySmoothS, so one jolt doesn't swing the frame), and where it takes the
      // car `lookAheadS` from now. The centre follows where the cars are going; the frame covers now and then.
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, px0 = Infinity, px1 = -Infinity, pz0 = Infinity, pz1 = -Infinity;
      const k = ease(dt, cfg.velocitySmoothS);
      cars.forEach((c, i) => {
        const p = prev[i], v = (vel[i] ??= { x: 0, z: 0 });
        if (p && dt > 0) { v.x += ((c.x - p.x) / dt - v.x) * k; v.z += ((c.z - p.z) / dt - v.z) * k; }
        const fx = c.x + v.x * cfg.lookAheadS, fz = c.z + v.z * cfg.lookAheadS;
        x0 = Math.min(x0, c.x, fx); x1 = Math.max(x1, c.x, fx); z0 = Math.min(z0, c.z, fz); z1 = Math.max(z1, c.z, fz);
        px0 = Math.min(px0, fx); px1 = Math.max(px1, fx); pz0 = Math.min(pz0, fz); pz1 = Math.max(pz1, fz);
      });
      vel.length = cars.length;
      prev = cars.map((c) => ({ x: c.x, z: c.z }));
      const m = cfg.marginM;
      let tx = (px0 + px1) / 2, tz = (pz0 + pz1) / 2;
      // Near-fixed: the centre stays within maxDriftM of the arena's centre.
      const dx = tx - anchor.x, dz = tz - anchor.z, d = Math.hypot(dx, dz);
      if (d > cfg.maxDriftM) { tx = anchor.x + (dx / d) * cfg.maxDriftM; tz = anchor.z + (dz / d) * cfg.maxDriftM; }
      // The frame must also cover the box from the clamped centre, so the drift limit never crops a car.
      const sx = 2 * Math.max(x1 - tx, tx - x0) + 2 * m, sz = 2 * Math.max(z1 - tz, tz - z0) + 2 * m;
      const tf = Math.min(cfg.maxFrameM, Math.max(cfg.minFrameM, needFrame(sx, sz, pitch, aspect)));
      if (!st.init) { Object.assign(st, { cx: tx, cz: tz, frame: tf, vx: 0, vz: 0, vf: 0, gx: tx, gz: tz, gf: tf, init: true }); return pose(); }
      // The goal: a soft dead zone (a single car's wobble doesn't move it), then a low-pass, so the spring's acceleration
      // never steps (smooth acceleration = low jerk).
      const g = ease(dt, cfg.goalSmoothS);
      st.gx += (soft(st.cx, tx, cfg.deadZoneM) - st.gx) * g;
      st.gz += (soft(st.cz, tz, cfg.deadZoneM) - st.gz) * g;
      st.gf += (soft(st.frame, tf, st.frame * cfg.deadZoneFrame) - st.gf) * g;
      [st.cx, st.vx] = smoothDamp(st.cx, st.gx, st.vx, cfg.smoothTimeS.pan, cfg.maxPanMps, dt);
      [st.cz, st.vz] = smoothDamp(st.cz, st.gz, st.vz, cfg.smoothTimeS.pan, cfg.maxPanMps, dt);
      [st.frame, st.vf] = smoothDamp(st.frame, st.gf, st.vf, st.gf > st.frame ? cfg.smoothTimeS.zoomOut : cfg.smoothTimeS.zoomIn, cfg.maxZoomMps, dt);
      return pose();
    },
  };
}

/** Round 0's camera, for before/after: refit the box round every car, every frame, no smoothing. */
export function createRound0Rig(cfg, anchor) {
  const pitch = (cfg.pitchDeg * Math.PI) / 180, vfov = (cfg.fovDeg * Math.PI) / 180;
  return {
    reset() {},
    update(cars, dt, aspect) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const c of cars.length ? cars : [anchor]) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); z0 = Math.min(z0, c.z); z1 = Math.max(z1, c.z); }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, frame = needFrame(x1 - x0 + 18, z1 - z0 + 18, pitch, aspect);
      const dist = frame / 2 / Math.tan(vfov / 2) + 6;
      return { position: [cx, Math.sin(pitch) * dist, cz + Math.cos(pitch) * dist], target: [cx, 0, cz], frame, centre: { x: cx, z: cz } };
    },
  };
}

/** Acceleration and jerk of a camera path sampled every `dt` seconds: the motion-sickness proxy for before/after. */
export function motionStats(positions, dt) {
  const diff = (a) => a.slice(1).map((p, i) => p.map((v, k) => (v - a[i][k]) / dt));
  const mag = (a) => a.map((p) => Math.hypot(...p));
  const v = diff(positions), a = diff(v), j = diff(a);
  const stats = (xs) => { const s = [...xs].sort((p, q) => p - q); return { rms: +Math.sqrt(xs.reduce((t, x) => t + x * x, 0) / Math.max(1, xs.length)).toFixed(3), p95: +(s[Math.floor(0.95 * (s.length - 1))] ?? 0).toFixed(3), max: +(s.at(-1) ?? 0).toFixed(3) }; };
  return { samples: positions.length, dtS: dt, speed: stats(mag(v)), accel: stats(mag(a)), jerk: stats(mag(j)) };
}
