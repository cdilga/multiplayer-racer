// Engine synth gallery (P1-A04). Static: no CDN, no build step. Loads the P1-U01 tokens (art/ui/tokens.json) for
// its look, the Cruz Missile profile (assets/audio/engine/cruz-missile.json), the scripted lap (lap.json) and the
// synth module (engine-synth.js, built from web/shared/audio/engine-synth/ by build.mjs). Serve the repo root.
import * as synth from './engine-synth.js';
import * as lapRunner from './lap-runner.js';

const $ = (id) => document.getElementById(id);
const rel = (p) => new URL(p, import.meta.url).href;
const SURFACE_NAMES = ['tarmac', 'dirt', 'gravel'];
const SURFACE_LABEL = { tarmac: 'Tarmac', dirt: 'Dirt', gravel: 'Gravel' };

const LAYER_COPY = {
  firing: ['Engine note', 'Firing pulses at rpm ÷ 60 × cylinders ÷ 2, with harmonics. Throttle brightens it.'],
  intake: ['Intake', 'Air rush that climbs with revs and throttle.'],
  exhaust: ['Exhaust', 'Noise chopped at the firing rate, so every pulse chuffs.'],
  boost: ['Boost whine', 'A whistle that sweeps with boost and revs, plus a whoosh.'],
  squeal: ['Tyre squeal', 'Narrow filtered noise with a wobble, from drift and speed.'],
  surface: ['Road rumble', 'Tarmac hum, dirt crunch or gravel crackle, from speed.'],
  rattle: ['Loose-part rattle', 'Tinny clatter that grows with damage and revs.'],
  pops: ['Exhaust pops', 'Crackles when you lift off at revs, and on a hard upshift.'],
};

const PRESETS = {
  idle: { rpm: 900, throttle: 0, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 0 },
  cruise: { rpm: 3200, throttle: 0.35, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 4 },
  flat: { rpm: 6600, throttle: 1, boost: 1, drift: 0, surface: 'tarmac', damage: 0, gear: 5 },
  wrecked: { rpm: 2600, throttle: 0.6, boost: 0, drift: 0.4, surface: 'gravel', damage: 1, gear: 3 },
};

// ---- tokens -> CSS variables (mirrors art/ui/sheets/tokens-css.js, with URLs resolved from this file) -------------
async function applyTokens() {
  const tokens = await (await fetch(rel('../../../tokens.json'))).json();
  const wanted = new URLSearchParams(location.search).get('profile');
  const auto = matchMedia('(max-width: 640px)').matches ? 'handheld' : 'desk';
  const profile = tokens.type.profiles[wanted] ? wanted : auto;
  const k = profile === 'tv' ? Math.max(0.5, innerHeight / 1080) : 1; // TV values are px at 1080p
  const px = (v) => `${+(v * k).toFixed(2)}px`;
  const css = [];
  for (const face of [tokens.fonts.display, tokens.fonts.body]) {
    for (const f of face.files) {
      css.push(`@font-face{font-family:"${face.family}";src:url("${rel(`../../../${f.file}`)}") format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:block}`);
    }
  }
  const vars = [];
  for (const [name, c] of Object.entries(tokens.palette)) vars.push(`--c-${name}:${c.hex}`);
  const fallback = tokens.fonts.fallback.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(',');
  vars.push(`--font-display:"${tokens.fonts.display.family}",${fallback}`);
  vars.push(`--font-body:"${tokens.fonts.body.family}",${fallback}`);
  for (const [name, v] of Object.entries(tokens.type.profiles[profile].scale)) vars.push(`--fs-${name}:${px(v)}`);
  const mult = tokens.space.profileMultiplier[profile];
  tokens.space.steps.forEach((s, i) => vars.push(`--sp-${i}:${px(s * mult)}`));
  const outline = tokens.ink.outlinePx[profile];
  vars.push(`--outline:${px(outline)}`);
  vars.push(`--radius:${px(tokens.layout.radiusPx[profile])}`);
  vars.push(`--touch:${px(tokens.layout.minTouchTargetPx)}`);
  const shY = (tokens.ink.stickerShadow.y * outline) / 3; // the sticker shadow scales with the outline (guide §5)
  vars.push(`--sh-y:${px(shY)}`);
  vars.push(`--shadow-c:rgb(21 32 58 / ${tokens.ink.stickerShadow.opacity})`);
  vars.push(`--focus-kb-w:${px(tokens.focus.keyboard.widthPx[profile])}`, `--focus-kb-off:${px(tokens.focus.keyboard.offsetPx[profile])}`);
  css.push(`:root{${vars.join(';')}}`);
  const style = document.createElement('style');
  style.textContent = css.join('\n');
  document.head.append(style);
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
  await document.fonts.ready;
  return { tokens, profile };
}

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

