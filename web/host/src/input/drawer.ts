// The host's input drawer (P1-C05): which local sources exist, which have claimed a seat, which are unplugged, and
// each key cluster's legend. Wheels (P1-C05.2) show their profile and live steering and pedals, and any device can be
// mapped as a wheel here: the prompts walk the calibration and the profile is saved for that device. Its visual design belongs to the accepted TV mocks (R07); this is the plain version the
// host shows until then, and the data the designed one will read.
import { controlsCard, keyLabel, paperQrCard } from '../../../shared/ui';
import { morePadsHint } from '../../../shared/ui/controller-options';
import { controlsData } from './controls-data';
import { downloads, loadDownloads } from './helper';
import type { LocalInput } from './local';
import './drawer.css';

const key = keyLabel;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Renders the drawer into `root` and keeps it current. */
export function mountDrawer(root: HTMLElement, input: LocalInput, o: { everyMs?: number; joinUrl?: string; code?: string } = {}): () => void {
  const el = document.createElement('aside');
  el.dataset.jjInputDrawer = '';
  el.setAttribute('aria-label', 'Input drawer');
  root.append(el);
  // Keep the opaque frame separate from the scroll layer: Chromium can otherwise occlude the world canvas
  // using the scroll content's unclipped height after a resize (br-dx0e).
  const scroll = document.createElement('div');
  scroll.className = 'drawer-scroll';
  el.append(scroll);
  const qr = o.joinUrl && o.code ? paperQrCard({ url: o.joinUrl, code: o.code, domain: new URL(o.joinUrl).host, size: 112 }).outerHTML : '';
  const render = () => {
    const rows = input.list().map((s) => {
      const keysOff = s.kind === 'keys' && !input.keyboardPlayers();
      const idle = !s.claimed || s.left;
      const state = s.left
        ? 'left'
        : s.helperOwned
          ? 'the input helper has these'
          : !s.connected
          ? 'unplugged'
          : !s.claimed
            ? keysOff
              ? 'keyboard off'
              : 'press to join'
            : s.sittingOut
              ? 'sitting out'
              : 'playing';
      // A seated key cluster stays leavable while the keyboard is off; an unplugged pad's held seat gets Remove instead.
      // A helper keyboard is a device that can be unplugged, like a pad.
      const cluster = s.kind === 'keys' && !s.helper;
      const seated = s.claimed && !s.left && (s.connected || cluster);
      const held = s.claimed && !s.left && !s.connected && !cluster;
      const btn = (act: string, text: string) => ` <button type="button" data-act="${act}" data-source="${s.source}">${text}</button>`;
      if (s.calibrating) {
        return `<li data-source="${s.source}" data-kind="${s.kind}" data-state="calibrating" data-step="${s.calibrating.step}">${s.label}: ${s.calibrating.prompt}${btn('skip', 'Skip')}${btn('cancel', 'Cancel')}</li>`;
      }
      let controls = seated ? btn('sit-out', s.sittingOut ? 'Return' : 'Sit out') + btn('leave', 'Leave') : '';
      if (held) controls += btn('remove', 'Remove');
      let hint = '';
      if (s.kind === 'keys' && idle) {
        const c = input.clusterOf(s.source);
        hint = c && !keysOff && !s.helperOwned ? ` · press ${key(c.drive.up)} to join` : '';
        if (!s.helperOwned) controls += `<button type="button" data-act="add" data-source="${s.source}"${keysOff ? ' disabled' : ''}>Add</button>`;
      }
      let detail = '';
      if (s.kind === 'wheel' && s.wheel) {
        const w = s.wheel;
        detail = ` · steer ${w.steer.toFixed(2)}, accelerator ${w.throttle.toFixed(2)}, brake ${w.brake.toFixed(2)}${w.verified ? '' : ' (profile not yet confirmed on a device)'}`;
        controls += w.verified ? btn('calibrate', 'Recalibrate') : btn('confirm', 'Looks right') + btn('calibrate', 'Calibrate');
      } else if (s.needsMapping) {
        detail = ' · needs mapping';
        controls += btn('calibrate', 'Map as a wheel');
      } else if (s.kind === 'pad' && s.connected && !s.helper && !s.helperOwned) {
        controls += btn('calibrate', 'Map as a wheel');
      }
      const via = s.helper ? ' data-helper' : '';
      return `<li data-source="${s.source}" data-kind="${s.kind}"${via} data-state="${state}">${s.label}${hint && state === 'press to join' ? '' : `: ${state}`}${hint}${detail}${controls}</li>`;
    });
    // The head is what shows while a race collapses the drawer (it expands on hover or keyboard focus).
    const seated = input.list().filter((s) => s.connected && s.claimed && !s.left).length;
    const on = input.keyboardPlayers();
    const data = controlsData();
    const padsHint = morePadsHint([...(navigator.getGamepads?.() ?? [])]);
    const legends = input.clusters().map((c) => `<li><b>${esc(c.label)}</b>: drive ${Object.values(c.drive).map(key).join(' / ')}, action ${Object.values(c.action).map(key).join(' / ')}, Identify ${key(c.identify)}, Ready ${key(c.ready)}</li>`).join('');
    const html = `<div class="drawer-head" tabindex="0">Keys &amp; pads${seated ? ` · ${seated} playing` : ''}</div>
      <div class="dr-bar"><button type="button" data-act="keys-toggle" aria-pressed="${on}">Keyboard players: ${on ? 'on' : 'off'}</button><button type="button" data-act="controls">Controls</button></div>
      ${padsHint && !input.helper.owns('pad') ? `<p class="dr-options" data-more-pads>${padsHint}</p>` : ''}
      ${helperPanel(input)}
      <details class="dr-options" data-keyboard-options><summary>Add another keyboard</summary>
        <p>Use a different cluster on each keyboard:</p><ul class="dr-legends">${legends}</ul>
        ${o.joinUrl ? `<p>Or plug it into a phone or laptop and <a href="${esc(o.joinUrl)}" target="_blank" rel="noopener">join this room there</a>.</p>${qr}` : ''}
      </details>
      <ul class="dr-rows">${rows.join('')}</ul><div class="dr-cards">${input
      .clusters()
      .map((c) => controlsCard({ kind: 'keys', cluster: c.id }, data, { compact: true }))
      .join('')}</div>`;
    // Only when something changed: rebuilding every tick swaps the buttons out from under a pointer (or a
    // Playwright click) on a host whose frames are slow.
    if (html !== last) {
      const open = el.querySelector<HTMLDetailsElement>('[data-keyboard-options]')?.open ?? false;
      // The pairing code being typed survives a re-render.
      const code = el.querySelector<HTMLInputElement>('[data-helper-code]');
      const typed = code?.value ?? '';
      const focused = !!code && document.activeElement === code;
      scroll.innerHTML = last = html;
      el.querySelector<HTMLDetailsElement>('[data-keyboard-options]')!.open = open;
      const again = el.querySelector<HTMLInputElement>('[data-helper-code]');
      if (again) {
        again.value = typed;
        if (focused) again.focus();
      }
    }
  };
  let last = '';
  // Sit out / Return and Leave act on that source's seat at the next tick boundary (plan §9).
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
    if (!b) return;
    const source = Number(b.dataset.source);
    const act = b.dataset.act;
    if (act === 'sit-out') input.toggleSitOut(source);
    else if (act === 'leave') input.leave(source);
    else if (act === 'add') input.join(source);
    else if (act === 'remove') input.remove(source);
    else if (act === 'keys-toggle') input.setKeyboardPlayers(!input.keyboardPlayers());
    else if (act === 'controls') window.dispatchEvent(new CustomEvent('jj-open-controls'));
    else if (act === 'calibrate') input.calibrate(source);
    else if (act === 'skip') input.skipStep(source);
    else if (act === 'cancel') input.cancelCalibration(source);
    else if (act === 'confirm') input.confirmWheel(source);
    else if (act === 'helper-connect') input.helper.connect();
    else if (act === 'helper-pair') pairTyped();
    else if (act === 'helper-off') input.helper.disconnect();
    render();
  });
  const pairTyped = () => {
    const code = el.querySelector<HTMLInputElement>('[data-helper-code]');
    if (code?.value.trim()) input.helper.pair(code.value);
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('[data-helper-code]')) pairTyped();
  });
  input.helper.onChange = render;
  void loadDownloads().then(render);
  render();
  const t = setInterval(render, o.everyMs ?? 500);
  return () => clearInterval(t);
}

