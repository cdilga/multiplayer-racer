// Announcer voice audition (P1-A01b). Static page: renders manifest.json (written by
// docs/evidence/P1-A01b/make_manifest.py from the eris and Mac renders). The AAC players live in ./clips/, which is
// never committed (R89: audio is generated on eris and the Mac), so a missing clip shows as "clip not published".
const rel = (p) => new URL(p, import.meta.url).href;
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) (k === 'class' ? (e.className = v) : e.setAttribute(k, v));
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

async function applyTokens() {
  const tokens = await (await fetch(rel('../../../tokens.json'))).json();
  const profile = matchMedia('(max-width: 640px)').matches ? 'handheld' : 'desk';
  const px = (v) => `${+v.toFixed(2)}px`;
  const css = [];
  for (const face of [tokens.fonts.display, tokens.fonts.body]) {
    for (const f of face.files) css.push(`@font-face{font-family:"${face.family}";src:url("${rel(`../../../${f.file}`)}") format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:block}`);
  }
  const vars = [];
  for (const [name, c] of Object.entries(tokens.palette)) vars.push(`--c-${name}:${c.hex}`);
  const fallback = tokens.fonts.fallback.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(',');
  vars.push(`--font-display:"${tokens.fonts.display.family}",${fallback}`, `--font-body:"${tokens.fonts.body.family}",${fallback}`);
  for (const [name, v] of Object.entries(tokens.type.profiles[profile].scale)) vars.push(`--fs-${name}:${px(v)}`);
  const mult = tokens.space.profileMultiplier[profile];
  tokens.space.steps.forEach((s, i) => vars.push(`--sp-${i}:${px(s * mult)}`));
  const outline = tokens.ink.outlinePx[profile];
  vars.push(`--outline:${px(outline)}`, `--radius:${px(tokens.layout.radiusPx[profile])}`, `--touch:${px(tokens.layout.minTouchTargetPx)}`);
  vars.push(`--sh-y:${px((tokens.ink.stickerShadow.y * outline) / 3)}`, `--shadow-c:rgb(21 32 58 / ${tokens.ink.stickerShadow.opacity})`);
  vars.push(`--focus-kb-w:${px(tokens.focus.keyboard.widthPx[profile])}`, `--focus-kb-off:${px(tokens.focus.keyboard.offsetPx[profile])}`);
  css.push(`:root{${vars.join(';')}}`);
  document.head.append(el('style', {}, css.join('\n')));
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
}

const fmt = (v, d = 2, unit = '') => (v == null ? 'n/a' : `${(+v).toFixed(d)}${unit}`);

function metrics(c) {
  if (c.speaker_sim == null && c.wer == null) return null;
  const werBad = c.wer != null && c.wer > 0;
  return el('div', { class: 'm' },
    el('span', {}, 'similarity ', el('b', {}, fmt(c.speaker_sim, 3))),
    el('span', { class: werBad ? 'bad' : '' }, 'WER ', el('b', {}, fmt(c.wer, 2))),
    el('span', {}, 'pitch spread ', el('b', {}, fmt(c.spread_semitones, 1, ' st'))),
    el('span', {}, 'median ', el('b', {}, fmt(c.median_hz, 0, ' Hz'))),
    el('span', {}, 'loudness ', el('b', {}, fmt(c.lufs, 1, ' LUFS'))),
    c.seconds != null ? el('span', {}, el('b', {}, fmt(c.seconds, 1, ' s'))) : null,
    c.render_s != null ? el('span', {}, 'render ', el('b', {}, fmt(c.render_s, 0, ' s'))) : null);
}

let current = null; // one clip plays at a time
function player(c) {
  const a = el('audio', { controls: '', preload: 'none', src: rel(c.src) });
  const li = el('li', {}, el('div', { class: 'cue' }, el('i', {}, c.label), c.text), a);
  a.addEventListener('play', () => { if (current && current !== a) current.pause(); current = a; });
  a.addEventListener('error', () => { if (!li.querySelector('.missing')) li.insertBefore(el('div', { class: 'missing' }, 'Clip not published on this server (audition audio is never committed).'), a.nextSibling); });
  const m = metrics(c);
  if (m) li.append(m);
  if (c.heard) li.append(el('div', { class: 'heard' }, 'Whisper heard: ', c.heard));
  return li;
}

function block(b) {
  const audios = [];
  const list = el('ul', { class: 'clips' });
  for (const c of b.clips) { const li = player(c); audios.push(li.querySelector('audio')); list.append(li); }
  const playAll = el('button', { class: 'btn', type: 'button' }, 'Play all');
  let idx = -1;
  const next = () => { idx += 1; if (idx < audios.length) { audios[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); audios[idx].play().catch(() => {}); } };
  for (const a of audios) a.addEventListener('ended', () => { if (idx >= 0 && audios[idx] === a) next(); });
  playAll.addEventListener('click', () => { if (current) current.pause(); idx = -1; next(); });
  return el('article', { class: 'block', id: `b-${b.letter}` },
    el('header', {}, el('div', { class: 'letter' }, b.letter),
      el('div', {}, el('h3', {}, b.title), el('div', { class: 'sub' }, b.sub))),
    b.detail ? el('p', { class: 'sub', style: 'margin-top:8px' }, b.detail) : null,
    b.clips.length > 1 ? el('div', { class: 'tools' }, playAll) : null,
    list);
}

(async () => {
  try { await applyTokens(); } catch { /* the page still works unstyled */ }
  const data = await (await fetch(rel('./manifest.json'))).json();
  $('lede').textContent = data.lede;
  $('caveat').replaceChildren(el('b', {}, 'What the numbers cannot tell you. '), data.caveat);
  const app = $('app'); app.replaceChildren();
  const jump = $('jump');
  const fin = await fetch(rel('./final.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (fin) data.groups.unshift(fin);
  for (const g of data.groups) {
    jump.append(el('a', { href: `#${g.id}` }, g.short));
    app.append(el('section', { class: 'group', id: g.id },
      el('h2', {}, g.title), el('p', {}, g.blurb),
      el('div', { class: `blocks${g.blocks.length > 1 && g.id !== 'final' ? ' two' : ''}` }, g.blocks.map(block))));
  }
  $('foot').replaceChildren(data.footer);
  document.body.dataset.ready = 'true';
})().catch((e) => { $('app').textContent = `Could not load the audition: ${e.message}`; document.body.dataset.ready = 'true'; });
