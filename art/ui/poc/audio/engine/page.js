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
  pops: ['Exhaust pops', 'Crackles when you lift off at revs, on a hard upshift, and a cough when it catches.'],
  starter: ['Starter', 'The starter motor cranking, sagging at every compression. Only while it starts.'],
};

// Ignition phases as the status line says them (P1-A04c).
const PHASE_COPY = {
  off: 'Engine off',
  cranking: 'Cranking…',
  catching: 'Caught!',
  settling: 'Settling to idle',
  running: 'Engine running',
  stopping: 'Stopping…',
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
/** The profile the voice plays: the lab's live profile, with the A/B match gain applied for listening. */
let listening = null;
let runner = null;
// `speed: undefined` is explicit: set() merges, and the lap passes a speed that must not stick once the sliders drive.
const manual = { rpm: 900, throttle: 0, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 1, speed: undefined, ignition: false };
let shownPhase = '';
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
  el.boost.value = String(Math.round((hasBoost() ? s.boost : 0) * 100)); // no turbo: nothing to show
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
  // The dash reads the engine as it sounds (P1-A04c): 0 when off, the crank, flare and spool-down in between.
  const ig = voice?.ignition();
  const rpm = ig ? ig.rpm : s.ignition === false ? 0 : s.rpm;
  const driving = ig ? ig.phase === 'running' : s.ignition !== false;
  $('rpm-n').textContent = String(Math.round(rpm));
  $('tach-fill').style.transform = `scaleX(${Math.min(1, rpm / e.limiterRpm)})`;
  $('fire-hz').textContent = `${synth.firingHz(e.cylinders, rpm).toFixed(0)} Hz`;
  const speed = s.speed ?? (driving ? synth.speedFromRpm(profile, rpm, s.gear) : 0);
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
  showLayerFit();
}

/** A layer the car doesn't have (boost on a car without a turbo) says so in the layers panel. */
function showLayerFit() {
  const li = document.querySelector('.layer[data-layer="boost"]');
  if (!li) return;
  li.dataset.absent = String(!hasBoost());
  li.querySelector('p').textContent = hasBoost() ? LAYER_COPY.boost[1] : `Not fitted: the ${profile.name} has no turbo.`;
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
    master.connect(analyser);
    analyser.connect(ctx.destination);
    makeVoice({ ...manual });
  }
  if (ctx.state !== 'running') await ctx.resume();
  setStatus();
}

/** A fresh voice in `initial` (the lap starts from a parked car); the old one fades out in 30 ms. */
function makeVoice(initial) {
  const old = voice;
  if (old) {
    old.output.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    setTimeout(() => old.dispose(), 150);
  }
  voice = synth.create(ctx, listening ?? profile, { destination: master, initial });
  applyMix();
}

const enginePhase = () => voice?.ignition().phase ?? 'off';
const engineOn = () => !['off', 'stopping'].includes(enginePhase());

/** The status line and the key button follow the voice's ignition phase (called every frame; writes on change). */
function setStatus() {
  const phase = enginePhase();
  if (phase === shownPhase) return;
  shownPhase = phase;
  const on = engineOn();
  $('status').dataset.on = String(on);
  $('status').dataset.phase = phase;
  $('status').textContent = PHASE_COPY[phase];
  $('start-btn').textContent = on ? 'Stop engine' : 'Start engine';
  $('start-btn').classList.toggle('btn-primary', !on);
}

/** The key: start plays crank, catch and settle; stop plays the fuel cut and the spool-down (P1-A04c). */
async function toggleEngine() {
  await ensureAudio();
  if (engineOn()) {
    if (lapState.active) stopLap();
    manual.ignition = false;
  } else {
    manual.ignition = true;
    if (manual.rpm < profile.engine.idleRpm) manual.rpm = profile.engine.idleRpm;
  }
  showOnSliders(manual);
  voice.set(manual);
  setStatus();
}

