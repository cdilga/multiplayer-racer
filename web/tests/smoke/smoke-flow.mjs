// The public smoke as a function (P1-D07, plan §12.3): the same fixed steps `jammers-deploy/scripts/smoke.mjs` runs against a
// published preview, runnable against any base URL, so CI proves the flow on a local jj-server before a preview exists.
// Keep the two in step: a step added here is added there (the deploy repo owns what deploys; the game repo owns the pages).
//   room         create + resolve a room (the hello host page)
//   join-webrtc  a headless controller connects over real WebRTC
//   input        its stick reaches the host, read back through the test surface
//   resume       the host drops the peer; the same seat comes back and input flows again
//   drive        a real round: two phones join, ready up, the car moves under the stick
//   hud          both phones receive a HUD
//   round        the 1-lap round finishes, Round complete shows both results, the next round starts
// A failure names the step that was running.
export const KNOWN = ['room', 'join-webrtc', 'input', 'resume', 'drive', 'hud', 'round'];

class SmokeFail extends Error {
  constructor(step, why) {
    super(why);
    this.step = step;
  }
}

/**
 * @param {object} o
 * @param {string} o.base          the build's base URL, ending in `/`
 * @param {string[]} [o.steps]     default: all seven
 * @param {string[]} [o.mandatory] steps the manifest must contain (default: all seven; `[]` for none)
 * @param {boolean} [o.relay]      force both ends through TURN (`?ice=relay`)
 * @param {string[]} [o.others]    other live bases: the room code must not resolve there
 * @param {string[]} [o.chromiumArgs]
 * @returns {Promise<{ok: boolean, step?: string, why?: string, steps: string[], path: string|null, code: string|null}>}
 */
