// P1-U01 component sheet: every component in every state, as static classes (is-hover, is-pressed,
// is-focus-kb, is-focus-gp, is-disabled, is-loading). Built from tokens.json through tokens-css.js.
import { applyTokens, wobblePath } from './tokens-css.js';

const tokens = await applyTokens('desk');
const app = document.getElementById('app');
if (navigator.webdriver) document.documentElement.classList.add('still'); // deterministic evidence PNGs

// ---------- sheet-local variables derived from the tokens ----------
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
const stk = tokens.ink.stickerShadow;
const H = 0.5; // TV strip scale
const tvP = tokens.type.profiles.tv;
const tvShadowY = stk.y * (tokens.ink.outlinePx.tv / tokens.ink.outlinePx.desk); // shadow scales with the outline
const tvVars = [
  ...Object.entries(tvP.scale).map(([k, v]) => `--fs-${k}:${v * H}px`),
  ...tokens.space.steps.map((s, i) => `--sp-${i}:${s * tokens.space.profileMultiplier.tv * H}px`),
  `--outline:${tokens.ink.outlinePx.tv * H}px`,
  `--radius:${tokens.layout.radiusPx.tv * H}px`,
  `--focus-kb-w:${tokens.focus.keyboard.widthPx.tv * H}px`,
  `--focus-kb-off:${tokens.focus.keyboard.offsetPx.tv * H}px`,
  `--focus-gp-w:${tokens.focus.gamepad.widthPx.tv * H}px`,
  `--focus-gp-off:${tokens.focus.gamepad.offsetPx.tv * H}px`,
  `--sh-y:${tvShadowY * H}px`,
  `--lift-y:${-2 * H}px`,
  `--wobble-amp:${tokens.wobble.amplitudePx.tv * H}`,
];
const vars = document.createElement('style');
vars.textContent = `:root{--sh-y:${stk.y}px;--lift-y:-2px;--wobble-amp:${tokens.wobble.amplitudePx.desk};--lh-body:${tokens.type.lineHeight.body};--lh-display:${tokens.type.lineHeight.display};--ls-display:${tokens.type.letterSpacing.display};--shadow-c:rgb(${hexRgb(tokens.palette[stk.color].hex)} / ${stk.opacity})}.tv{${tvVars.join(';')}}`;
document.head.append(vars);

// ---------- small builders ----------
const ic = (name) => `<i class="ic" style="--ic:url(../icons/${name}.svg)" aria-hidden="true"></i>`;
const spinner = () => '<i class="spinner" aria-hidden="true"></i>';
const gpTab = '<svg class="gp-tab" viewBox="0 0 18 32" aria-hidden="true"><path d="M2.5 2.5h6.5l7 13.5-7 13.5H2.5L9.5 16z"/></svg>';
const cls = (...a) => a.filter(Boolean).join(' ');
const stateCls = (s) => (s ? `is-${s}` : '');
const tab = (s) => (s === 'focus-gp' ? gpTab : '');

function btn({ label, variant = 'primary', state = '', icon, iconOnly, aria, extra = '' }) {
  const loading = state === 'loading';
  const inner = loading ? spinner() + (iconOnly ? '' : '<span>Starting…</span>') : iconOnly ? ic(iconOnly) : (icon ? ic(icon) : '') + `<span>${label}</span>`;
  return `<button type="button" class="${cls('btn', `btn-${variant}`, iconOnly && 'btn-icon', stateCls(state), extra)}"${aria ? ` aria-label="${aria}"` : ''}${state === 'disabled' ? ' disabled' : ''}${loading ? ' aria-busy="true"' : ''}>${tab(state)}${inner}</button>`;
}

const seatColor = (n) => (n - 1) % tokens.identity.colors.length;
const badge = (n, size = '') => {
  const i = seatColor(n);
  return `<span class="${cls('badge wb', size)}" data-wobble="badge-${n}" style="--b:var(--id-${i});--on:var(--id-${i}-on)">#${n}</span>`;
};
const chip = (kind) => ({
  ready: `<span class="chip chip-ready">${ic('check')}Ready</span>`,
  choosing: '<span class="chip chip-choosing">choosing…</span>',
  reconnecting: `<span class="chip chip-warn">${ic('wifi-off')}Reconnecting</span>`,
  autopilot: `<span class="chip chip-auto">${ic('car')}Autopilot driving</span>`,
})[kind];