// ---- lap ---------------------------------------------------------------------------------------------------
/** A car without a turbo has no boost control (P1-A04c): the slider is disabled and says so. */
const hasBoost = () => Boolean(profile?.boost);
function setSlidersDriven(driven) {
  for (const n of sliderIds) if (n !== 'volume') el[n].disabled = driven || (n === 'boost' && !hasBoost());
  for (const b of document.querySelectorAll('[data-preset], #shift-up, #shift-down')) b.disabled = driven;
  $('driven-note').textContent = driven ? 'The scripted lap is driving the sliders. Stop it to take over.' : '';
}

function showBoostFitted() {
  const fitted = hasBoost();
  el.boost.disabled = !fitted || lapState.active;
  el.boost.closest('.field').dataset.absent = String(!fitted);
  $('boost-note').hidden = fitted;
  $('boost-note').textContent = fitted ? '' : `The ${profile.name} has no turbo, so there is no boost to hear. Pick a car with one (or fit one) in the sound lab.`;
  paintSlider('boost');
}

async function startLap() {
  await ensureAudio();
  runner = lapRunner.createLapRunner(profile, lap);
  // The lap is a fresh take from a parked car with the key off, so it always opens with the start.
  makeVoice({ ...runner.stateAt(0), ignition: false });
  runner.reset();
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
  // Hand back to the sliders, in neutral at idle; the key stays where the lap left it (off once it has ended).
  Object.assign(manual, PRESETS.idle, { gear: 1, ignition: voice?.state().ignition ?? false });
  showOnSliders(manual);
  voice?.set(manual);
  showDash(manual);
}