// ---- app state ---------------------------------------------------------------------------------------------
let profile = null;
let lap = null;
let ctx = null;
let master = null;
let analyser = null;
let voice = null;
let runner = null;
// `speed: undefined` is explicit: set() merges, and the lap passes a speed that must not stick once the sliders drive.
const manual = { rpm: 900, throttle: 0, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 1, speed: undefined };
const lapState = { active: false, startedAt: 0 };
const mix = { muted: new Set(), solo: null };
let volume = 0.8;
let shownGear = -1;
let meterEls = {};
let timeBuf = null;
let freqBuf = null;
let lastShown = null;

const sliderIds = ['rpm', 'throttle', 'boost', 'drift', 'surface', 'damage', 'volume'];
const el = Object.fromEntries(sliderIds.map((n) => [n, $(`in-${n}`)]));

function fmtOut(name, v) {
  if (name === 'rpm') return String(Math.round(v));
  if (name === 'surface') return SURFACE_LABEL[SURFACE_NAMES[v]] ?? '';
  return `${Math.round(v)}<span class="unit">%</span>`;
}

function paintSlider(name) {
  const input = el[name];
  const min = Number(input.min);
  const max = Number(input.max);
  input.style.setProperty('--pct', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  $(`out-${name}`).innerHTML = fmtOut(name, Number(input.value));
  if (name === 'surface') input.setAttribute('aria-valuetext', SURFACE_LABEL[SURFACE_NAMES[Number(input.value)]] ?? '');
}

/** Put a state on the sliders (used by presets and while the lap drives). */
function showOnSliders(s) {
  el.rpm.value = String(Math.round(s.rpm));
  el.throttle.value = String(Math.round(s.throttle * 100));
  el.boost.value = String(Math.round(s.boost * 100));
  el.drift.value = String(Math.round(s.drift * 100));
  el.surface.value = String(Math.max(0, SURFACE_NAMES.indexOf(s.surface)));
  el.damage.value = String(Math.round(s.damage * 100));
  for (const n of sliderIds) paintSlider(n);
}

function readManualFromSliders() {
  manual.rpm = Number(el.rpm.value);
  manual.throttle = Number(el.throttle.value) / 100;
  manual.boost = Number(el.boost.value) / 100;
  manual.drift = Number(el.drift.value) / 100;
  manual.surface = SURFACE_NAMES[Number(el.surface.value)] ?? 'tarmac';
  manual.damage = Number(el.damage.value) / 100;
}

// ---- dash --------------------------------------------------------------------------------------------------
function showDash(s) {
  lastShown = s;
  const e = profile.engine;
  $('rpm-n').textContent = String(Math.round(s.rpm));
  $('tach-fill').style.transform = `scaleX(${Math.min(1, s.rpm / e.limiterRpm)})`;
  $('fire-hz').textContent = `${synth.firingHz(e.cylinders, s.rpm).toFixed(0)} Hz`;
  const speed = s.speed ?? synth.speedFromRpm(profile, s.rpm, s.gear);
  $('speed-kmh').textContent = `${Math.round(speed * 3.6)} km/h`;
  if (s.gear !== shownGear) {
    const first = shownGear === -1;
    shownGear = s.gear;
    $('gear-n').textContent = s.gear === 0 ? 'N' : String(s.gear);
    if (!first) {
      const g = $('gear');
      g.classList.add('shift');
      setTimeout(() => g.classList.remove('shift'), 280);
    }
  }
}

// ---- layers panel ------------------------------------------------------------------------------------------
function buildLayers() {
  const ul = $('layers');
  for (const name of synth.LAYERS) {
    const [title, caption] = LAYER_COPY[name];
    const li = document.createElement('li');
    li.className = 'layer';
    li.dataset.layer = name;
    li.innerHTML = `<h3></h3><p></p><div class="ctl"><label class="check"><input type="checkbox" checked><span>On</span></label><button class="btn btn-small" type="button" aria-pressed="false">Solo</button></div><div class="meter" aria-hidden="true"><i></i></div>`;
    li.querySelector('h3').textContent = title;
    li.querySelector('p').textContent = caption;
    li.querySelector('input').setAttribute('aria-label', `${title} on`);
    li.querySelector('button').setAttribute('aria-label', `Solo ${title}`);
    li.querySelector('input').addEventListener('change', (ev) => {
      if (ev.target.checked) mix.muted.delete(name);
      else mix.muted.add(name);
      applyMix();
    });
    li.querySelector('button').addEventListener('click', () => {
      mix.solo = mix.solo === name ? null : name;
      applyMix();
    });
    ul.append(li);
    meterEls[name] = li.querySelector('.meter i');
  }
}

function applyMix() {
  for (const li of document.querySelectorAll('.layer')) {
    const name = li.dataset.layer;
    const on = mix.solo ? mix.solo === name : !mix.muted.has(name);
    li.dataset.off = String(!on);
    li.querySelector('button').setAttribute('aria-pressed', String(mix.solo === name));
    li.querySelector('input').checked = !mix.muted.has(name);
    voice?.setLayerEnabled(name, on);
  }
}

// ---- audio -------------------------------------------------------------------------------------------------
async function ensureAudio() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = volume;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.6;
    timeBuf = new Float32Array(analyser.fftSize);
    freqBuf = new Float32Array(analyser.frequencyBinCount);
    voice = synth.create(ctx, profile, { destination: master, initial: { ...manual } });
    master.connect(analyser);
    analyser.connect(ctx.destination);
    applyMix();
  }
  if (ctx.state !== 'running') await ctx.resume();
  setStatus();
}

