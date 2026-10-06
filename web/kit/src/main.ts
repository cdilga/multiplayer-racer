// The UI kit page (P1-U06): every component of web/shared/ui in every state (default, hover, pressed, keyboard focus, gamepad
// focus, disabled, loading), at any count and length, in Full or Reduced motion. It is the target of the kit tests and the
// page the visual self-review captures; it is never part of the shipped build (kit/vite.config.ts builds it on its own).
//   ?profile=handheld|desk|tv   force a profile (else the viewport picks, as the real pages do)
//   ?motion=full|reduced        force the motion mode (else the OS setting)
//   ?still=1                    stop the spinner for deterministic captures
// The button rows reuse the component sheet's names, labels and seeds (art/ui/sheets/components.js BTN_ROWS) so the brushed
// shapes match the POC sheet pixel for pixel; the kit test compares them.
import {
  applyProfile, caption, gamepadTab, icon, identify, installBrushSkins, motion, paintKit, paperQrCard, paperQrMinPx, seatBadge, seatColor, tokenData,
  type MotionName,
} from '../../shared/ui';
import './kit.css';

const q = new URLSearchParams(location.search);
const root = document.documentElement;
if (q.get('motion') === 'full' || q.get('motion') === 'reduced') root.dataset.motion = q.get('motion')!;
if (q.get('still')) root.classList.add('still');
const forced = q.get('profile');
if (forced === 'handheld' || forced === 'desk' || forced === 'tv') {
  root.dataset.profile = forced;
  root.style.setProperty('--ui-scale', forced === 'tv' ? String(innerHeight / 1080) : '1');
} else {
  applyProfile();
}

const JOIN_URL = 'https://jammers.dilger.dev/j/ROO7';
const ic = (name: string) => icon(name).outerHTML;
const spinner = '<i class="spinner" aria-hidden="true"></i>';
const cls = (...a: Array<string | false | undefined>) => a.filter(Boolean).join(' ');

const STATES: Array<[string, string]> = [['', 'Default'], ['hover', 'Hover'], ['pressed', 'Pressed'], ['focus-kb', 'Keyboard focus'], ['focus-gp', 'Gamepad focus'], ['disabled', 'Disabled'], ['loading', 'Loading']];
interface Row { name: string; sub: string; variant: string; label: string; icon?: string; iconOnly?: string; plain?: boolean }
const BTN_ROWS: Row[] = [
  { name: 'Primary', sub: 'Brushed: saffron stroke, ink outline', variant: 'primary', label: 'Start race' },
  { name: 'Secondary', sub: 'Brushed: paper stroke, ink outline', variant: 'secondary', label: 'Ready' },
  { name: 'Destructive', sub: 'Brushed: danger stroke, paper text', variant: 'destructive', label: 'Disband room' },
  { name: 'Leading icon', sub: 'Brushed, with an icon', variant: 'secondary', label: 'Find my car', icon: 'car' },
  { name: 'Compact primary', sub: 'Plain variant: footers, rows, tight spots', variant: 'primary', label: 'Start race', plain: true },
  { name: 'Compact secondary', sub: 'Plain variant', variant: 'secondary', label: 'Ready', plain: true },
  { name: 'Quiet (text)', sub: 'No outline, no shadow', variant: 'quiet', label: 'Cancel' },
  { name: 'Leading icon, destructive', sub: 'Compact, leave room', variant: 'destructive', label: 'Leave room', icon: 'log-out', plain: true },
  { name: 'Icon button', sub: '48 px square, aria-label', variant: 'secondary', label: 'Settings', iconOnly: 'settings' },
];

function button(r: Row, state: string, id: string): string {
  const brush = !r.plain && !r.iconOnly && r.variant !== 'quiet';
  const loading = state === 'loading';
  const inner = loading ? `${spinner}${r.iconOnly ? '' : '<span>Starting…</span>'}` : r.iconOnly ? ic(r.iconOnly) : `${r.icon ? ic(r.icon) : ''}<span>${r.label}</span>`;
  const tab = state === 'focus-gp' ? gamepadTab().outerHTML : '';
  return `<button type="button" class="${cls('btn', `btn-${r.variant}`, brush && 'brush', r.iconOnly && 'btn-icon', state && `is-${state}`)}"${brush ? ` data-bb="${id}"` : ''}${r.iconOnly ? ` aria-label="${r.label}"` : ''}${state === 'disabled' ? ' disabled' : ''}>${tab}${inner}</button>`;
}