function lapFrame() {
  const t = ctx.currentTime - lapState.startedAt;
  const total = runner.durationS;
  if (t >= total) {
    $('lap-time').textContent = `${total.toFixed(1)} / ${total.toFixed(1)} s`;
    stopLap();
    return;
  }
  const s = runner.stateAt(t);
  voice.set(s);
  showOnSliders(s);
  showDash(s);
  $('lap-fill').style.transform = `scaleX(${t / total})`;
  $('lap-time').textContent = `${t.toFixed(1)} / ${total.toFixed(1)} s`;
  const lapT = t - runner.preS;
  const beat = lapT < 0 ? [0, 'Key on: crank, catch, settle'] : lapT >= lap.durationS ? [0, 'Key off: cut and spool down'] : [...lap.story].reverse().find(([at]) => at <= lapT);
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
  const idle = !analyser || !engineOn();
  $('scope-idle').hidden = !idle;
  if (idle) {
    // Engine off: the empty scale (decade lines and the floor), with the caption over it.
    const lo = 40;
    const hi = 12000;
    g.fillStyle = cssVar('--c-paper-line');
    for (const f of [100, 1000, 10000]) g.fillRect(Math.round((Math.log(f / lo) / Math.log(hi / lo)) * w), 0, Math.max(1, dpr), h);
    g.fillStyle = cssVar('--c-ink');
    g.fillRect(0, h - 3 * dpr, w, 3 * dpr);
    if (!analyser) return;
  }
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
  const out = { ctxState: ctx?.state ?? 'none', time: ctx?.currentTime ?? 0, lapActive: lapState.active, rms: 0, peakHz: 0, centroidHz: 0, state: voice?.state() ?? null, ignition: voice?.ignition() ?? null };
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
    const before = shownPhase;
    setStatus();
    // While it starts or stops, the dash follows the engine frame by frame (the lap refreshes it itself).
    if (!lapState.active && (shownPhase !== before || !['off', 'running'].includes(shownPhase))) showDash({ ...manual });
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
/** Everything the page derives from the current profile (the dash limits and the profile panel). */
function fillProfile() {
  el.rpm.max = String(profile.engine.limiterRpm);
  showBoostFitted();
  showLayerFit();
  $('tach-red').style.left = `${(profile.engine.redlineRpm / profile.engine.limiterRpm) * 100}%`;
  const kv = $('profile-kv');
  kv.replaceChildren();
  const rows = [
    ['Car', profile.name],
    ['Engine', `${profile.engine.cylinders}-cylinder, ${profile.engine.idleRpm} idle, ${profile.engine.redlineRpm} redline`],
    ['Gearbox', `${profile.gearbox.ratios.length} gears, shifts at ${profile.gearbox.upshiftRpm} up / ${profile.gearbox.downshiftRpm} down`],
    ['Firing note', `rpm ÷ 60 × ${profile.engine.cylinders} ÷ 2 = ${synth.firingHz(profile.engine.cylinders, profile.engine.idleRpm).toFixed(0)} to ${synth.firingHz(profile.engine.cylinders, profile.engine.redlineRpm).toFixed(0)} Hz`],
    ['Turbo', profile.boost ? 'Yes: boost whines and whooshes' : 'None'],
    ['Start and stop', `cranks ${profile.ignition.crankS} s at ${profile.ignition.crankRpm} rpm, flares to ${profile.ignition.flareRpm}; stops in ${profile.ignition.stopS} s`],
    ['Profile', `${profile.id} v${profile.version}`],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    kv.append(dt, dd);
  }
}

async function boot() {
  try {
    const [, lapJson, manifestJson, schemaJson] = await Promise.all([
      applyTokens(),
      fetchJson(rel('./lap.json')),
      fetchJson(rel('./manifest.json')),
      fetchJson(rel('./profile.schema.json')),
    ]);
    lap = lapJson;
    await labInit(manifestJson, schemaJson);
  } catch (err) {
    document.body.dataset.ready = 'true';
    const box = $('load-error');
    box.hidden = false;
    box.textContent = `Could not load this page's files (${err.message}). Serve the repository root with any static server, for example "python3 -m http.server" in the repo, and open /art/ui/poc/audio/engine/.`;
    return;
  }
  $('rpm-n').textContent = String(manual.rpm);
  fillProfile();
  buildLayers();
  wire();
  showOnSliders(manual);
  showDash({ ...manual });
  drawScope();
  document.body.dataset.ready = 'true';
  requestAnimationFrame(frame);
  window.__gallery = {
    synth,
    lapRunner,
    get profile() {
      return profile;
    },
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
    /** Test hook: jump the running lap to lap time t seconds (after the start pre-roll). */
    seekLap(t) {
      if (lapState.active) lapState.startedAt = ctx.currentTime - t - runner.preS;
    },
    get shown() {
      return lastShown;
    },
    /** The sound lab (P1-A04b): schema-generated controls, live edits, A/B, export/import. */
    get lab() {
      return labApi();
    },
  };
  window.dispatchEvent(new Event('gallery-ready'));
}

boot();

// ---- sound lab (P1-A04b) ---------------------------------------------------------------------------------------
// The lab turns the profile schema into controls: nothing about a parameter is hand-listed here, so a
// field added to PROFILE_RULE (and thus the schema) appears with a control by itself. Edits apply live
// through voice.setProfile (a click-free swap that carries state), A/B is loudness-matched by a short
// offline render, and the URL carries the live slot's tweaks (?profile=<id>&p.<path>=<value>).

const SECTION_TITLES = {
  engine: 'Engine',
  gearbox: 'Gearbox',
  output: 'Output',
  firing: 'Firing',
  intake: 'Intake',
  exhaust: 'Exhaust',
  boost: 'Boost',
  squeal: 'Squeal',
  surface: 'Surface',
  rattle: 'Rattle',
  pops: 'Pops',
  gearDip: 'Gear dip',
  ignition: 'Start and stop',
};

const lab = {
  schema: null,
  files: [], // manifest order: [{ id, name, file }]
  profiles: new Map(), // id -> profile JSON
  slots: null, // [{ baseId, base, imported, edits: Map<path, value>, matchGain }]
  live: 0,
  matchKnown: false,
  rows: new Map(), // path -> { kind, row, input, valueEl, section }
  sections: new Map(), // top-level key -> { section, fit } (fit: the Fitted toggle of an optional section)
  optional: new Set(), // top-level sections a profile may leave out (boost: a car without a turbo)
  applyTimer: 0,
};

const labSlot = () => lab.slots[lab.live];

/**
 * The slot's edited profile: its base with every edit applied (no A/B match gain in here). An edit of a whole
 * optional section is the section (fitted) or null (removed); an edit inside a section that isn't there is skipped.
 */
function labSlotProfile(slot) {
  const p = structuredClone(slot.base);
  for (const [path, value] of slot.edits) labSetPath(p, path, value);
  return p;
}

function labSetPath(root, path, value) {
  const parts = path.split('.');
  let node = root;
  for (const part of parts.slice(0, -1)) {
    node = node?.[part];
    if (node === undefined || node === null) return;
  }
  const last = parts.at(-1);
  if (value === null) delete node[last];
  else node[last] = structuredClone(value);
}

/** The value at a dotted path, or undefined when part of the path is missing (a section the car doesn't have). */
function labGetPath(root, path) {
  let node = root;
  for (const part of path.split('.')) node = node?.[part];
  return node;
}

/** A section to fit to a car that lacks it: the slot's own base if it had one, else the first manifest car's. */
function labDonorSection(slot, key) {
  if (slot.base[key]) return structuredClone(slot.base[key]);
  for (const p of lab.profiles.values()) if (p[key]) return structuredClone(p[key]);
  return null;
}

/** Fits or removes an optional section (e.g. give the Cruz a turbo to hear it, or take one off). */
function labToggleSection(key) {
  const slot = labSlot();
  const fitted = Boolean(labSlotProfile(slot)[key]);
  for (const path of [...slot.edits.keys()]) if (path.startsWith(`${key}.`)) slot.edits.delete(path);
  if (fitted) {
    if (slot.base[key]) slot.edits.set(key, null);
    else slot.edits.delete(key);
  } else if (slot.base[key]) slot.edits.delete(key);
  else {
    const donor = labDonorSection(slot, key);
    if (!donor) return;
    slot.edits.set(key, donor);
  }
  lab.matchKnown = false;
  labRefreshControls();
  labApplyLive();
}

function labSameValue(a, b) {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;
}

/** Applies the live slot to the page: validation, the running voice, the dash and the URL. */
function labApplyLive() {
  const slot = labSlot();
  const p = labSlotProfile(slot);
  const check = synth.validateProfile(p);
  const err = $('lab-err');
  if (!check.ok) {
    err.textContent = check.errors.slice(0, 3).join('  ');
    return null;
  }
  err.textContent = '';
  profile = p;
  // The match gain is for listening only, never for export.
  listening = slot.matchGain === 1 ? p : structuredClone(p);
  if (slot.matchGain !== 1) listening.output.level = Math.min(4, p.output.level * slot.matchGain);
  if (voice) {
    voice.setProfile(listening);
    if (lapState.active) runner = lapRunner.createLapRunner(p, lap);
  }
  manual.rpm = Math.min(manual.rpm, p.engine.limiterRpm);
  showOnSliders(manual);
  voice?.set(manual);
  fillProfile();
  labWriteUrl();
  return p;
}

const labQueueApply = () => {
  clearTimeout(lab.applyTimer);
  lab.applyTimer = setTimeout(labApplyLive, 40);
};

/** One schema leaf -> one control row. Kinds: number, integer, enum, string, const, array. */
function labBuildRow(path, node, parentEl, section) {
  const row = document.createElement('div');
  row.className = 'lab-row';
  row.dataset.path = path;
  const name = document.createElement('span');
  name.className = 'lab-name';
  name.textContent = path.split('.').at(-1);
  const ctl = document.createElement('span');
  ctl.className = 'lab-ctl';
  const valueEl = document.createElement('span');
  valueEl.className = 'lab-val';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn-small btn-icon';
  reset.textContent = '↺';
  reset.title = `Reset ${path}`;
  reset.addEventListener('click', () => labResetParam(path));
  const doc = document.createElement('p');
  doc.className = 'lab-doc';
  doc.textContent = node.description ?? '';

  let input;
  const kind = node.const !== undefined ? 'const' : node.enum ? 'enum' : node.type === 'array' ? 'array' : node.type === 'integer' ? 'integer' : node.type === 'number' ? 'number' : 'string';
  if (kind === 'number' || kind === 'integer') {
    const range = Math.max(node.maximum - node.minimum, 1);
    const step = kind === 'integer' ? 1 : Math.max(range / 400, 1e-6);
    input = document.createElement('input');
    input.type = 'range';
    input.min = node.minimum;
    input.max = node.maximum;
    input.step = step;
    const num = document.createElement('input');
    num.type = 'number';
    num.min = node.minimum;
    num.max = node.maximum;
    num.step = kind === 'integer' ? 1 : 'any';
    input.addEventListener('input', () => labSetParam(path, Number(input.value)));
    num.addEventListener('change', () => labSetParam(path, Number(num.value)));
    ctl.append(input, num);
  } else if (kind === 'enum') {
    input = document.createElement('select');
    for (const v of node.enum) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      input.append(opt);
    }
    input.addEventListener('change', () => labSetParam(path, input.value));
    ctl.append(input);
  } else {
    input = document.createElement('input');
    input.type = 'text';
    if (kind === 'const') input.readOnly = true;
    input.addEventListener(kind === 'const' ? 'irrelevant' : 'input', () => labSetParam(path, input.value));
    ctl.append(input);
  }
  row.append(name, ctl, valueEl, reset, doc);
  parentEl.append(row);
  const unit = node['x-unit'] ? ` <small>${node['x-unit']}</small>` : '';
  lab.rows.set(path, {
    kind,
    section,
    row,
    input,
    valueEl,
    unit,
  });
}

