// node capture_video.mjs — deterministic 30 fps frames → out/*.mp4 / *.gif (ffmpeg)
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const FR = '/private/tmp/claude-501/-Users-cdilga-Documents-dev-multiplayer-racer/994ef654-1d80-42bf-8ad7-7327bb5486d3/scratchpad/frames';
const W = 960, H = 600, FPS = 30;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
async function run(name, model, seconds, cam, extra) {
  fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.goto(`http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&w=${W}&h=${H}&model=${model}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  await page.evaluate(() => window.__demo.startSequence());
  const n = seconds * FPS;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    await page.evaluate(([t, cam, i, FPS, extra]) => {
      const d = window.__demo; d.frame(1 / FPS);
      if (extra && extra.squishAt && i === Math.round(extra.squishAt * FPS)) d.squish(1);
      d.look(cam.t, cam.az0 + (cam.az1 - cam.az0) * t, cam.el, cam.d0 + (cam.d1 - cam.d0) * t, 30); d.render();
    }, [t, cam, i, FPS, extra]);
    await page.screenshot({ path: `${FR}/f${String(i).padStart(4, '0')}.png` });
  }
  await page.close();
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${FR}/f%04d.png -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart out/${name}.mp4`);
  execSync(`ffmpeg -y -loglevel error -i out/${name}.mp4 -vf "fps=15,scale=560:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" out/${name}.gif`);
  console.log(name, fs.statSync(`out/${name}.mp4`).size, fs.statSync(`out/${name}.gif`).size);
}
await run('cruze_smash', 'cruze', 8, { t: [0, 0.7, 0.3], az0: 28, az1: 78, el: 16, d0: 7.4, d1: 6.4 });
await run('bin_smash', 'bin', 7, { t: [0, 0.5, 0], az0: 30, az1: 70, el: 15, d0: 5.4, d1: 5.0 }, { squishAt: 4.3 });
await browser.close();