const buttons = `<div class="kit-grid" data-kit="buttons">
  <div></div>${STATES.map(([, n]) => `<div class="ch">${n}</div>`).join('')}
  ${BTN_ROWS.map((r) => `<div class="rl">${r.name}<small>${r.sub}</small></div>${STATES.map(([s]) => `<div class="cell" data-row="${r.name}" data-state="${s || 'default'}">${button(r, s, `${r.name}-${s}`)}</div>`).join('')}`).join('')}
</div>
<h3 class="kit-h" style="font-size:var(--fs-title)">On ink (the controller's surface)</h3>
<div class="kit-ink on-ink" data-kit="buttons-ink">${['', 'focus-kb', 'focus-gp', 'disabled'].map((s) => button(BTN_ROWS[1]!, s, `ink-${s}`)).join('')}</div>
<h3 class="kit-h" style="font-size:var(--fs-title)">Any label, any length</h3>
<div class="kit-row" data-kit="buttons-long">${button({ ...BTN_ROWS[0]!, label: 'Save and return to driving' }, '', 'long-1')}${button({ ...BTN_ROWS[1]!, label: 'A button label that is far longer than anyone would write, to prove the slab follows it' }, '', 'long-2')}${button({ ...BTN_ROWS[2]!, label: 'Go' }, '', 'short-1')}</div>`;

const CHIPS: Array<[string, string, string]> = [
  ['chip-ready', 'check', 'Ready'], ['chip-choosing', '', 'choosing…'], ['chip-warn', 'wifi-off', 'Reconnecting'], ['chip-auto', 'car', 'Autopilot driving'], ['chip-info', 'zap', 'Boost on'],
];
const chip = ([c, i, t]: [string, string, string]) => `<span class="chip ${c}">${i ? ic(i) : ''}${t}</span>`;
const chips = `<div class="kit-row" data-kit="chips">${CHIPS.map(chip).join('')}</div>
<p class="kit-note" style="margin-top:20px">Forty chips in a row wrap, and nothing counts them or cuts the list short.</p>
<div class="kit-row" data-kit="chips-many">${Array.from({ length: 40 }, (_, n) => chip(CHIPS[n % CHIPS.length]!)).join('')}</div>
<div class="kit-ink on-ink" data-kit="chips-ink" style="margin-top:20px">${CHIPS.slice(0, 4).map(chip).join('')}</div>`;

const SEATS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 108, 2048];
const badges = `<div class="kit-row" data-kit="badges">${SEATS.map((n) => `<div class="kit-blk">${seatBadge(n).outerHTML}<span class="kit-cap">#${n} ${seatColor(n).name}</span></div>`).join('')}</div>`;

const captions = `<div class="kit-row" data-kit="captions" style="gap:28px 40px">
  <div class="kit-blk"><span class="capt" data-brush="capt-demo-1"><span>Fastest lap · ${seatBadge(5).outerHTML} Big Kev</span></span><span class="kit-cap">saffron: a replay annotation</span></div>
  <div class="kit-blk"><span class="capt ink" data-brush="capt-demo-2"><span>Late joiners welcome</span></span><span class="kit-cap">ink: a quiet line</span></div>
  <div class="kit-blk"><span class="capt teal" data-brush="capt-demo-3"><span>New lap record!</span></span><span class="kit-cap">teal: a positive callout</span></div>
  <div class="kit-blk"><div class="kit-ink on-ink" style="width:340px;padding:12px 16px"><span class="capt flat one" data-brush="capt-demo-4"><span>Final lap! Give it everything!</span></span></div><span class="kit-cap">flat, one line: the host footer band</span></div>
  <div class="kit-blk" style="width:260px"><span class="capt" data-brush="capt-demo-5"><span>Final lap! Give it everything, the pack is bunched up and nobody is lifting!</span></span><span class="kit-cap">two lines at most, then an ellipsis</span></div>
</div>`;

const qrSizes: Array<['tv' | 'desk' | 'handheld', string]> = [['tv', 'TV smallest (8 px per module)'], ['desk', 'Desk smallest (4 px)'], ['handheld', 'Handheld smallest (4 px)']];
const qrHost = '<div class="kit-row" data-kit="qr" style="align-items:flex-start;gap:32px 48px"></div>';