/** Walks the schema into sections (top-level objects), groups (nested objects) and control rows. */
function labBuildControls() {
  const root = $('lab-sections');
  root.replaceChildren();
  lab.rows.clear();
  const props = lab.schema.properties;
  lab.sections.clear();
  lab.optional = new Set(Object.keys(props).filter((k) => props[k].type === 'object' && !lab.schema.required.includes(k)));
  const groups = [];
  const singles = [];
  for (const [key, node] of Object.entries(props)) (node.type === 'object' ? groups : singles).push([key, node]);
  const buildSection = (title, key) => {
    const section = document.createElement('section');
    section.className = 'lab-section';
    section.dataset.section = title;
    const header = document.createElement('header');
    const h3 = document.createElement('h3');
    h3.textContent = title;
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn btn-small';
    resetBtn.textContent = 'Reset section';
    resetBtn.addEventListener('click', () => labResetSection(key));
    const note = document.createElement('span');
    note.className = 'note';
    header.append(h3, resetBtn);
    let fit = null;
    if (lab.optional.has(key)) {
      fit = document.createElement('button');
      fit.type = 'button';
      fit.className = 'btn btn-small lab-fit';
      fit.textContent = 'Fitted';
      fit.setAttribute('aria-label', `${title} fitted to this car`);
      fit.addEventListener('click', () => labToggleSection(key));
      header.append(fit);
    }
    header.append(note);
    section.append(header);
    root.append(section);
    lab.sections.set(key, { section, fit });
    return { section, note };
  };
  if (singles.length) {
    const { section } = buildSection('Profile', 'profile');
    for (const [key, node] of singles) labBuildRow(key, node, section, 'profile');
  }
  for (const [key, node] of groups) {
    const { section, note } = buildSection(SECTION_TITLES[key] ?? key, key);
    note.textContent = node.description ?? '';
    const walk = (objNode, parentEl, prefix) => {
      for (const [childKey, child] of Object.entries(objNode.properties)) {
        const path = prefix ? `${prefix}.${childKey}` : childKey;
        if (child.type === 'object') {
          const group = document.createElement('div');
          group.className = 'lab-group';
          const h4 = document.createElement('h4');
          h4.textContent = childKey;
          group.append(h4);
          parentEl.append(group);
          walk(child, group, path);
        } else {
          labBuildRow(path, child, parentEl, key);
        }
      }
    };
    walk(node, section, key);
  }
}