const toggle = ({ on = false, state = '' } = {}) =>
  `<button type="button" class="${cls('toggle', on && 'is-on', stateCls(state))}" role="switch" aria-checked="${on}"${state === 'disabled' ? ' disabled' : ''}>${tab(state)}<span class="knob">${on ? ic('check') : ''}</span></button>`;
const recRow = ({ label, sub, on, state = '' }) =>
  `<div class="${cls('row-rec', stateCls(state))}"${state === 'disabled' ? ' aria-disabled="true"' : ''}>${tab(state)}<span>${label}${sub ? `<small>${sub}</small>` : ''}</span>${toggle({ on, state: state === 'disabled' ? 'disabled' : '' })}</div>`;
const rosterCard = ({ n, name, chipKind, state = '' }) =>
  `<div class="${cls('card wb', stateCls(state))}" data-wobble="card-${n}">${tab(state)}${badge(n, 'sm')}<b class="nm">${name}</b>${chip(chipKind)}</div>`;

const section = (num, title, note, body) => `
  <section class="sec" id="s${num}"><header class="sec-head"><span class="sec-num">${String(num).padStart(2, '0')}</span><h2>${title}</h2><p>${note}</p></header>${body}</section>`;

// ---------- 1 buttons ----------
const STATES = [
  ['', 'Default', ''],
  ['hover', 'Hover', 'lighter fill'],
  ['pressed', 'Pressed', 'shadow collapses, drops 5 px'],
  ['focus-kb', 'Keyboard focus', 'cobalt ring'],
  ['focus-gp', 'Gamepad focus', 'saffron ring, tab, lift'],
  ['disabled', 'Disabled', 'flat, not-allowed'],
  ['loading', 'Loading', 'spinner, striped'],
];
const BTN_ROWS = [
  { name: 'Primary', sub: 'Saffron fill, ink text', variant: 'primary', label: 'Start race' },
  { name: 'Secondary', sub: 'Paper fill, ink outline', variant: 'secondary', label: 'Ready' },
  { name: 'Destructive', sub: 'Danger fill, paper text', variant: 'destructive', label: 'End room' },
  { name: 'Quiet (text)', sub: 'No outline, no shadow', variant: 'quiet', label: 'Cancel' },
  { name: 'Leading icon', sub: 'Icon 20 px, gap sp-2', variant: 'secondary', label: 'Find my car', icon: 'car' },
  { name: 'Leading icon, destructive', sub: 'Leave room', variant: 'destructive', label: 'Leave room', icon: 'log-out' },
  { name: 'Icon button', sub: '48 px square, aria-label', variant: 'secondary', iconOnly: 'settings', aria: 'Settings' },
];
const buttonsGrid = `<div class="states">
  <span></span>${STATES.map(([, n, sub]) => `<div class="ch">${n}<small>${sub}</small></div>`).join('')}
  ${BTN_ROWS.map((r) => `<div class="rl"><b>${r.name}</b>${r.sub}</div>${STATES.map(([s]) => `<div class="cell">${btn({ ...r, state: s })}</div>`).join('')}`).join('')}
</div>`;