const seatDemo = `<div class="kit-row" data-kit="seats">${[1, 7, 12, 13, 24].map((n) => `<div class="kit-blk"><button type="button" class="btn btn-secondary" data-identify="${n}"><span>Cooee ${seatBadge(n).outerHTML}</span></button><span class="kit-cap">press to identify seat ${n} (${seatColor(n).hex})</span></div>`).join('')}</div>`;

const toastKinds: Array<[string, string, string]> = [['info', 'circle-help', 'Scanning isn’t ready yet.'], ['success', 'check', 'Saved'], ['warning', 'triangle-alert', 'Your connection is wobbly.'], ['error', 'triangle-alert', 'Couldn’t reach the room. Check your Wi-Fi, then tap Retry.']];
const toasts = `<div class="kit-toasts" data-kit="toasts">${toastKinds.map(([k, i, t]) => `<div class="toast toast-${k}"><span class="tile">${ic(i)}</span><p>${t}</p></div>`).join('')}</div>`;

const names = Object.keys(tokenData.motion) as MotionName[];
const motionRows = (mode: 'full' | 'reduced') => names.map((n) => { const m = motion(n, mode); return `<tr><td>${n}</td><td>${m.durationMs} ms${m.repeat > 1 ? ` x ${m.repeat}` : ''}</td><td>${m.easing ?? 'none'}</td><td>${m.does}</td></tr>`; }).join('');
const motionTable = (mode: 'full' | 'reduced') => `<table class="kit-table" data-kit="motion-${mode}"><caption class="kit-note">${mode === 'full' ? 'Full' : 'Reduced'}</caption><tr><th>name</th><th>time</th><th>easing</th><th>does</th></tr>${motionRows(mode)}</table>`;

const section = (title: string, note: string, body: string) => `<section><h2 class="kit-h">${title}</h2><p class="kit-note">${note}</p>${body}</section>`;
const kit = document.getElementById('kit')!;
kit.innerHTML = [
  `<header><h1 class="kit-h" style="margin-top:0;font-size:var(--fs-display)">UI kit</h1><p class="kit-note" id="mode"></p></header>`,
  section('Buttons', 'Brushed by default; the outline follows the stroke. Pressed drops by the shadow offset, focus rings wrap the whole slab, shadow included.', buttons),
  section('Chips', 'Status chips: icon plus word, never colour alone.', chips),
  section('Number badges', 'Seat n takes colour (n - 1) mod 12; the number never repeats, so any count of seats works.', badges),
  section('Captions', 'The one caption: a brush strip, display italic caps.', captions),
  section('Paper QR', 'Ink on paper with a four-module quiet zone, the room code in the display face and the domain.', qrHost),
  section('Seat identify', 'The flash in the seat colour (Full), or a held label and outline (Reduced).', seatDemo),
  section('Toasts', 'Slide in (Full) or fade (Reduced).', toasts),
  section('Motion tokens', 'tokens.motion.named in both modes.', `${motionTable('full')}${motionTable('reduced')}`),
].join('');

const host = kit.querySelector<HTMLElement>('[data-kit="qr"]')!;
for (const [profile, label] of qrSizes) {
  const wrap = document.createElement('div');
  wrap.className = 'kit-blk';
  wrap.dataset.qrProfile = profile;
  wrap.append(paperQrCard({ url: JOIN_URL, code: 'ROO7', domain: 'jammers.dilger.dev', size: paperQrMinPx(JOIN_URL, profile) }));
  const cap = document.createElement('span');
  cap.className = 'kit-cap';
  cap.textContent = label;
  wrap.append(cap);
  host.append(wrap);
}
kit.querySelectorAll<HTMLElement>('[data-identify]').forEach((b) => b.addEventListener('click', () => void identify(b)));
const modeNote = document.getElementById('mode')!;
modeNote.textContent = `Profile ${root.dataset.profile}, motion ${root.dataset.motion ?? 'by OS setting'}.`;

installBrushSkins(root);
paintKit(kit);
await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
await document.fonts.ready;
// Brushed shapes are measured at their styled size, so paint again once the fonts have settled the widths.
kit.querySelectorAll<HTMLElement>('.btn.brush').forEach((b) => b.querySelector(':scope > svg.bb')?.remove());
paintKit(kit);
(window as unknown as { kitReady: boolean }).kitReady = true;