/** Puts a slot's values into the controls and marks the modified ones (and the sections this car doesn't have). */
function labRefreshControls() {
  const slot = labSlot();
  const live = labSlotProfile(slot);
  for (const [key, { section, fit }] of lab.sections) {
    if (!fit) continue;
    const fitted = Boolean(live[key]);
    section.dataset.absent = String(!fitted);
    fit.setAttribute('aria-pressed', String(fitted));
    fit.textContent = fitted ? 'Fitted' : 'Not fitted';
    fit.dataset.modified = String(slot.edits.has(key));
  }
  for (const [path, r] of lab.rows) {
    const value = labGetPath(live, path);
    const modified = slot.edits.has(path) || slot.edits.has(path.split('.')[0]);
    r.row.dataset.modified = String(modified);
    const absent = value === undefined;
    r.row.dataset.absent = String(absent);
    r.input.disabled = absent;
    if (r.kind === 'number' || r.kind === 'integer') r.input.nextElementSibling.disabled = absent;
    if (absent) {
      r.valueEl.textContent = 'not fitted';
      continue;
    }
    if (r.kind === 'number' || r.kind === 'integer') {
      r.input.value = String(value);
      r.input.nextElementSibling.value = String(value);
      r.valueEl.innerHTML = `${Number(value).toLocaleString('en-AU', { maximumFractionDigits: 4 })}${r.unit}`;
    } else if (r.kind === 'array') {
      r.input.value = value.join(', ');
      r.valueEl.innerHTML = `${value.length} item${value.length === 1 ? '' : 's'}${r.unit}`;
    } else if (r.kind === 'const') {
      r.input.value = String(value);
      r.valueEl.textContent = 'fixed';
    } else {
      r.input.value = String(value);
      r.valueEl.innerHTML = `${String(value).length} ch${r.unit}`;
    }
  }
  labApplySearch();
}

