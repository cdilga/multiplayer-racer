// P1-C01 Playwright journeys: the landing page under `/` and `/p/x/`, code entry, the links, the token build step and
// the join-path bundle check. Builds the web app twice (a few seconds) and drives real Chromium against a server that
// routes like the game server (plan §5.1).
//   node --test web/landing/tests/
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { analyse } from './bundle-check.mjs';
import { build, serve } from './lib/site.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASES = { '/': 'c01-root', '/p/x/': 'c01-p-x' };
const sites = {};
let browser;

before(async () => {
  browser = await chromium.launch();
  for (const [base, name] of Object.entries(BASES)) {
    const dist = build(base, name);
    sites[base] = { dist, ...(await serve(dist, base)) };
  }
});
after(async () => {
  await browser?.close();
  for (const s of Object.values(sites)) await s.close();
});

const open = async (base, viewport = { width: 390, height: 844 }) => {
  const page = await browser.newPage({ viewport, hasTouch: true });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`error: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  page.on('request', (r) => {
    if (!r.url().startsWith(sites[base].origin)) problems.push(`off-origin request: ${r.url()}`);
  });
  await page.goto(sites[base].origin + base, { waitUntil: 'networkidle' });
  return { page, problems };
};

for (const base of Object.keys(BASES)) {
  describe(`landing under ${base}`, () => {
    test('renders both actions, loads every asset from the base, makes no off-origin request', async () => {
      const { page, problems } = await open(base);
      assert.equal(await page.locator('h1 img').getAttribute('alt'), 'Joystick Jammers');
      assert.ok(await page.getByRole('link', { name: 'Host a room' }).isVisible());
      assert.ok(await page.getByRole('button', { name: 'Join a room' }).isVisible());
      assert.ok(await page.getByRole('button', { name: 'Scan QR code' }).isVisible());
      assert.match(await page.locator('.pitch').innerText(), /one shared screen/);
      assert.ok(!/\bgame\b/i.test(await page.locator('main').innerText()), 'UI copy says room, never game (R112)');
      // Fonts really loaded (self-hosted, from the base), images decoded.
      assert.equal(await page.evaluate(() => document.fonts.check('900 italic 32px "Barlow Condensed"')), true);
      assert.equal(await page.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0)), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal overflow');
      assert.deepEqual(problems, []);
      await page.close();
    });

    test('Host goes to the host app under the base', async () => {
      const { page } = await open(base);
      const href = await page.getByRole('link', { name: 'Host a room' }).getAttribute('href');
      assert.equal(href, `${base}host`);
      const [res] = await Promise.all([page.waitForNavigation({ waitUntil: 'commit' }), page.getByRole('link', { name: 'Host a room' }).click()]);
      assert.equal(new URL(page.url()).pathname, `${base}host`);
      assert.equal(res.status(), 200);
      assert.match(await page.title(), /Host/);
      await page.close();
    });

    test("' ab c d ' joins room ABCD: the controller opens under the base with the code", async () => {
      const { page } = await open(base);
      await page.locator('#code').pressSequentially(' ab c d ');
      assert.equal(await page.locator('#code').inputValue(), 'ABCD');
      await Promise.all([page.waitForURL((u) => u.pathname === `${base}j/ABCD`), page.getByRole('button', { name: 'Join a room' }).click()]);
      assert.match(await page.title(), /Controller/);
      await page.close();
    });

    test('the keyboard path works: Enter in the field submits', async () => {
      const { page } = await open(base);
      await page.locator('#code').fill('xk7m');
      await Promise.all([page.waitForURL((u) => u.pathname === `${base}j/XK7M`), page.keyboard.press('Enter')]);
      await page.close();
    });
  });
}

describe('code entry', () => {
  const base = '/';
  const cases = [
    ['abcd', 'ABCD'],
    ['  ab cd  ', 'ABCD'],
    ['a b c-d', 'ABCD'],
    ['x7k2', 'X7K2'],
  ];
  for (const [typed, shown] of cases) {
    test(`${JSON.stringify(typed)} is shown as ${shown}`, async () => {
      const { page } = await open(base);
      await page.locator('#code').fill(typed);
      await page.locator('#code').dispatchEvent('input');
      assert.equal(await page.locator('#code').inputValue(), shown);
      assert.equal(await page.locator('#code-error').isHidden(), true);
      await page.close();
    });
  }

  for (const [typed, rx] of [
    ['AB0D', /don't use 0/],
    ['ILOO', /don't use I L O/],
    ['a1cd', /don't use 1/],
    ['ab!d', /don't use !/],
  ]) {
    test(`${typed} is refused with a friendly message and does not navigate`, async () => {
      const { page } = await open(base);
      await page.locator('#code').pressSequentially(typed);
      const error = page.locator('#code-error');
      assert.match(await error.innerText(), rx);
      assert.equal(await page.locator('#code').getAttribute('aria-invalid'), 'true');
      await page.getByRole('button', { name: 'Join a room' }).click();
      assert.equal(new URL(page.url()).pathname, '/');
      assert.ok(await error.isVisible());
      await page.close();
    });
  }

  test('empty, short and long codes are refused on submit', async () => {
    const { page } = await open(base);
    const join = page.getByRole('button', { name: 'Join a room' });
    await join.click();
    assert.match(await page.locator('#code-error').innerText(), /Type the 4-letter code/);
    await page.locator('#code').fill('AB');
    await join.click();
    assert.match(await page.locator('#code-error').innerText(), /4 characters/);
    await page.locator('#code').fill('ABCDE');
    await join.click();
    assert.match(await page.locator('#code-error').innerText(), /too many/);
    assert.equal(new URL(page.url()).pathname, '/');
    await page.close();
  });

  test('the Scan QR code stub answers with a toast and does not navigate', async () => {
    const { page } = await open(base);
    await page.getByRole('button', { name: 'Scan QR code' }).click();
    assert.match(await page.locator('.toast').innerText(), /Scanning isn't ready/);
    assert.equal(new URL(page.url()).pathname, '/');
    await page.close();
  });

  test('keyboard focus is visible on the field and both buttons', async () => {
    const { page } = await open(base);
    for (const id of ['#host-link', '#code', '#scan', '#join']) {
      await page.locator(id).focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const w = await page.locator(id).evaluate((el) => getComputedStyle(el).outlineWidth);
      assert.notEqual(w, '0px', `${id} shows a focus ring`);
    }
    await page.close();
  });
});

describe('layout', () => {
  const sizes = [
    [390, 844], [844, 390], [412, 915], [375, 667], [820, 1180], [1366, 768], [1920, 1080],
  ];
  for (const [w, h] of sizes) {
    test(`${w}x${h}: no horizontal overflow and both panels reachable`, async () => {
      const { page } = await open('/', { width: w, height: h });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      for (const name of ['Host a room', 'Join a room']) {
        const b = page.getByRole(name === 'Host a room' ? 'link' : 'button', { name });
        await b.scrollIntoViewIfNeeded();
        const r = await b.boundingBox();
        assert.ok(r.x >= 0 && r.x + r.width <= w && r.y >= 0 && r.y + r.height <= h, `${name} sits inside ${w}x${h}`);
        assert.ok(r.height >= 48, `${name} is at least 48 px tall`);
      }
      await page.close();
    });
  }
});

describe('portrait phones: Join first, code field and Join button on the first screen', () => {
  for (const [w, h] of [[375, 667], [390, 844], [412, 915]]) {
    test(`${w}x${h}: field and Join sit fully inside the viewport, above Host`, async () => {
      const { page } = await open('/', { width: w, height: h });
      const inside = (r) => r.x >= 0 && r.y >= 0 && r.x + r.width <= w && r.y + r.height <= h;
      const join = await page.getByRole('button', { name: 'Join a room' }).boundingBox();
      const field = await page.locator('#code').boundingBox();
      const host = await page.getByRole('link', { name: 'Host a room' }).boundingBox();
      assert.ok(inside(join), `Join rect ${JSON.stringify(join)} inside ${w}x${h}`);
      assert.ok(inside(field), `code field rect ${JSON.stringify(field)} inside ${w}x${h}`);
      assert.ok(join.y < host.y, 'Join panel is above Host');
      await page.close();
    });
  }
});

describe('token build step', () => {
  test('tokens.generated.css is up to date with the token file', () => {
    execFileSync(process.execPath, [join(web, 'shared', 'ui', 'build-tokens.mjs'), '--check'], { stdio: 'pipe' });
  });
  test('the generated CSS carries the palette, fonts and all three profiles', async () => {
    const { page } = await open('/');
    const v = (n) => page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), n);
    assert.equal((await v('--c-saffron')).toLowerCase(), '#ffb400');
    assert.equal(await v('--fs-body'), '17px');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.profile), 'handheld');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForFunction(() => document.documentElement.dataset.profile === 'tv');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontSize), '32px');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForFunction(() => document.documentElement.dataset.profile === 'desk');
    await page.close();
  });
});

describe('bundle: the join path stays light', () => {
  for (const base of Object.keys(BASES)) {
    test(`no Three.js, renderer, sim or WASM reachable from the landing or controller pages (${base})`, () => {
      const { report, problems } = analyse(sites[base].dist);
      assert.deepEqual(problems, []);
      assert.ok(report.landing.files.length > 3 && report.join.files.length >= 2, 'the check followed real files');
    });
  }
  test('the check itself catches the host page (it does reach Three.js and the sim)', () => {
    const { problems } = analyse(sites['/'].dist, { host: 'host/index.html' });
    assert.ok(problems.some((p) => /three/i.test(p)), `expected a Three.js problem, got ${JSON.stringify(problems)}`);
  });
});
