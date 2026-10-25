// A multi-field lab edit must preserve every vehicle and export without flooding the sim with readbacks (br-dsq4).
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { build } from '../../node_modules/vite/dist/node/index.js';
import { serve } from './lib/surface.mjs';

test('Feel Lab applies every field and vehicle with bounded worker readbacks', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jj-tuning-'));
  let browser, server;
  try {
    await writeFile(join(dir, 'index.html'), '<script type="module" src="/probe.mjs"></script>');
    await writeFile(join(dir, 'probe.mjs'), `
      import { mountTuningPanel } from ${JSON.stringify(resolve(import.meta.dirname, '../src/tuning/panel.ts'))};
      const ids = Array.from({length: 7}, (_, i) => 'vehicle-' + i);
      const initial = {
        max_engine_force: 100, max_engine_power_w: 200,
        arcade: {turn_g: 2, yaw_max_deg_s: 30, turn_in_s: 0.2, grip_g: 3, slide_grip: 0.5, slide_angle_deg: 20},
        air_pitch_torque: 4, air_roll_torque: 5, wheelie_launch_reward: 6, wheelie_drive_gain: 7,
        boost_recharge_per_s: 8, boost_drain_per_s: 9
      };
      const values = Object.fromEntries(ids.map(id => [id, structuredClone(initial)]));
      let selected = ids[0], reads = 0, writes = 0;
      const panel = await mountTuningPanel({
        input({ui}) {
          if (ui.startsWith('tune-vehicle:')) selected = ui.slice(13);
          else {
            const [path, raw] = ui.slice(5).split('=');
            const keys = path.split('.'); let obj = values[selected];
            for (const key of keys.slice(0, -1)) obj = obj[key];
            obj[keys.at(-1)] = JSON.parse(raw); writes++;
          }
        },
        async tuning() {
          reads++;
          return {vehicle: selected, vehicles: ids, tuning: structuredClone(values[selected]), error: null};
        }
      });
      window.exercise = async () => {
        panel.lab.open();
        while (!panel.lab.inspect().captured) await new Promise(r => setTimeout(r, 0));
        reads = 0; writes = 0;
        await panel.lab.apply({m: {power: 2, turn: 2, grip: 0.5, air: 2, launch: 2, boost: 2}});
        await new Promise(r => setTimeout(r, 250));
        return {reads, writes, values, selected, panel: panel.inspect()};
      };
    `);
    await build({ root: dir, configFile: false, publicDir: false, logLevel: 'silent', build: { outDir: join(dir, 'dist') } });
    server = await serve(join(dir, 'dist'));
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.waitForFunction(() => window.exercise);
    const result = await page.evaluate(() => window.exercise());
    t.diagnostic(`${result.writes} field writes, ${result.reads} worker readbacks`);
    assert.equal(result.selected, 'vehicle-0', 'returns to the selected vehicle');
    assert.equal(result.writes, 14 * 7, 'all fourteen fields reach every vehicle');
    for (const value of Object.values(result.values)) {
      assert.equal(value.max_engine_force, 200);
      assert.equal(value.arcade.turn_g, 4);
      assert.equal(value.arcade.turn_in_s, 0.1);
      assert.equal(value.arcade.grip_g, 1.5);
      assert.equal(value.arcade.slide_angle_deg, 40);
      assert.equal(value.boost_recharge_per_s, 16);
      assert.equal(value.boost_drain_per_s, 4.5);
    }
    assert.equal(result.panel.patch.otherVehicles.length, 6, 'export retains the other six vehicles');
    assert.equal(result.panel.patch.set.length, 14);
    assert.ok(result.panel.patch.otherVehicles.every(v => v.set.length === 14));
    assert.ok(result.reads <= 4 * 7, `worker readbacks scale with vehicle switches, not field count: ${result.reads}`);
  } finally {
    await browser?.close();
    server?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
