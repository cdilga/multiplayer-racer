// P1-C04 in-page QR scanner. Chromium's fake camera plays a recorded QR (a Y4M made here with the bundled `uqr`): the
// landing page's Scan QR code decodes it (the bundled `jsqr`, and `BarcodeDetector` when this Chromium has one) and joins.
// Also: an unrelated QR is turned away with scanning going on, a denied camera keeps code entry (and what was typed),
// and every camera track ends on success, cancel and `visibilitychange`. No network beyond the page's own origin.
//   node --test web/tests/journeys/c04-scan.test.mjs   (no WebRTC: runs on the Mac)
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';
import { encode } from 'uqr';
import { build, serve } from '../../landing/tests/lib/site.mjs';

const BASE = '/p/c04/';
let server;
let dist;
const dir = mkdtempSync(join(tmpdir(), 'c04-'));
const browsers = [];

/** A Y4M of `text` as a QR, 10 px per module, full quiet zone, centred on a 640x480 frame. */
function qrY4m(path, text) {
  const w = 640;
  const h = 480;
  const px = 10;
  const { data, size } = encode(text, { ecc: 'M', border: 4 });
  const ox = Math.floor((w - size * px) / 2);
  const oy = Math.floor((h - size * px) / 2);
  const y = Buffer.alloc(w * h, 128);
  for (let j = 0; j < size * px; j++) for (let i = 0; i < size * px; i++) y[(oy + j) * w + ox + i] = data[Math.floor(j / px)][Math.floor(i / px)] ? 16 : 235;
  const c = Buffer.alloc((w / 2) * (h / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, c, c]);
  writeFileSync(path, Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`), ...Array(30).fill(frame)]));
}

before(async () => {
  dist = build('./', 'c04scan');
  server = await serve(dist, BASE);
});
after(async () => {
  for (const b of browsers) await b.close();
  await server?.close();
});


// `JJ_CAPTURE_DIR=<dir>`: save the visual self-review matrix there (eris.sh points it into the run dir).
const CAPTURE = process.env.JJ_CAPTURE_DIR;
const shot = async (page, name) => {
  if (!CAPTURE) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};
const SIZES = { 'phone-portrait-390x844': [390, 844], 'phone-landscape-844x390': [844, 390], 'tv-1920x1080': [1920, 1080] };
/** Capture at each device size, then back to where it was (a resize with the state kept). */
const matrix = async (page, name, back) => {
  if (!CAPTURE) return;
  for (const [label, [w, h]] of Object.entries(SIZES)) {
    await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${label}`);
  }
  await page.setViewportSize(back);
  await page.waitForTimeout(300);
  await shot(page, `${name}-resized-back`);
};