/** The native input helper's block (P1-C12.1): install it, connect, pair with its code, and its devices once paired. */
function helperPanel(input: LocalInput): string {
  const h = input.helper;
  const links = downloads();
  const mine = links[0]!;
  const others = links.slice(1).filter((d) => d.available).map((d) => `<a href="${esc(d.href)}" download data-helper-download="${d.os}">${esc(d.label)}</a>`).join(' · ');
  const also = others ? `; also ${others}` : '';
  const install = mine.available
    ? `<a class="dr-install" href="${esc(mine.href)}" download data-helper-download="${mine.os}" data-mine>Install the input helper</a> <span class="dr-note">(${esc(mine.label)}${also})</span>`
    : `<span class="dr-note" data-helper-unbuilt="${mine.os}">The ${esc(mine.label)} build isn't on this server yet${also}.</span>`;
  const btn = (act: string, text: string) => `<button type="button" data-act="${act}">${text}</button>`;
  let body: string;
  if (h.state === 'off') {
    body = `<p>One player per keyboard on this computer, and pads past the browser's four: ${install}</p>
      <p>Run it, then ${btn('helper-connect', 'Connect')}</p>`;
  } else if (h.state === 'connecting' || h.state === 'absent') {
    body = `<p>Looking for the input helper on this computer. Start it and it connects by itself. ${btn('helper-off', 'Stop looking')}</p><p>${install}</p>`;
  } else if (h.state === 'pairing') {
    body = `<p>Input helper found. Type the code its window shows:
      <input data-helper-code inputmode="numeric" autocomplete="off" maxlength="6" size="7" aria-label="Pairing code" placeholder="000000"> ${btn('helper-pair', 'Pair')}</p>
      ${h.error ? `<p class="dr-error" role="alert">${esc(h.error)}</p>` : ''}`;
  } else {
    const devices = h.devices();
    const kb = devices.filter((d) => d.kind === 'keyboard' && d.connected).length;
    const pads = devices.filter((d) => d.kind === 'pad' && d.connected).length;
    const list = devices.map((d) => `<li data-helper-device="${d.id}" data-kind="${d.kind}" data-connected="${d.connected}">${esc(d.name)}${d.connected ? '' : ': unplugged'}</li>`).join('');
    body = `<p>Connected: ${kb} keyboard${kb === 1 ? '' : 's'} and ${pads} pad${pads === 1 ? '' : 's'}, each its own player. Every keyboard plays W A S D, T / G, Q and E. ${btn('helper-off', 'Disconnect')}</p>
      ${list ? `<ul class="dr-helper-devices">${list}</ul>` : '<p>Plug in a keyboard or pad.</p>'}`;
  }
  return `<div class="dr-options" data-input-helper data-helper-state="${h.state}"><b>Input helper</b> ${body}</div>`;
}
