// br-l4v5 (R125): the race cameras keep the car in frame through big air and loops. Steps a loaded fixture `ticks` ticks,
// `every` at a time (6: 20 checks a second), paints a frame after each step and asks every tile's camera whether car
// `car` (its body and a point 1.2 m over it) is inside the frustum. Returns the ticks where a tile lost it.
/** @param {import('playwright').Page} page */
export async function inFrameRide(page, { ticks, every = 6, car = 0 }) {
  const lost = [];
  let frames = 0;
  for (let tick = 0; tick < ticks; tick += every) {
    const seen = await page.evaluate(async ({ every, car }) => {
      await window.__jjTest.step(every);
      const s = await window.__jjTest.observe();
      const c = s.cars.find((x) => x.car === car) ?? s.cars[car];
      // A frame painted at (or a tick or two short of) this tick: the cameras move in frame(). A few ticks' lag is well
      // inside a frustum's margin, and each SwiftShader frame of 9 tiles costs a lot.
      let k = 0;
      do {
        window.__jjRender.frame();
        await new Promise((r) => setTimeout(r, 10));
      } while (++k < 3 && window.__jjRender.stats().tick < s.tick);
      const [x, y, z] = c.position;
      return { tick: s.tick, tiles: window.__jjRender.tilesSee([[x, y, z], [x, y + 1.2, z]]), position: c.position };
    }, { every, car });
    frames++;
    for (const t of seen.tiles) if (!t.sees.every(Boolean)) lost.push({ tick: seen.tick, seat: t.seat, position: seen.position });
    if (!seen.tiles.length) lost.push({ tick: seen.tick, seat: null, position: seen.position });
  }
  return { frames, lost };
}

/** `tiles=N&follow=0,0,…`: N tiles, every one following car `car`, so each tile size sees the same ride. */
export const tilesFollowing = (n, car = 0) => `tiles=${n}&follow=${Array(n).fill(car).join(',')}`;

/** br-gw74.13.1.1.1: in the overview, car `car`'s label box (2 px margin) covers neither the car nor its road 8 m ahead of
 *  or behind it along its travel (where the jump or loop it is on lies). Returns the points it covers, and the box. */
export async function labelClear(page, car = 0) {
  return page.evaluate((car) => (async () => {
    const c = (await window.__jjTest.observe()).cars.find((x) => x.car === car);
    const r = document.querySelector(`.identity-nameplate[data-car="${car}"]`)?.getBoundingClientRect();
    if (!r) return { labelled: false };
    const v = c.linvel, sp = Math.hypot(...v) || 1;
    const pts = [0, 8, -8].map((m) => window.__jjRender.project(...c.position.map((p, i) => p + (v[i] / sp) * m)));
    const covered = pts.filter(([x, y]) => x > r.left - 2 && x < r.right + 2 && y > r.top - 2 && y < r.bottom + 2);
    return { labelled: true, covered, box: [r.left, r.top, r.right, r.bottom].map(Math.round), pts: pts.map((p) => p.map(Math.round)) };
  })(), car);
}