let n = 0;
async function launch(text) {
  const file = join(dir, `qr${n++}.y4m`);
  qrY4m(file, text);
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${file}`] });
  browsers.push(b);
  return b;
}

/** A phone page with every camera stream recorded (so tests can count live tracks), optionally without BarcodeDetector. */
async function phone(browser, { native = true, deny = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['camera'] });
  const page = await ctx.newPage();
  const foreign = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(server.origin) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u);
  });
  await page.addInitScript(
    ({ native, deny }) => {
      if (!native) Object.defineProperty(window, 'BarcodeDetector', { value: undefined, configurable: true });
      window.__streams = [];
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => {
        if (deny) throw new DOMException('Permission denied', 'NotAllowedError');
        sessionStorage.setItem('camReq', JSON.stringify(c));
        const s = await real(c);
        window.__streams.push(s);
        // A ledger that survives the navigation a successful scan causes: tracks opened, tracks stopped.
        for (const t of s.getTracks()) {
          sessionStorage.setItem('opened', String(+(sessionStorage.getItem('opened') ?? 0) + 1));
          const stop = t.stop.bind(t);
          t.stop = () => {
            sessionStorage.setItem('stopped', String(+(sessionStorage.getItem('stopped') ?? 0) + 1));
            stop();
          };
        }
        return s;
      };
    },
    { native, deny },
  );
  await page.goto(server.origin + BASE, { waitUntil: 'networkidle' });
  return { page, foreign };
}
const live = (page) => page.evaluate(() => window.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);
const total = (page) => page.evaluate(() => window.__streams.flatMap((s) => s.getTracks()).length);
const joinUrl = (code) => `${server.origin}${BASE}j/${code}`;

describe('the scanner decodes a recorded TV QR and joins', () => {
  for (const native of [false, true]) {
    test(`${native ? 'BarcodeDetector when this Chromium has it, else the bundled decoder' : 'the bundled decoder'}`, { timeout: 60_000 }, async () => {
      const b = await launch(joinUrl('K7QX'));
      const { page, foreign } = await phone(b, { native });
      await page.fill('#code', 'AB');
      await page.getByRole('button', { name: 'Scan QR code' }).click();
      await page.waitForSelector('[data-overlay=scan] video');
      await page.waitForURL(joinUrl('K7QX'), { timeout: 30_000 });
      const led = await page.evaluate(() => ({ req: JSON.parse(sessionStorage.getItem('camReq')), opened: +sessionStorage.getItem('opened'), stopped: +sessionStorage.getItem('stopped') }));
      assert.equal(led.req.audio, false, 'video only');
      assert.ok(led.opened >= 1);
      assert.equal(led.stopped, led.opened, 'every track stopped on success');
      assert.deepEqual(foreign, [], 'no request beyond the page origin (the decoder is in the bundle)');
    });
  }
  test('a bare room code on the QR also joins', { timeout: 60_000 }, async () => {
    const b = await launch('K7QX');
    const { page } = await phone(b, { native: false });
    await page.getByRole('button', { name: 'Scan QR code' }).click();
    await page.waitForURL(joinUrl('K7QX'), { timeout: 30_000 });
  });
});

describe('what is rejected', () => {
  const unrelated = {
    'another site': () => 'https://example.com/j/K7QX',
    'this server but another preview': () => `${server.origin}/p/other/j/K7QX`,
    'this realm but not a join path': () => `${server.origin}${BASE}host`,
    'not a URL or a code': () => 'WIFI:S:home;T:WPA;P:secret;;',
  };
  for (const [name, text] of Object.entries(unrelated)) {
    test(`an unrelated QR (${name}) is turned away and scanning goes on`, { timeout: 60_000 }, async () => {
      const b = await launch(text());
      const { page } = await phone(b, { native: false });
      await page.getByRole('button', { name: 'Scan QR code' }).click();
      await page.getByText("That QR code isn't for this room").waitFor({ timeout: 30_000 });
      assert.equal(new URL(page.url()).pathname, BASE, 'did not navigate');
      if (name === 'another site') await matrix(page, 'c04-scanner-unrelated-qr', { width: 390, height: 844 });
      assert.ok((await live(page)) >= 1, 'still scanning');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await live(page), 0, 'every track stopped on cancel');
    });
  }
});

describe('the camera and code entry', () => {
  test('a denied camera keeps code entry usable and what was typed', async () => {
    const b = await launch('K7QX');
    const { page } = await phone(b, { deny: true });
    await page.fill('#code', 'AB');
    await page.getByRole('button', { name: 'Scan QR code' }).click();
    await page.getByText('Camera access is blocked').waitFor();
    assert.equal(await page.inputValue('#code'), 'AB');
    assert.equal(await page.locator('[data-overlay=scan]').count(), 0);
    await shot(page, 'c04-camera-denied-390x844');
    await page.fill('#code', 'K7QX');
    await page.getByRole('button', { name: 'Join a room' }).click();
    await page.waitForURL(joinUrl('K7QX'));
  });

  test('"Enter the code instead", Cancel and visibilitychange each end the camera and keep the typed code', { timeout: 60_000 }, async () => {
    const b = await launch('https://example.com/nope');
    const { page } = await phone(b, { native: false });
    await page.fill('#code', 'K7');
    for (const how of ['instead', 'cancel', 'hidden']) {
      await page.getByRole('button', { name: 'Scan QR code' }).click();
      await page.waitForSelector('[data-overlay=scan] video');
      if (how === 'instead') await shot(page, 'c04-scanner-open-390x844');
      await page.waitForFunction(() => window.__streams.at(-1)?.getTracks().some((t) => t.readyState === 'live'));
      if (how === 'instead') await page.getByRole('button', { name: 'Enter the code instead' }).click();
      else if (how === 'cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      else {
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForSelector('[data-overlay=scan]', { state: 'detached' });
        await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }));
      }
      assert.equal(await live(page), 0, `no live track after ${how}`);
      assert.equal(await page.inputValue('#code'), 'K7', `typed input kept after ${how}`);
    }
    assert.equal(await total(page), 3);
  });
});

describe('the decoder is served from the bundle', () => {
  test('the build holds jsQR in its own asset chunk, and that chunk names no external host', () => {
    const files = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));
    const hit = files.filter((f) => readFileSync(join(dist, 'assets', f), 'utf8').includes('jsQR'));
    assert.ok(hit.length >= 1, 'a bundled chunk holds the decoder');
    for (const f of hit) {
      const text = readFileSync(join(dist, 'assets', f), 'utf8');
      const hosts = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
      assert.deepEqual(hosts, [], `${f} names no host`);
    }
  });
});