// ---------- 2 panels ----------
const [wMin, wMax] = tokens.wobble.segmentsPerEdge;
const panels = `<div class="panels">
  <div class="pcol">
    <div class="panel-paper wb" data-wobble="panel-paper">
      <span class="title-tab"><span>Round highlights</span></span>
      <h3 class="h-display">Next round starts in <span class="num">42s</span></h3>
      <p>Straight text and a straight hit box on a hand-cut edge. Votes close when the timer does.</p>
      <div class="btnrow">${btn({ label: 'Start race' })}${btn({ label: 'Ready', variant: 'secondary' })}</div>
    </div>
    <p class="cap"><b>Paper panel.</b> Wobble outline of ±${tokens.wobble.amplitudePx.desk} px over ${wMin}–${wMax} segments per edge, ink outline ${tokens.ink.outlinePx.desk} px, sticker shadow y ${stk.y} px. Seeded by id, never animated. Saffron title tab skews its box, not its text.</p>
  </div>
  <div class="pcol off">
    <div class="ink-base">
      <div class="panel-ink wb on-ink" data-wobble="panel-ink" data-shadow="0">
        <h3 class="h-display">Your controls</h3>
        <div class="row-ink"><span>Vibration</span>${toggle({ on: true })}</div>
        <div class="row-ink"><span>Reduced motion<small>Fewer flashes and no shake</small></span>${toggle({ on: false })}</div>
        <div style="margin-top:var(--sp-2)">${btn({ label: 'Save and return to driving', extra: 'wide' })}</div>
      </div>
    </div>
    <p class="cap"><b>Ink panel</b> (controller, dim room). Ink base, ink-raised panel with an ink-soft edge, paper text, darker ink rows. Saffron stays the primary action; shadows go black.</p>
  </div>
  <div class="pcol off">
    <div class="stack">
      ${recRow({ label: 'Steering response', sub: 'Gentle to direct', on: true })}
      ${recRow({ label: 'Remember on this device', sub: 'Across rooms until you reset or clear browser data.', on: false })}
    </div>
    <p class="cap"><b>Recessed row.</b> Paper-shade fill, paper-line hairline and an inner top shadow, so it reads as pressed into the panel. 48 px minimum height; the whole row is the hit target.</p>
  </div>
</div>`;

// ---------- 3 badges and chips ----------
const SEATS = [1, 7, 12, 108, 999];
const badgesBody = `
  <div class="lrow"><div class="rl"><b>Identity number badges</b>Seat n takes colour (n − 1) mod 12. Number in the display face, tabular digits, text colour from the colour's <i>on</i> value.</div>
    <div class="badges">${SEATS.map((n) => `<div class="blk">${badge(n)}<span class="cap"><b>#${n}</b> ${tokens.identity.colors[seatColor(n)].name}<br>colour ${seatColor(n)} · on ${tokens.identity.colors[seatColor(n)].on}</span></div>`).join('')}</div></div>
  <div class="lrow"><div class="rl"><b>Status chips</b>32 px pill, ink outline, 2 px shadow. Icon plus word, never colour alone.</div>
    <div class="badges">
      <div class="blk">${chip('ready')}<span class="cap">Success fill, paper text</span></div>
      <div class="blk">${chip('choosing')}<span class="cap">Paper-shade, italic: transient</span></div>
      <div class="blk">${chip('reconnecting')}<span class="cap">Warning fill, ink text</span></div>
      <div class="blk">${chip('autopilot')}<span class="cap">Cobalt fill, paper text</span></div>
    </div></div>`;

// ---------- 4 toasts ----------
const toast = (kind, icon, inner, extra = '') => `<div class="toast toast-${kind}" role="${kind === 'error' ? 'alert' : 'status'}"><span class="tile">${ic(icon)}</span><p>${inner}</p>${extra}</div>`;
const toastsBody = `<div class="toasts">
  <div class="pblk"><span class="cap k"><b>Info</b> · circle-help</span>${toast('info', 'circle-help', 'The host is choosing the next track.')}</div>
  <div class="pblk"><span class="cap k"><b>Success</b> · check</span>${toast('success', 'check', '<b>Saved</b>')}</div>
  <div class="pblk"><span class="cap k"><b>Warning</b> · wifi-off</span>${toast('warning', 'wifi-off', '<b>Reconnecting as #7…</b>')}</div>
  <div class="pblk"><span class="cap k"><b>Error</b> · triangle-alert · role=alert, waits for the player</span>${toast('error', 'triangle-alert', '<b>Couldn’t reach the room.</b> Check your Wi-Fi, then tap Retry.', btn({ label: 'Retry', variant: 'secondary' }))}</div>
