// Journey helpers that add and remove controllers of mixed kinds at any moment (P1-F10, plan §13.1/§13.2). One automation
// stack: Playwright contexts for phones and pads, F08's emulator drivers (./emulators.mjs) for emulators. Each controller has
// its own browser context (its own profile and storage), its own evidence folder, and joins the host's room by URL; the pool
// can say at any moment whether the host's view of the room (the hello page's markers) is exactly the controllers that are
// in it: a marker for a controller that left is a phantom.
//
//   const pool = new ControllerPool({ base, host, browsers: { chromium }, evidence });
//   const a = await pool.add('phone');           // a touch phone: drives its stick with pointer events on the pad
//   const b = await pool.add('pad');             // an emulated pad: sets its stick axis through the page's own API
//   const c = await pool.add('android');         // the Android emulator (when the lane exists on this machine)
//   await pool.stick(a, 0.5, -0.5);  await pool.remove(b);  await pool.check();
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { androidController, iosController } from './emulators.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ControllerPool {
  /**
   * @param {object} o
   * @param {string} o.base       the served build's base URL, ending in `/`
   * @param {import('playwright').Page} o.host   the hello host page (`B/host?hello`), already opened
   * @param {Record<string, import('playwright').Browser>} o.browsers   by engine: `chromium`, `webkit`, `firefox`
   * @param {string} o.evidence   the run's evidence folder (one subfolder per controller)
   * @param {string} [o.engine]   which engine phones and pads use (default `chromium`)
   * @param {number} [o.port]     the server's port (emulators reach it through adb reverse)
   * @param {object} [o.emulators]  `{ ios: { udid } }` for the iOS lane
   */
  constructor({ base, host, browsers, evidence, engine = 'chromium', port, emulators = {}, log = () => {} }) {
    Object.assign(this, { base, host, browsers, evidence, engine, port, emulators, log });
    this.seq = 0;
    /** @type {Map<number, object>} */
    this.live = new Map();
    this.timeline = [];
  }

  get code() {
    return this.host.evaluate(() => window.__jjHello.code());
  }

  get size() {
    return this.live.size;
  }

  /** The endpoint ids of the controllers that are in the room now. */
  endpoints() {
    return [...this.live.values()].map((c) => c.endpoint).filter(Boolean).sort();
  }

  /** The hello host's markers (endpoint → stick), the host's own view of who is here. */
  markers() {
    return this.host.evaluate(() => window.__jjHello.markers());
  }

  async add(kind, { name = `${kind}-${this.seq + 1}` } = {}) {
    const id = ++this.seq;
    const dir = path.join(this.evidence, `c${String(id).padStart(2, '0')}-${kind}`);
    mkdirSync(dir, { recursive: true });
    const code = await this.code;
    const url = `${this.base}j/${code}?hello`;
    const known = new Set(Object.keys(await this.markers()));
    let c;
    if (kind === 'phone' || kind === 'pad') {
      const browser = this.browsers[this.engine];
      if (!browser) throw new Error(`no ${this.engine} browser in this run`);
      // Chromium contexts get the touch and mobile profile of a phone; a pad has none (a pad has no screen to touch).
      const ctx = await browser.newContext(
        kind === 'phone' && this.engine !== 'firefox'
          ? { hasTouch: true, isMobile: this.engine === 'chromium', viewport: { width: 390, height: 844 } }
          : { viewport: { width: 390, height: 844 } },
      );
      const page = await ctx.newPage();
      page.on('pageerror', (e) => this.log(`${name}: pageerror ${e.message}`));
      await page.goto(url);
      await page.waitForFunction(() => window.__jjHello?.link().state === 'connected', undefined, { timeout: 90_000 });
      const endpoint = await page.evaluate(() => window.__jjHello.link().endpointId);
      c = { id, kind, name, endpoint, engine: this.engine, dir, page, ctx };
    } else if (kind === 'android') {
      const em = await androidController({ port: this.port, log: this.log });
      const endpoint = await em.join(url.replace(/^https?:\/\/[^/]+/, `http://localhost:${this.port}`));
      c = { id, kind, name, endpoint, engine: em.label, dir, em, target: em.target };
    } else if (kind === 'ios') {
      const em = await iosController({ udid: this.emulators.ios.udid, log: this.log });
      await em.join(url.replace(/^https?:\/\/[^/]+/, `http://localhost:${this.port}`));
      const endpoint = await this.#newMarker(known);
      c = { id, kind, name, endpoint, engine: em.label, dir, em, target: em.target };
    } else {
      throw new Error(`unknown controller kind ${kind}`);
    }
    await this.#seen(c.endpoint);
    this.live.set(id, c);
    this.timeline.push({ at: Date.now(), op: 'add', id, kind, engine: c.engine, size: this.live.size });
    return c;
  }

  async #newMarker(known) {
    const deadline = Date.now() + 90_000;
    for (;;) {
      const fresh = Object.keys(await this.markers()).filter((e) => !known.has(e));
      if (fresh.length === 1) return fresh[0];
      if (fresh.length > 1) throw new Error(`more than one new marker appeared: ${fresh}`);
      if (Date.now() > deadline) throw new Error('no marker appeared for the emulator');
      await sleep(500);
    }
  }

  /** The host has a marker for `endpoint` (it opened the data channel). */
  async #seen(endpoint) {
    if (!endpoint) return;
    await this.host.waitForFunction((ep) => ep in window.__jjHello.markers(), endpoint, { timeout: 60_000, polling: 100 });
  }

  /** Moves a controller's stick and waits for the host's marker to follow. */
  async stick(c, x, y) {
    if (c.page && c.kind === 'phone') {
      // A touch phone drives the pad with pointer events, the way a thumb would.
      const box = await c.page.locator('[data-jj-pad]').boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await c.page.mouse.move(cx, cy);
      await c.page.mouse.down();
      await c.page.mouse.move(cx + (x * box.width) / 2, cy + (y * box.height) / 2, { steps: 4 });
    } else if (c.page) {
      await c.page.evaluate(([x, y]) => window.__jjHello.setStick(x, y), [x, y]);
    } else if (c.kind === 'android') {
      await c.em.setStick(x, y);
    } else {
      return; // Mobile Safari: no stick through the harness; joining and leaving are what it does
    }
    await this.host.waitForFunction(([ep, x, y]) => {
      const m = window.__jjHello.markers()[ep];
      return m && Math.abs(m.x - x) < 0.08 && Math.abs(m.y - y) < 0.08;
    }, [c.endpoint, x, y], { timeout: 30_000, polling: 100 });
    if (c.page && c.kind === 'phone') await c.page.mouse.up();
  }

  /** A controller leaves: its page closes (a `bye` goes out) or, for an emulator, its browser is stopped. */
  async remove(c) {
    if (c.ctx) await c.ctx.close().catch(() => {});
    else await c.em.leave();
    this.live.delete(c.id);
    this.timeline.push({ at: Date.now(), op: 'remove', id: c.id, kind: c.kind, engine: c.engine, size: this.live.size });
    if (c.endpoint) await this.host.waitForFunction((ep) => !(ep in window.__jjHello.markers()), c.endpoint, { timeout: 60_000, polling: 100 });
  }

  /** The host's markers are exactly the endpoints of the controllers in the room: no phantom, none missing. */
  async check() {
    const want = this.endpoints();
    let got = Object.keys(await this.markers()).sort();
    for (let i = 0; i < 40 && JSON.stringify(got) !== JSON.stringify(want); i++) {
      await sleep(250);
      got = Object.keys(await this.markers()).sort();
    }
    const phantoms = got.filter((e) => !want.includes(e));
    const missing = want.filter((e) => !got.includes(e));
    const who = (ep) => [...this.live.values()].find((c) => c.endpoint === ep);
    return {
      ok: !phantoms.length && !missing.length,
      live: this.live.size,
      markers: got.length,
      phantoms,
      missing,
      missingAre: missing.map((ep) => `${who(ep)?.name}:${who(ep)?.kind}`),
    };
  }

  async closeAll() {
    const all = [...this.live.values()];
    for (const c of all) await this.remove(c).catch(() => {});
    for (const c of all) await c.em?.close?.();
  }
}