function labSetParam(path, value) {
  const slot = labSlot();
  if (labGetPath(labSlotProfile(slot), path) === undefined) return; // a section this car doesn't have
  const sectionKey = path.split('.')[0];
  // A section fitted by an edit has no base values: edit the fitted section itself.
  const baseValue = slot.edits.has(sectionKey) ? labGetPath({ [sectionKey]: slot.edits.get(sectionKey) }, path) : labGetPath(slot.base, path);
  if (slot.edits.has(sectionKey)) {
    labSetPath({ [sectionKey]: slot.edits.get(sectionKey) }, path, value);
    lab.matchKnown = false;
    labRefreshParam(path);
    labQueueApply();
    return;
  }
  if (labSameValue(value, baseValue)) slot.edits.delete(path);
  else slot.edits.set(path, value);
  lab.matchKnown = false;
  labRefreshParam(path);
  labQueueApply();
}

function labRefreshParam(path) {
  // Cheap single-row refresh for typing feedback; full refresh on apply.
  const r = lab.rows.get(path);
  const slot = labSlot();
  r.row.dataset.modified = String(slot.edits.has(path) || slot.edits.has(path.split('.')[0]));
  const value = labGetPath(labSlotProfile(slot), path);
  if (Array.isArray(value)) r.input.value = value.join(', ');
  else if (typeof value === 'number') r.input.value = String(value);
}

function labResetParam(path) {
  labSlot().edits.delete(path);
  lab.matchKnown = false;
  labRefreshControls();
  labApplyLive();
}

function labResetSection(sectionKey) {
  const slot = labSlot();
  for (const path of [...slot.edits.keys()]) {
    const r = lab.rows.get(path);
    if (r?.section === sectionKey || path === sectionKey || path.split('.')[0] === sectionKey) slot.edits.delete(path);
  }
  lab.matchKnown = false;
  labRefreshControls();
  labApplyLive();
}

function labApplySearch() {
  const q = $('lab-search').value.trim().toLowerCase();
  for (const [path, r] of lab.rows) {
    const doc = r.row.querySelector('.lab-doc')?.textContent ?? '';
    r.row.hidden = q !== '' && !(`${path} ${doc}`.toLowerCase().includes(q));
  }
  for (const section of $('lab-sections').children) {
    section.dataset.empty = String([...section.querySelectorAll('.lab-row')].every((row) => row.hidden));
  }
}