</div>`;

// ---------- 5 confirmation ----------
const ghost = `<div class="ghost" aria-hidden="true"><div class="gbar"><span>Round 3 complete</span></div><div class="gp">Next round starts in <i>42s</i></div><div class="gp">Vote on your controller</div></div>`;
const confirmsBody = `<div class="confirms">
  <div class="pblk"><span class="cap"><b>Destructive.</b> Focus starts on the safe action (Cancel). Danger fill only on the button that does the damage.</span>
    <div class="stage">${ghost}<div class="scrim"></div>
      <div class="modal wb" data-wobble="modal-end" role="alertdialog" aria-labelledby="m1">
        <div class="modal-head"><span class="tile" style="--tile-bg:var(--c-danger)">${ic('triangle-alert')}</span><h3 class="h-display" id="m1">End the room?</h3></div>
        <p>Everyone is disconnected and the results are lost.</p>
        <div class="btnrow">${btn({ label: 'Cancel', variant: 'secondary', state: 'focus-kb' })}${btn({ label: 'End room', variant: 'destructive' })}</div>
      </div></div></div>
  <div class="pblk"><span class="cap"><b>Non-destructive.</b> Primary is saffron, the way out is a quiet-weight secondary. Focus starts on the primary.</span>
    <div class="stage">${ghost}<div class="scrim"></div>
      <div class="modal wb" data-wobble="modal-join" role="dialog" aria-labelledby="m2">
        <div class="modal-head">${badge(7)}<h3 class="h-display" id="m2">Join the race as #7?</h3></div>
        <p>You're #7 and you drive straight away. Everyone else keeps racing.</p>
        <div class="btnrow">${btn({ label: 'Not now', variant: 'quiet' })}${btn({ label: 'Join', variant: 'primary', state: 'focus-kb' })}</div>
      </div></div></div>
</div>`;

// ---------- 6 progress and loading ----------
const progressBody = `<div class="pgrid">
  <div class="pblk"><span class="cap k">Determinate bar</span>
    <div class="bar-head"><span>Preparing track…</span><span class="num">64%</span></div>
    <div class="bar" role="progressbar" aria-valuenow="64" aria-valuemin="0" aria-valuemax="100"><i></i></div>
    <span class="cap">Hazard-stripe fill, ink end cap, the percentage in cobalt display figures.</span></div>
  <div class="pblk"><span class="cap k">Indeterminate spinner</span>
    <div class="spin-row"><i class="spinner lg" role="status" aria-label="Loading"></i><span>Connecting to the host…</span></div>
    <span class="cap">Used when the wait has no measurable end. Stops turning under reduced motion; the words stay.</span></div>
  <div class="pblk"><span class="cap k">Countdown number</span>
    <div class="count"><div class="count-box wb" data-wobble="count-3"><span class="num" aria-live="assertive">3</span></div><span class="cap">Display face, hero size, cobalt on paper.<br>Beat: punches in, fades on the second.<br>Reduced motion: numbers just swap.</span></div></div>
  <div class="pblk"><span class="cap k">Skeleton row</span>
    <div class="sk-row" aria-busy="true"><span class="sk badge-sk"></span><span class="sk-lines"><span class="sk line" style="width:46%"></span><span class="sk line" style="width:28%"></span></span><span class="sk pill"></span></div>
    <div class="sk-row" aria-busy="true"><span class="sk badge-sk"></span><span class="sk-lines"><span class="sk line" style="width:38%"></span><span class="sk line" style="width:22%"></span></span><span class="sk pill"></span></div>
    <span class="cap">Same footprint as a roster row, so nothing jumps when the data lands.</span></div>
</div>`;

// ---------- 7 error state ----------
const errorBody = `<div class="errp wb" data-wobble="err-ended" role="alert">
  <span class="tile">${ic('triangle-alert')}</span>
  <div class="txt"><h3 class="h-title">Room <span class="room">ROO7</span> has ended.</h3><p>Ask the host for the new code.</p></div>
  ${btn({ label: 'Enter code', icon: 'keyboard' })}