function setStatus() {
  const on = ctx?.state === 'running';
  $('status').dataset.on = String(on);
  $('status').textContent = on ? 'Engine running' : 'Engine off. Press start to allow sound.';
  $('start-btn').textContent = on ? 'Stop engine' : 'Start engine';
  $('start-btn').classList.toggle('btn-primary', !on);
}

async function toggleEngine() {
  if (ctx?.state === 'running') {
    if (lapState.active) stopLap();
    await ctx.suspend();
    setStatus();
  } else {
    await ensureAudio();
    voice.set(manual);
  }
}

// ---- lap ---------------------------------------------------------------------------------------------------
function setSlidersDriven(driven) {
  for (const n of sliderIds) if (n !== 'volume') el[n].disabled = driven;
  for (const b of document.querySelectorAll('[data-preset], #shift-up, #shift-down')) b.disabled = driven;
  $('driven-note').textContent = driven ? 'The scripted lap is driving the sliders. Stop it to take over.' : '';
}

async function startLap() {
  await ensureAudio();
  runner = lapRunner.createLapRunner(profile, lap);
  lapState.active = true;
  lapState.startedAt = ctx.currentTime;
  $('lap-btn').textContent = 'Stop lap';
  $('lap-btn').classList.add('btn-primary');
  $('lap-line').hidden = false;
  setSlidersDriven(true);
}

function stopLap() {
  if (!lapState.active) return;
  lapState.active = false;
  $('lap-btn').textContent = 'Play scripted lap';
  $('lap-btn').classList.remove('btn-primary');
  setSlidersDriven(false);
  // Hand back to the sliders, in neutral at idle so the engine settles.
  Object.assign(manual, PRESETS.idle, { gear: 1 });
  showOnSliders(manual);
  voice?.set(manual);
  showDash(manual);
}

