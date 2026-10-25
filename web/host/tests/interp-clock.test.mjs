// br-gw74.14: the render clock advances smoothly by frame time even when snapshots arrive unevenly (the worker publishes
// on its own timer and postMessage delivers them in clumps), never runs backwards and never passes the newest snapshot.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { rolldown } from 'rolldown';

// interp.ts imports its siblings without extensions (Vite style), so bundle it like camera.test.mjs does the rig. It takes
// only TICK_HZ from ./synthetic, whose Vite-only asset globs can't bundle here: stand in for just that constant.
const tickOnly = {
  name: 'tick-only',
  resolveId: (id) => (id === './synthetic' ? '\0synthetic' : null),
  load: (id) => (id === '\0synthetic' ? 'export const TICK_HZ = 120;' : null),
};
const bundle = await rolldown({ input: join(import.meta.dirname, '../src/render/interp.ts'), external: ['three'], plugins: [tickOnly], logLevel: 'silent' });
const { output } = await bundle.generate({ format: 'esm' });
const file = join(import.meta.dirname, '.interp-bundle.mjs');
await writeFile(file, output[0].code);
await bundle.close();
const { DELAY_TICKS, Interpolator } = await import(`${file}?${Date.now()}`);

const TICK_HZ = 120;

/** A seeded schedule: the sim makes one tick per 1/120 s; each arrives 0-12 ms late, delivered in arrival order. */
function run(displayHz, seconds, seed = 7) {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const arrivals = [];
  let latest = 0;
  for (let tick = 1; tick <= seconds * TICK_HZ; tick++) {
    latest = Math.max(latest, (tick * 1000) / TICK_HZ + rand() * 12);
    arrivals.push({ tick, at: latest });
  }
  const ip = new Interpolator();
  const frameMs = 1000 / displayHz;
  const steps = [];
  let i = 0;
  let prev = null;
  for (let now = 100; now < seconds * 1000; now += frameMs) {
    while (i < arrivals.length && arrivals[i].at <= now) ip.push({ tick: arrivals[i].tick, sessionRev: 0 }, arrivals[i++].at);
    if (!ip.latest) continue;
    const t = ip.renderTick(now);
    assert.ok(t <= ip.latest.tick, 'never past the newest snapshot');
    if (prev !== null) {
      assert.ok(t >= prev, 'never backwards');
      steps.push(t - prev);
    }
    prev = t;
  }
  const ideal = TICK_HZ / displayHz;
  const settled = steps.slice(displayHz); // after the first second
  const good = settled.filter((d) => Math.abs(d - ideal) <= 0.05 * ideal).length / settled.length;
  const worst = Math.max(...settled.map((d) => Math.abs(d - ideal)));
  return { good, worst, ideal, behind: ip.latest.tick - prev };
}

for (const hz of [60, 120, 144]) {
  test(`at ${hz} Hz the drawn tick advances by frame time on 99 % of frames under jittered arrivals`, () => {
    const r = run(hz, 20);
    console.log(
      `# ${hz} Hz: ${(r.good * 100).toFixed(1)} % of frames within 5 % of ${r.ideal.toFixed(3)} ticks, worst step error ${r.worst.toFixed(3)} ticks, ${r.behind.toFixed(2)} ticks behind newest`,
    );
    assert.ok(r.good >= 0.99, `${(r.good * 100).toFixed(1)} % smooth`);
    assert.ok(r.behind <= DELAY_TICKS + 3, 'stays close behind the newest snapshot');
  });
}

test('after a hitch (a burst of ticks at once) the drawn tick jumps to the newest instead of trailing behind', () => {
  const ip = new Interpolator();
  let now = 0;
  for (let tick = 1; tick <= 120; tick++) {
    now = (tick * 1000) / TICK_HZ;
    ip.push({ tick, sessionRev: 0 }, now);
    ip.renderTick(now);
  }
  // 150 ms of nothing, then 18 ticks land together (a stalled tab, or a test stepping the sim).
  now += 150;
  for (let tick = 121; tick <= 138; tick++) ip.push({ tick, sessionRev: 0 }, now);
  const t = ip.renderTick(now + 1);
  assert.ok(t >= 138 - DELAY_TICKS - 1, `drawn at ${t.toFixed(2)}, newest 138`);
});

test('a delayed animation callback does not project a newer snapshot backwards from its arrival', () => {
  const ip = new Interpolator();
  const lags = [];
  let delivered = 0;
  let previous = 0;
  // rAF supplies the frame timestamp, not the time its callback runs. Snapshot messages can arrive after that
  // timestamp but before the callback, especially while other browser tasks delay it. Replay that ordering at
  // 60 Hz with 30 ms callback delay, retaining the real 120 Hz snapshot stream and three-tick smoothing delay.
  for (let frameAt = 100; frameAt < 10_100; frameAt += 1000 / 60) {
    const callbackAt = frameAt + 30;
    const newest = Math.floor(callbackAt * TICK_HZ / 1000);
    while (delivered < newest) ip.push({ tick: ++delivered, sessionRev: 0 }, callbackAt);
    const shown = ip.renderTick(frameAt);
    assert.ok(shown >= previous && shown <= newest, 'playback stays monotonic and within received state');
    previous = shown;
    if (frameAt > 1100) lags.push(newest - shown);
  }
  lags.sort((a, b) => a - b);
  const p99 = lags[Math.floor(lags.length * 0.99)];
  assert.ok(p99 <= DELAY_TICKS + 1, `callback scheduling must not add to interpolation delay: ${p99.toFixed(2)} ticks`);
});