/** A/B: renders both slots briefly offline and scales B to A's loudness (listening only). */
async function labMatchLevels() {
  if (lab.matchKnown) return;
  const state = { rpm: 3200, throttle: 0.8, boost: 0.3, drift: 0, surface: 'tarmac', damage: 0, gear: 2 };
  const loudness = async (p) => {
    const clip = await lapRunner.renderScript(synth, p, [{ t: 0, state }], { durationS: 0.9 });
    let sum = 0;
    const from = Math.floor(0.3 * 48000);
    for (let i = from; i < clip.length; i++) sum += clip[i] * clip[i];
    return Math.sqrt(sum / Math.max(clip.length - from, 1));
  };
  try {
    const [a, b] = await Promise.all([loudness(labSlotProfile(lab.slots[0])), loudness(labSlotProfile(lab.slots[1]))]);
    if (a > 1e-6 && b > 1e-6) {
      lab.slots[1].matchGain = Math.min(4, Math.max(0.25, a / b));
      lab.slots[0].matchGain = 1;
    }
  } catch {
    /* offline render unavailable: switch unmached rather than broken */
  }
  lab.matchKnown = true;
}

async function labSwitchSlot(i) {
  if (i === lab.live) return;
  await labMatchLevels();
  lab.live = i;
  $('lab-a').setAttribute('aria-pressed', String(i === 0));
  $('lab-b').setAttribute('aria-pressed', String(i === 1));
  $('lab-match').hidden = !lab.matchKnown || lab.slots[1].matchGain === 1;
  labRefreshControls();
  labApplyLive();
  labWriteUrl();
}

function labExportText() {
  const p = labSlotProfile(labSlot());
  return synth.validateProfile(p).ok ? `${JSON.stringify(p, null, 2)}\n` : null;
}