export async function runSmoke({ base, steps = KNOWN, mandatory = KNOWN, relay = false, others = [], chromiumArgs = [] }) {
  const want = new Set(steps);
  const passed = [];
  let code = null;
  let pathKind = null;
  let current = 'manifest';
  const result = (extra) => ({ steps: passed, path: pathKind, code, ...extra });
  if (!/^https?:\/\/.+\/$/.test(base)) return result({ ok: false, step: 'manifest', why: 'base URL must end in /' });
  if (!want.size) return result({ ok: false, step: 'manifest', why: 'no steps given' });
  for (const s of want) if (!KNOWN.includes(s)) return result({ ok: false, step: 'manifest', why: `unknown step ${s}` });
  for (const s of mandatory) if (!want.has(s)) return result({ ok: false, step: s, why: `mandatory step ${s} is missing from smoke.json` });

  const { chromium } = await import('playwright'); // after the manifest checks, which need no browser
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', ...chromiumArgs] });
  const until = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
  const bad = (why) => {
    throw new SmokeFail(current, why);
  };
  const q = relay ? '?hello&ice=relay' : '?hello';
  const gameSteps = KNOWN.slice(4).filter((s) => want.has(s));

  async function helloFlow() {
    const host = await (await browser.newContext()).newPage();
    current = 'room';
    const res = await host.goto(`${base}host${q}`);
    if (!res || !res.ok()) bad(`host page answered ${res ? res.status() : 'nothing'}`);
    await until(host, () => window.__jjHello?.code());
    code = await host.evaluate(() => window.__jjHello.code());
    passed.push(`room ${code}`);
    for (const other of others) {
      const r = await fetch(`${other}api/v1/rooms/${code}`).catch(() => null);
      const body = r && r.ok ? await r.json().catch(() => ({})) : {};
      if (body.status === 'available' || body.roomId) bad(`room ${code} resolved on ${other}`);
    }
    if (others.length) passed.push(`isolated from ${others.length} other preview(s)`);
    if (!(want.has('join-webrtc') || want.has('input') || want.has('resume'))) return;
    current = 'join-webrtc';
    const phone = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })).newPage();
    await phone.goto(`${base}j/${code}${q}`);
    await until(phone, () => window.__jjHello?.link().state === 'connected', undefined, 60_000);
    const path = await phone.evaluate(() => window.__jjHello.path());
    pathKind = path?.kind ?? 'unknown';
    if (relay && !String(pathKind).includes('relay') && !String(path?.local).startsWith('relay')) bad(`ice=relay but the selected path is ${pathKind}`);
    passed.push(`join-webrtc (${pathKind}${path?.rttMs != null ? `, ${path.rttMs} ms` : ''})`);
    const ep = await phone.evaluate(() => window.__jjHello.link().endpointId);
    const moveAndSee = async (x, y) => {
      await phone.evaluate(([x, y]) => window.__jjHello.setStick(x, y), [x, y]);
      await until(host, ([ep, x, y]) => {
        const m = window.__jjHello.markers()[ep];
        return m && Math.abs(m.x - x) < 0.02 && Math.abs(m.y - y) < 0.02;
      }, [ep, x, y]);
    };
    if (want.has('input') || want.has('resume')) {
      current = 'input';
      await moveAndSee(0.6, -0.4);
      passed.push('input');
    }
    if (want.has('resume')) {
      current = 'resume';
      const gen = await phone.evaluate(() => window.__jjHello.link().gen);
      await host.evaluate((ep) => window.__jjHello.dropPeer(ep), ep);
      await until(phone, (gen) => window.__jjHello.link().state === 'connected' && window.__jjHello.link().gen > gen, gen, 60_000);
      await moveAndSee(-0.5, 0.5);
      passed.push('resume');
    }
  }

  async function gameFlow() {
    const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const errors = [];
    host.on('pageerror', (e) => errors.push(e.message));
    current = want.has('drive') ? 'drive' : gameSteps[0];
    const res = await host.goto(`${base}host?room&test=live&laps=1${relay ? '&ice=relay' : ''}`);
    if (!res || !res.ok()) bad(`game host page answered ${res ? res.status() : 'nothing'}`);
    await until(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
    const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
    const phones = [];
    for (const name of ['Davo', 'Shazza']) {
      const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
      const page = await ctx.newPage();
      await page.goto(relay ? `${joinUrl}${joinUrl.includes('?') ? '&' : '?'}ice=relay` : joinUrl);
      await until(page, () => window.__jjController?.inspect().phase === 'ready-to-join', undefined, 60_000);
      await page.locator('#name').fill(name);
      await page.getByRole('button', { name: 'Join the race' }).click();
      await until(page, () => window.__jjController.inspect().phase === 'playing', undefined, 60_000);
      phones.push(page);
    }
    await until(host, () => window.__jjRoom.view().seats.length === 2);
    for (const page of phones) await page.getByRole('button', { name: /^Ready/ }).click();
    await until(host, () => window.__jjRoom.view().phase === 'Running', undefined, 60_000);
    const observe = () => host.evaluate(() => window.__jjTest.observe());
    if (want.has('drive')) {
      current = 'drive';
      const you = await phones[0].evaluate(() => window.__jjController.inspect().link.endpointId);
      await phones[0].evaluate(() => window.__jjController.setSticks({ x: 0, y: -1, touch: true }, { x: 0, y: 0, touch: false }));
      const carOf = (o) => {
        const seat = o.host.seats.find((s) => s.endpoint === you);
        return seat && o.cars.find((c) => c.car === seat.car);
      };
      const start = carOf(await observe());
      for (const t0 = Date.now(); ; await host.waitForTimeout(150)) {
        const now = carOf(await observe());
        const moved = start && now ? Math.hypot(...now.position.map((v, i) => v - start.position[i])) : 0;
        if (now && now.forwardSpeed > 4 && moved > 3) break;
        if (Date.now() - t0 > 30_000) bad(`the car didn't drive under the stick (speed ${now?.forwardSpeed}, moved ${moved.toFixed(1)} m)`);
      }
      await phones[0].evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false }));
      passed.push('drive');
    }
    if (want.has('hud')) {
      current = 'hud';
      for (const page of phones) await until(page, () => window.__jjController.inspect().hud !== null, undefined, 30_000);
      passed.push('hud');
    }
    if (want.has('round')) {
      current = 'round';
      await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
      await until(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 300_000);
      const results = await host.evaluate(() => window.__jjRoom.view().results);
      if (results.length !== 2 || results.map((r) => r.place).sort().join() !== '1,2') bad(`Round complete results were ${JSON.stringify(results)}`);
      await host.getByRole('button', { name: 'Start next round now' }).click();
      await until(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase) && window.__jjRoom.view().round === 2, undefined, 60_000);
      passed.push('round');
    }
    if (errors.length) bad(`the game host raised page errors: ${errors[0]}`);
  }

  try {
    await helloFlow();
    if (gameSteps.length) await gameFlow();
    return result({ ok: true });
  } catch (e) {
    const why = String(e.message ?? e).split('\n')[0];
    return result({ ok: false, step: e instanceof SmokeFail ? e.step : current, why: passed.length && !(e instanceof SmokeFail) ? `after ${passed.join(', ')}: ${why}` : why });
  } finally {
    await browser.close();
  }
}