</div>
<p class="cap" style="margin-top:var(--sp-4)">Say what happened, then the next useful action, in one panel. Danger-tint wash, ink outline; the button is the way forward, not Retry on a room that no longer exists.</p>`;

// ---------- 8 fields and toggles ----------
const fld = ({ label, value = '', placeholder = '', state = '', hint = '', error = '' }) =>
  `<div class="field"><label>${label}</label><input class="${cls('code-input', stateCls(state))}" value="${value}" placeholder="${placeholder}" maxlength="8" spellcheck="false" autocapitalize="characters"${state === 'disabled' ? ' disabled' : ''}${state === 'error' ? ' aria-invalid="true"' : ''}>${error ? `<p class="hint err">${ic('triangle-alert')}${error}</p>` : `<p class="hint">${hint}</p>`}</div>`;
const fieldsBody = `<div class="fgrid">
  <span></span>${['Empty', 'Filled', 'Keyboard focus', 'Error', 'Disabled'].map((n) => `<div class="ch">${n}</div>`).join('')}
  <div class="rl"><b>Room code field</b>Display face, uppercase, tabular, letter-spaced. Height 60 px.</div>
  <div class="fc">${fld({ label: 'Room code', placeholder: 'Room code', hint: 'On the host’s screen' })}</div>
  <div class="fc">${fld({ label: 'Room code', value: 'ROO7', hint: 'On the host’s screen' })}</div>
  <div class="fc">${fld({ label: 'Room code', value: 'ROO7', state: 'focus-kb', hint: 'On the host’s screen' })}</div>
  <div class="fc">${fld({ label: 'Room code', value: 'ROO9', state: 'error', error: 'No room with that code' })}</div>
  <div class="fc">${fld({ label: 'Room code', value: 'ROO7', state: 'disabled', hint: 'Locked while joining' })}</div>
</div>
<div class="tgrid" style="margin-top:var(--sp-5);border-top:2px dashed var(--c-paper-line)">
  <span></span>${['Off', 'On', 'Disabled, off', 'Disabled, on'].map((n) => `<div class="ch" style="padding-top:var(--sp-4)">${n}</div>`).join('')}
  <div class="rl"><b>Toggle</b>Cobalt track when on, plus a tick in the knob, so state is never colour alone.</div>
  <div class="tc">${recRow({ label: 'Vibration', on: false })}</div>
  <div class="tc">${recRow({ label: 'Vibration', on: true })}</div>
  <div class="tc">${recRow({ label: 'Vibration', on: false, state: 'disabled' })}</div>
  <div class="tc">${recRow({ label: 'Vibration', on: true, state: 'disabled' })}</div>
</div>`;

// ---------- 9 focus ----------
const fcell = (kind, mode) => {
  const s = mode ? `focus-${mode}` : '';
  if (kind === 'btn') return btn({ label: 'Start race', state: s });
  if (kind === 'ink') return `<div class="ink-well on-ink">${btn({ label: 'Ready', variant: 'secondary', state: s })}</div>`;
  if (kind === 'card') return rosterCard({ n: 7, name: 'Dusty', chipKind: 'ready', state: s });
  return recRow({ label: 'Vibration', on: true, state: s });
};
const focusBody = `<div class="ftable">
  <span></span>
  <div class="ch">Button on paper<small>primary</small></div><div class="ch">Button on ink<small>secondary, controller</small></div><div class="ch">Roster card<small>badge, name, ready</small></div><div class="ch">Toggle row<small>switch</small></div>
  ${[
    ['', 'Resting', 'No focus, for comparison.'],
    ['kb', 'Keyboard focus', `Ring ${tokens.focus.keyboard.widthPx.desk} px, offset ${tokens.focus.keyboard.offsetPx.desk} px. Cobalt on paper, saffron on ink.`],
    ['gp', 'Gamepad focus', `Saffron ring ${tokens.focus.gamepad.widthPx.desk} px, offset ${tokens.focus.gamepad.offsetPx.desk} px, chevron tab on the leading edge, lift −2 px, deeper shadow.`],
  ].map(([mode, name, sub]) => `<div class="rl"><b>${name}</b>${sub}</div>${['btn', 'ink', 'card', 'row'].map((k) => `<div class="fcell">${fcell(k, mode)}</div>`).join('')}`).join('')}
</div>
<p class="cap" style="margin-top:var(--sp-4)">Both rings follow the element's corner radius but are drawn outside it: focus never changes layout, never clips, and is never removed for looks. The gamepad ring carries a hairline of ink either side, because saffron alone is only about 1.6:1 against paper.</p>`;