function labDownload() {
  const text = labExportText();
  if (text === null) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `${labSlotProfile(labSlot()).id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function labImportText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    $('lab-err').textContent = `Not JSON: ${err.message}`;
    return false;
  }
  const check = synth.validateProfile(parsed);
  if (!check.ok) {
    $('lab-err').textContent = check.errors.slice(0, 3).join('  ');
    return false;
  }
  labSlot().base = parsed;
  labSlot().baseId = parsed.id;
  labSlot().imported = true;
  labSlot().edits = new Map();
  lab.matchKnown = false;
  labFillPicker();
  labRefreshControls();
  labApplyLive();
  return true;
}

function labFillPicker() {
  const select = $('lab-profile');
  const slot = labSlot();
  select.replaceChildren();
  for (const { id, name } of lab.files) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    select.append(opt);
  }
  if (slot.imported || !lab.files.some((f) => f.id === slot.baseId)) {
    const opt = document.createElement('option');
    opt.value = '(imported)';
    opt.textContent = `${slot.base?.name ?? 'Imported'} (imported)`;
    select.append(opt);
  }
  select.value = slot.imported ? '(imported)' : slot.baseId;
}

async function labSelectProfile(id) {
  if (!lab.profiles.has(id)) return;
  const slot = labSlot();
  slot.baseId = id;
  slot.base = structuredClone(lab.profiles.get(id));
  slot.imported = false;
  slot.edits = new Map();
  slot.matchGain = 1;
  lab.matchKnown = false;
  labFillPicker();
  labRefreshControls();
  labApplyLive();
}

function labWriteUrl() {
  const slot = labSlot();
  const params = new URLSearchParams();
  if (!slot.imported && slot.baseId) params.set('profile', slot.baseId);
  for (const [path, value] of [...slot.edits.entries()].sort()) {
    // A whole optional section: `none` takes it off, `fit` fits the donor's (edits inside it are not carried).
    const text = value === null ? 'none' : Array.isArray(value) ? value.join(',') : typeof value === 'object' ? 'fit' : String(value);
    params.set(`p.${path}`, text);
  }
  if (lab.live === 1) params.set('slot', 'b');
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

async function labReadUrl() {
  const params = new URLSearchParams(location.search);
  const wanted = params.get('profile');
  if (wanted && lab.profiles.has(wanted) && wanted !== labSlot().baseId) await labSelectProfile(wanted);
  for (const [key, raw] of params.entries()) {
    if (!key.startsWith('p.')) continue;
    const path = key.slice(2);
    const node = labSchemaNode(path);
    if (!node) continue;
    let value;
    if (node.type === 'object') {
      if (raw === 'none') value = null;
      else if (raw === 'fit') value = labDonorSection(labSlot(), path);
      if (value === undefined) continue;
    } else if (node.type === 'array') {
      value = raw.split(',').map(Number);
      if (value.some((v) => !Number.isFinite(v))) continue;
    } else if (node.type === 'number' || node.type === 'integer') {
      value = Number(raw);
      if (!Number.isFinite(value)) continue;
      if (node.type === 'integer') value = Math.round(value);
    } else value = raw;
    labSlot().edits.set(path, value);
  }
  if (params.get('slot') === 'b') {
    lab.slots[1].base = structuredClone(lab.slots[0].base);
    lab.slots[1].baseId = lab.slots[0].baseId;
    lab.live = 1;
    $('lab-a').setAttribute('aria-pressed', 'false');
    $('lab-b').setAttribute('aria-pressed', 'true');
  }
}

/** The schema node for a dotted path, or null. */
function labSchemaNode(path) {
  let node = lab.schema;
  for (const part of path.split('.')) node = node?.properties?.[part] ?? node?.items ?? null;
  return node;
}

async function labInit(manifestJson, schemaJson) {
  lab.schema = schemaJson;
  lab.files = [];
  lab.profiles = new Map();
  for (const file of manifestJson.files ?? ['cruz-missile.json']) {
    const p = await fetchJson(rel(`./${file}`));
    lab.profiles.set(p.id, p);
    lab.files.push({ id: p.id, name: p.name, file });
  }
  const first = lab.files[0].id;
  lab.slots = [0, 1].map(() => ({ baseId: first, base: structuredClone(lab.profiles.get(first)), imported: false, edits: new Map(), matchGain: 1 }));
  lab.live = 0;
  labBuildControls();
  await labReadUrl();
  labFillPicker();
  labRefreshControls();
  labApplyLive();

  $('lab-profile').addEventListener('change', (e) => labSelectProfile(e.target.value));
  $('lab-a').addEventListener('click', () => labSwitchSlot(0));
  $('lab-b').addEventListener('click', () => labSwitchSlot(1));
  $('lab-search').addEventListener('input', labApplySearch);
  $('lab-export').addEventListener('click', labDownload);
  $('lab-import').addEventListener('click', () => $('lab-file').click());
  $('lab-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) labImportText(await file.text());
    e.target.value = '';
  });
  $('lab-reset-all').addEventListener('click', () => {
    labSlot().edits = new Map();
    lab.matchKnown = false;
    labRefreshControls();
    labApplyLive();
  });
}

/** The check.mjs surface for the lab. */
function labApi() {
  return {
    controlPaths: () => [...lab.rows.keys()],
    profiles: () => lab.files.map((f) => f.id),
    currentProfileId: () => labSlot().baseId,
    selectProfile: (id) => labSelectProfile(id),
    toggleSection: (key) => labToggleSection(key),
    setParam: (path, value) => labSetParam(path, value),
    resetParam: (path) => labResetParam(path),
    modifiedPaths: () => [...labSlot().edits.keys()],
    liveProfile: () => labSlotProfile(labSlot()),
    exportText: () => labExportText(),
    importText: (text) => labImportText(text),
    switchSlot: (i) => labSwitchSlot(i),
    slotInfo: () => ({ live: lab.live, gains: lab.slots.map((s) => s.matchGain), matched: lab.matchKnown }),
    search: (q) => {
      $('lab-search').value = q;
      labApplySearch();
    },
    url: () => location.search,
    apply: () => labApplyLive(),
  };
}