function lapFrame() {
  const t = ctx.currentTime - lapState.startedAt;
  if (t >= lap.durationS) {
    $('lap-time').textContent = `${lap.durationS.toFixed(1)} / ${lap.durationS.toFixed(1)} s`;
    stopLap();
    return;
  }
  const s = runner.stateAt(t);
  voice.set(s);
  showOnSliders(s);
  showDash(s);
  $('lap-fill').style.transform = `scaleX(${t / lap.durationS})`;
  $('lap-time').textContent = `${t.toFixed(1)} / ${lap.durationS.toFixed(1)} s`;
  const beat = [...lap.story].reverse().find(([at]) => at <= t);
  $('lap-story').innerHTML = '';
  const b = document.createElement('b');
  b.textContent = beat ? beat[1] : '';
  $('lap-story').append(b);
}

// ---- scope + meters ------------------------------------------------------------------------------------------
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function drawScope() {
  const canvas = $('scope');
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (!analyser) return;
  analyser.getFloatFrequencyData(freqBuf);
  const sr = ctx.sampleRate;
  const binHz = sr / analyser.fftSize;
  const lo = 40;
  const hi = 12000;
  const bars = Math.max(24, Math.floor(canvas.clientWidth / 5));
  const ink = cssVar('--c-ink');
  const saffron = cssVar('--c-saffron');
  const bw = w / bars;
  let peakDb = -200;
  let peakHz = 0;
  for (let i = 0; i < bars; i++) {
    const f0 = lo * Math.pow(hi / lo, i / bars);
    const f1 = lo * Math.pow(hi / lo, (i + 1) / bars);
    let m = -200;
    for (let b = Math.max(1, Math.floor(f0 / binHz)); b <= Math.max(1, Math.ceil(f1 / binHz)); b++) m = Math.max(m, freqBuf[b] ?? -200);
    if (m > peakDb) {
      peakDb = m;
      peakHz = (f0 + f1) / 2;
    }
    const level = Math.max(0, Math.min(1, (m + 88) / 62));
    const bh = level * (h - 8 * dpr);
    g.fillStyle = ink;
    g.fillRect(i * bw + dpr, h - bh, Math.max(1, bw - 2 * dpr), bh);
    if (level > 0.02) {
      g.fillStyle = saffron;
      g.fillRect(i * bw + dpr, h - bh, Math.max(1, bw - 2 * dpr), Math.min(bh, 4 * dpr));
    }
  }
  $('peak-hz').textContent = peakDb > -95 ? (peakHz >= 1000 ? `${(peakHz / 1000).toFixed(1)} kHz` : `${Math.round(peakHz)} Hz`) : '-';
}

function probe() {
  const out = { ctxState: ctx?.state ?? 'none', time: ctx?.currentTime ?? 0, lapActive: lapState.active, rms: 0, peakHz: 0, centroidHz: 0, state: voice?.state() ?? null };
  if (!analyser) return out;
  analyser.getFloatTimeDomainData(timeBuf);
  let s = 0;
  for (const v of timeBuf) s += v * v;
  out.rms = Math.sqrt(s / timeBuf.length);
  analyser.getFloatFrequencyData(freqBuf);
  const binHz = ctx.sampleRate / analyser.fftSize;
  let num = 0;
  let den = 0;
  let best = -Infinity;
  for (let b = 1; b < freqBuf.length; b++) {
    const lin = Math.pow(10, freqBuf[b] / 20);
    num += b * binHz * lin;
    den += lin;
    if (freqBuf[b] > best) {
      best = freqBuf[b];
      out.peakHz = b * binHz;
    }
  }
  out.centroidHz = den > 0 ? num / den : 0;
  return out;
}

function frame() {
  if (ctx && voice) {
    if (lapState.active && ctx.state === 'running') lapFrame();
    const lv = voice.levels();
    for (const name of synth.LAYERS) meterEls[name].style.transform = `scaleX(${Math.min(1, lv[name])})`;
    if (ctx.state === 'running') {
      drawScope();
      analyser.getFloatTimeDomainData(timeBuf);
      let s = 0;
      for (const v of timeBuf) s += v * v;
      const db = 20 * Math.log10(Math.max(Math.sqrt(s / timeBuf.length), 1e-5));
      $('out-db').textContent = `${Math.round(db)} dB`;
    }
  }
  requestAnimationFrame(frame);
}