// ---------- 10 touch target ----------
const touchBody = `<div class="lrow"><div class="rl"><b>Minimum touch target</b>${tokens.layout.minTouchTargetPx} px square, ${tokens.layout.minTouchGapPx} px between neighbours. Dashed cobalt = the hit area.</div>
  <div class="tt-row">
    <div class="tt-demo"><div class="hit"><button type="button" class="btn btn-secondary small" aria-label="Settings">${ic('settings')}</button></div><span class="cap"><b>Small visual, full target.</b> 32 px button inside a 48 px hit area.</span></div>
    <div class="tt-demo"><div class="hit">${btn({ variant: 'secondary', iconOnly: 'settings', aria: 'Settings', extra: 'flush' })}</div><span class="cap"><b>Standard icon button.</b> Visual and hit area are both 48 px.</span></div>
    <div class="tt-demo"><div class="tt-pair"><div class="hit"><button type="button" class="btn btn-secondary small" aria-label="Mute">${ic('volume-x')}</button></div><div class="hit"><button type="button" class="btn btn-secondary small" aria-label="Fullscreen">${ic('maximize')}</button></div></div><span class="cap"><b>Neighbours.</b> Hit areas are ${tokens.layout.minTouchGapPx} px apart and never overlap.</span></div>
  </div></div>`;

// ---------- 11 TV profile at half size ----------
const tvRows = Object.entries(tvP.scale).map(([k, v]) => `<dt>${k}</dt><dd><b>${v * H} px</b> here · ${v} px at 1080p</dd>`).join('');
const tvBody = `<div class="tvwrap">
  <div class="tv-screen tv">
    <div class="tv-safe" style="inset:${+(tokens.layout.tvSafe.title * 100).toFixed(2)}%;"></div>
    <div class="tv-safe" style="inset:${+(tokens.layout.tvSafe.action * 100).toFixed(2)}%;border-color:var(--c-teal);"></div>
    <div class="tv-inner">
      <div class="tv-top"><span class="title-tab"><span>Round 3 complete</span></span>${chip('autopilot')}</div>
      <div class="tv-panel wb" data-wobble="tv-panel">
        <h3 class="h-display">Next round starts in <span class="num">42s</span></h3>
        <div class="tv-cards">${rosterCard({ n: 7, name: 'Dusty', chipKind: 'ready' })}${rosterCard({ n: 12, name: 'Pip', chipKind: 'choosing' })}${rosterCard({ n: 108, name: 'Ash', chipKind: 'ready' })}</div>
      </div>
      <div class="tv-prog"><div class="bar-head"><span>Preparing track…</span><span class="num">64%</span></div><div class="bar"><i></i></div></div>
      <div class="tv-bottom">${btn({ label: 'Start race', state: 'focus-gp' })}${btn({ label: 'Ready', variant: 'secondary' })}${btn({ label: 'End room', variant: 'destructive' })}${toast('success', 'check', '<b>Saved</b>')}</div>
    </div>
  </div>
  <div class="tv-spec">
    <h3 class="h-title">TV profile at half size</h3>
    <p class="cap">Every size, outline, ring and wobble value comes from the <b>tv</b> profile in tokens.json, multiplied by 0.5, so this 960 × 540 screen is a 1080p screen at half scale. Spacing steps ×${tokens.space.profileMultiplier.tv} × 0.5.</p>
    <div class="rule"></div>
    <dl>${tvRows}
      <dt>outline</dt><dd><b>${tokens.ink.outlinePx.tv * H} px</b> here · ${tokens.ink.outlinePx.tv} px</dd>
      <dt>radius</dt><dd><b>${tokens.layout.radiusPx.tv * H} px</b> here · ${tokens.layout.radiusPx.tv} px</dd>
      <dt>shadow y</dt><dd><b>${(tvShadowY * H).toFixed(2)} px</b> here · ${tvShadowY.toFixed(2)} px (scales with outline)</dd>
      <dt>wobble</dt><dd><b>±${tokens.wobble.amplitudePx.tv * H} px</b> here · ±${tokens.wobble.amplitudePx.tv} px</dd>
      <dt>keyboard ring</dt><dd><b>${tokens.focus.keyboard.widthPx.tv * H} px</b> + ${tokens.focus.keyboard.offsetPx.tv * H} px offset · ${tokens.focus.keyboard.widthPx.tv} / ${tokens.focus.keyboard.offsetPx.tv} px</dd>
      <dt>gamepad ring</dt><dd><b>${tokens.focus.gamepad.widthPx.tv * H} px</b> + ${tokens.focus.gamepad.offsetPx.tv * H} px offset · ${tokens.focus.gamepad.widthPx.tv} / ${tokens.focus.gamepad.offsetPx.tv} px</dd>
      <dt>min text</dt><dd><b>${tvP.minTextPx * H} px</b> here · ${tvP.minTextPx} px at 1080p</dd>
    </dl>
    <div class="rule"></div>
    <p class="cap">The world colours behind the panel are a stand-in for the 3D scene. Text and the QR stay inside title-safe (dashed cobalt, ${+(tokens.layout.tvSafe.title * 100).toFixed(1)}%); other chrome stays inside action-safe (dashed teal, ${+(tokens.layout.tvSafe.action * 100).toFixed(1)}%). Start race carries gamepad focus: on a TV the tab and ring are the only cursor.</p>
  </div>
</div>`;

