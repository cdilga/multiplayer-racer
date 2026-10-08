// The public smoke for a preview (P1-D04): fixed steps, chosen by name from the bundle's assets/smoke.json, run
// against the preview's public URL through Cloudflare with real WebRTC between two Chromium contexts. The candidate
// supplies no code here; only its pages run, in the browser.
//   node scripts/smoke.mjs https://jammers-preview.dilger.dev/p/<id>/ room,join-webrtc,input,resume
// Environment (all optional):
//   SMOKE_ICE=relay        force both ends through TURN (`?ice=relay`), the path a phone off the LAN takes; the
//                          join then fails unless the selected path is a relay. Run it from a machine outside the
//                          LAN/VPN (eris: `ssh eris`) to prove the real route.
//   SMOKE_OTHERS=<base>,…  other live previews' base URLs: the room code made here must NOT resolve on any of them.
//   SMOKE_MANDATORY=a,b    steps a bundle's smoke.json must declare (default: all seven, P1-D07). A bundle that drops
//                          one fails here, naming it, and so is marked "not playable". `SMOKE_MANDATORY=` (empty) = none.
//   SMOKE_JSON=1           the last line is a JSON result ({ok, steps, path, code}) instead of the PASS/FAIL text.
const [base, list] = process.argv.slice(2);
if (!base || !/^https?:\/\/.+\/$/.test(base)) {
  console.log('smoke: FAIL usage: smoke.mjs <preview base url ending in /> <step,step,…>');
  process.exit(2);
}
const steps = new Set((list ?? '').split(',').filter(Boolean));
const KNOWN = ['room', 'join-webrtc', 'input', 'resume', 'drive', 'hud', 'round'];
const relay = process.env.SMOKE_ICE === 'relay';
const others = (process.env.SMOKE_OTHERS ?? '').split(',').filter(Boolean);
const q = relay ? '?hello&ice=relay' : '?hello';
const mandatory = (process.env.SMOKE_MANDATORY ?? KNOWN.join(',')).split(',').filter(Boolean);
const gameSteps = ['drive', 'hud', 'round'].filter((s) => steps.has(s));
const passed = [];
let code = null;
let pathKind = null;
let current = 'start';

/** Every failure names the step that was running (P1-D07). */
function fail(why, step = current) {
  const text = `smoke: FAIL step ${step}: ${why}`;
  console.log(process.env.SMOKE_JSON ? JSON.stringify({ ok: false, step, why, steps: passed, path: pathKind, code }) : text);
  process.exit(1);
}
if (!steps.size) fail('no steps given', 'manifest');
for (const s of steps) if (!KNOWN.includes(s)) fail(`unknown step ${s}`, 'manifest');
for (const s of mandatory) if (!steps.has(s)) fail(`mandatory step ${s} is missing from smoke.json`, s);

const { chromium } = await import('playwright'); // after the manifest checks, which need no browser
const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
const until = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const killer = setTimeout(() => fail(`smoke exceeded ${gameSteps.length ? 6.5 : 5} minutes`), gameSteps.length ? 390_000 : 300_000);

// The party loop on the real game pages (P1-D07; the same flow as journeys JN1 and JN3): a headless host with the test
// flag, two phones over WebRTC, then `drive` (the cars move under the sticks), `hud` (the phones receive a HUD) and
// `round` (a 1-lap round finishes, the Round-complete results show, the next round starts).
async function gameFlow() {
  const gq = relay ? '&ice=relay' : '';
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  current = steps.has('drive') ? 'drive' : gameSteps[0];
  const res = await host.goto(`${base}host?room&test=live&laps=1${gq}`);
  if (!res || !res.ok()) fail(`game host page answered ${res ? res.status() : 'nothing'}`);
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
  if (steps.has('drive')) {
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
      if (Date.now() - t0 > 30_000) fail(`the car didn't drive under the stick (speed ${now?.forwardSpeed}, moved ${moved.toFixed(1)} m)`);
    }
    await phones[0].evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false }));
    passed.push('drive');
  }
  if (steps.has('hud')) {
    current = 'hud';
    for (const page of phones) await until(page, () => window.__jjController.inspect().hud !== null, undefined, 30_000);
    passed.push('hud');
  }
  if (steps.has('round')) {
    current = 'round';
    await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
    await until(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 300_000);
    const results = await host.evaluate(() => window.__jjRoom.view().results);
    if (results.length !== 2 || results.map((r) => r.place).sort().join() !== '1,2') fail(`Round complete results were ${JSON.stringify(results)}`);
    await host.getByRole('button', { name: 'Start next round now' }).click();
    await until(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase) && window.__jjRoom.view().round === 2, undefined, 60_000);
    passed.push('round');
  }
  if (errors.length) fail(`the game host raised page errors: ${errors[0]}`);
}