// ---- wiring --------------------------------------------------------------------------------------------------
function wire() {
  for (const n of sliderIds) {
    el[n].addEventListener('input', () => {
      paintSlider(n);
      if (n === 'volume') {
        volume = Number(el.volume.value) / 100;
        if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
        return;
      }
      readManualFromSliders();
      voice?.set(manual);
      showDash({ ...manual });
    });
  }
  for (const b of document.querySelectorAll('[data-preset]')) {
    b.addEventListener('click', () => {
      Object.assign(manual, PRESETS[b.dataset.preset]);
      showOnSliders(manual);
      voice?.set(manual);
      showDash({ ...manual });
    });
  }
  const shift = (dir) => {
    const top = profile.gearbox.ratios.length;
    const from = manual.gear;
    const to = Math.max(0, Math.min(top, from + dir));
    if (to === from) return;
    // Keep road speed through the change: the revs fall on an upshift and climb on a downshift.
    if (from >= 1 && to >= 1) {
      const speed = synth.speedFromRpm(profile, manual.rpm, from);
      manual.rpm = Math.max(profile.engine.idleRpm, Math.min(profile.engine.limiterRpm, synth.rpmFromSpeed(profile, speed, to)));
    }
    manual.gear = to;
    showOnSliders(manual);
    voice?.set(manual);
    showDash({ ...manual });
  };
  $('shift-up').addEventListener('click', () => shift(1));
  $('shift-down').addEventListener('click', () => shift(-1));
  $('start-btn').addEventListener('click', () => void toggleEngine());
  $('lap-btn').addEventListener('click', () => {
    if (lapState.active) stopLap();
    else void startLap();
  });
  addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement && ev.target.type === 'range') return;
    if (ev.key === 'ArrowUp' && !lapState.active) shift(1);
    else if (ev.key === 'ArrowDown' && !lapState.active) shift(-1);
  });
}

// ---- boot ----------------------------------------------------------------------------------------------------
async function boot() {
  try {
    const [, profileJson, lapJson] = await Promise.all([
      applyTokens(),
      fetchJson(rel('./cruz-missile.json')),
      fetchJson(rel('./lap.json')),
    ]);
    profile = synth.assertProfile(profileJson);
    lap = lapJson;
  } catch (err) {
    document.body.dataset.ready = 'true';
    const box = $('load-error');
    box.hidden = false;
    box.textContent = `Could not load this page's files (${err.message}). Serve the repository root with any static server, for example "python3 -m http.server" in the repo, and open /art/ui/poc/audio/engine/.`;
    return;
  }
  $('rpm-n').textContent = String(manual.rpm);
  el.rpm.max = String(profile.engine.limiterRpm);
  $('tach-red').style.left = `${(profile.engine.redlineRpm / profile.engine.limiterRpm) * 100}%`;
  const kv = $('profile-kv');
  const rows = [
    ['Car', profile.name],
    ['Engine', `${profile.engine.cylinders}-cylinder, ${profile.engine.idleRpm} idle, ${profile.engine.redlineRpm} redline`],
    ['Gearbox', `${profile.gearbox.ratios.length} gears, shifts at ${profile.gearbox.upshiftRpm} up / ${profile.gearbox.downshiftRpm} down`],
    ['Firing note', `rpm ÷ 60 × ${profile.engine.cylinders} ÷ 2 = ${synth.firingHz(profile.engine.cylinders, profile.engine.idleRpm).toFixed(0)} to ${synth.firingHz(profile.engine.cylinders, profile.engine.redlineRpm).toFixed(0)} Hz`],
    ['Profile', `${profile.id} v${profile.version}`],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    kv.append(dt, dd);
  }
  buildLayers();
  wire();
  showOnSliders(manual);
  showDash({ ...manual });
  document.body.dataset.ready = 'true';
  requestAnimationFrame(frame);
  window.__gallery = {
    synth,
    lapRunner,
    profile,
    lap,
    probe,
    get ctx() {
      return ctx;
    },
    get voice() {
      return voice;
    },
    get lapActive() {
      return lapState.active;
    },
    /** Test hook: jump the running lap to t seconds. */
    seekLap(t) {
      if (lapState.active) lapState.startedAt = ctx.currentTime - t;
    },
    get shown() {
      return lastShown;
    },
  };
  window.dispatchEvent(new Event('gallery-ready'));
}

boot();