app.innerHTML = [
  `<header class="masthead"><div><div class="overline">Joystick Jammers · UI design guide · P1-U01 · tokens v${tokens.version} (${tokens.status})</div><h1>Component sheet</h1>
     <p>Every component in every state, forced with classes so the sheet is a still. Desk profile (laptop at 60 cm): type ${tokens.type.profiles.desk.scale.body} px body, outline ${tokens.ink.outlinePx.desk} px, radius ${tokens.layout.radiusPx.desk} px. The TV profile is at the bottom, at half size.</p></div>
     <div class="legend"><span><i class="sw" style="background:var(--c-cobalt)"></i><b>Keyboard focus</b> cobalt ring on paper, saffron on ink</span><span><i class="sw" style="background:var(--c-saffron)"></i><b>Gamepad focus</b> saffron ring, chevron tab, lift</span><span><b>Hover</b> lighter fill · <b>Pressed</b> shadow collapses · <b>Disabled</b> flat and muted</span></div></header>`,
  section(1, 'Buttons', 'Sentence-case labels, 48 px minimum height, ink outline, hard sticker shadow. Pressed drops the button by the shadow offset; disabled has no shadow at all.', buttonsGrid),
  section(2, 'Panels', 'Paper for the TV, ink for the controller, recessed rows for settings. Outlines wobble; text, content and hit boxes do not.', panels),
  section(3, 'Badges and chips', 'A number plus a colour identifies every seat for any N. Colours repeat after 12; the number never does.', badgesBody),
  section(4, 'Toasts', 'One line, one icon, one idea. Stays four seconds, except errors, which wait for the player.', toastsBody),
  section(5, 'Confirmation', 'A modal over a dimmed page. Name the consequence in the body and the action on the button.', confirmsBody),
  section(6, 'Progress and loading', 'Show that something is happening, and how much when we know.', progressBody),
  section(7, 'Error state', 'An inline error panel always ends in the next useful action.', errorBody),
  section(8, 'Fields and toggles', 'The room code is the one text input players meet, so it gets the display face.', fieldsBody),
  section(9, 'Focus: keyboard and gamepad', 'Focus is always visible and never removed. Keyboard and gamepad are told apart at a glance and from across a room.', focusBody),
  section(10, 'Touch target', 'Small things look small but are never small to hit.', touchBody),
  section(11, 'TV profile at half size', 'The same components at the TV scale: heavier outlines, bigger type, thicker rings, shown at 50%.', tvBody),
].join('');

// ---------- wobble outlines: geometry from wobblePath, styling from CSS ----------
for (const el of document.querySelectorAll('[data-wobble]')) {
  const cs = getComputedStyle(el);
  const o = parseFloat(cs.getPropertyValue('--outline'));
  const amp = parseFloat(cs.getPropertyValue('--wobble-amp'));
  const shY = el.dataset.shadow === '0' ? 0 : parseFloat(cs.getPropertyValue('--sh-y')) * (el.classList.contains('is-focus-gp') ? 1.6 : 1);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const d = wobblePath(el.dataset.wobble, w - o, h - o, amp, tokens.wobble.segmentsPerEdge);
  el.insertAdjacentHTML('afterbegin',
    `<svg class="wb-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${shY ? `<path class="wb-shadow" d="${d}" transform="translate(${o / 2} ${o / 2 + shY})" stroke-width="${o}"/>` : ''}<path class="wb-fill" d="${d}" transform="translate(${o / 2} ${o / 2})" stroke-width="${o}"/></svg>`);
}

await document.fonts.ready;
window.sheetReady = true;