try {
  const host = await (await browser.newContext()).newPage();
  current = 'room';
  const res = await host.goto(`${base}host${q}`);
  if (!res || !res.ok()) fail(`host page answered ${res ? res.status() : 'nothing'}`);
  await until(host, () => window.__jjHello?.code());
  code = await host.evaluate(() => window.__jjHello.code());
  passed.push(`room ${code}`);

  // A room code belongs to one preview: it must not resolve on any other live one.
  for (const other of others) {
    const r = await fetch(`${other}api/v1/rooms/${code}`).catch(() => null);
    const body = r && r.ok ? await r.json().catch(() => ({})) : {};
    if (body.status === 'available' || body.roomId) fail(`room ${code} resolved on ${other}`);
  }
  if (others.length) passed.push(`isolated from ${others.length} other preview(s)`);

  if (steps.has('join-webrtc') || steps.has('input') || steps.has('resume')) {
    current = 'join-webrtc';
    const phone = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })).newPage();
    await phone.goto(`${base}j/${code}${q}`);
    await until(phone, () => window.__jjHello?.link().state === 'connected', undefined, 60_000);
    const path = await phone.evaluate(() => window.__jjHello.path());
    pathKind = path?.kind ?? 'unknown';
    if (relay && !String(pathKind).startsWith('relay') && !String(path?.local).startsWith('relay')) {
      fail(`ice=relay but the selected path is ${pathKind}`);
    }
    passed.push(`join-webrtc (${pathKind}${path?.rttMs != null ? `, ${path.rttMs} ms` : ''})`);
    const ep = await phone.evaluate(() => window.__jjHello.link().endpointId);
    const moveAndSee = async (x, y) => {
      await phone.evaluate(([x, y]) => window.__jjHello.setStick(x, y), [x, y]);
      await until(host, ([ep, x, y]) => {
        const m = window.__jjHello.markers()[ep];
        return m && Math.abs(m.x - x) < 0.02 && Math.abs(m.y - y) < 0.02;
      }, [ep, x, y]);
    };
    if (steps.has('input') || steps.has('resume')) {
      current = 'input';
      await moveAndSee(0.6, -0.4);
      passed.push('input');
    }
    if (steps.has('resume')) {
      current = 'resume';
      const gen = await phone.evaluate(() => window.__jjHello.link().gen);
      await host.evaluate((ep) => window.__jjHello.dropPeer(ep), ep);
      await until(phone, (gen) => window.__jjHello.link().state === 'connected' && window.__jjHello.link().gen > gen, gen, 60_000);
      await moveAndSee(-0.5, 0.5);
      passed.push('resume');
    }
  }
  if (gameSteps.length) await gameFlow();
  clearTimeout(killer);
  console.log(process.env.SMOKE_JSON ? JSON.stringify({ ok: true, steps: passed, path: pathKind, code }) : `smoke: PASS ${passed.join(', ')}`);
} catch (e) {
  fail(`${passed.length ? `after ${passed.join(', ')}: ` : ''}${String(e.message ?? e).split('\n')[0]}`);
} finally {
  await browser.close();
}
