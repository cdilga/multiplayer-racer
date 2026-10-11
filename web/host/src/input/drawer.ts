// The host's input drawer (P1-C05): which local sources exist, which have claimed a seat, which are unplugged, and
// each key cluster's legend. Wheels (P1-C05.2) show their profile and live steering and pedals, and any device can be
// mapped as a wheel here: the prompts walk the calibration and the profile is saved for that device. Its visual design belongs to the accepted TV mocks (R07); this is the plain version the
// host shows until then, and the data the designed one will read.
import { controlsCard, keyLabel, paperQrCard } from '../../../shared/ui';
import { morePadsHint } from '../../../shared/ui/controller-options';
import { controlsData } from './controls-data';
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
  const qr = o.joinUrl && o.code ? paperQrCard({ url: o.joinUrl, code: o.code, domain: new URL(o.joinUrl).host, size: 112 }).outerHTML : '';
  const render = () => {
    const rows = input.list().map((s) => {
      const keysOff = s.kind === 'keys' && !input.keyboardPlayers();
      const idle = !s.claimed || s.left;
      const state = s.left
        ? 'left'
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
      const seated = s.claimed && !s.left && (s.connected || s.kind === 'keys');
      const held = s.claimed && !s.left && !s.connected && s.kind !== 'keys';
      const btn = (act: string, text: string) => ` <button type="button" data-act="${act}" data-source="${s.source}">${text}</button>`;
      if (s.calibrating) {
        return `<li data-source="${s.source}" data-kind="${s.kind}" data-state="calibrating" data-step="${s.calibrating.step}">${s.label}: ${s.calibrating.prompt}${btn('skip', 'Skip')}${btn('cancel', 'Cancel')}</li>`;
      }
      let controls = seated ? btn('sit-out', s.sittingOut ? 'Return' : 'Sit out') + btn('leave', 'Leave') : '';
      if (held) controls += btn('remove', 'Remove');
      let hint = '';
      if (s.kind === 'keys' && idle) {
        const c = input.clusters().find((k) => k.id === s.source);
        hint = c && !keysOff ? ` · press ${key(c.drive.up)} to join` : '';
        controls += `<button type="button" data-act="add" data-source="${s.source}"${keysOff ? ' disabled' : ''}>Add</button>`;
      }
      let detail = '';
      if (s.kind === 'wheel' && s.wheel) {
        const w = s.wheel;
        detail = ` · steer ${w.steer.toFixed(2)}, accelerator ${w.throttle.toFixed(2)}, brake ${w.brake.toFixed(2)}${w.verified ? '' : ' (profile not yet confirmed on a device)'}`;
        controls += w.verified ? btn('calibrate', 'Recalibrate') : btn('confirm', 'Looks right') + btn('calibrate', 'Calibrate');
      } else if (s.needsMapping) {
        detail = ' · needs mapping';
        controls += btn('calibrate', 'Map as a wheel');
      } else if (s.kind === 'pad' && s.connected) {
        controls += btn('calibrate', 'Map as a wheel');
      }
      return `<li data-source="${s.source}" data-kind="${s.kind}" data-state="${state}">${s.label}${hint && state === 'press to join' ? '' : `: ${state}`}${hint}${detail}${controls}</li>`;
    });
    // The head is what shows while a race collapses the drawer (it expands on hover or keyboard focus).
    const seated = input.list().filter((s) => s.connected && s.claimed && !s.left).length;
    const on = input.keyboardPlayers();
    const data = controlsData();
    const padsHint = morePadsHint([...(navigator.getGamepads?.() ?? [])]);
    const legends = input.clusters().map((c) => `<li><b>${esc(c.label)}</b>: drive ${Object.values(c.drive).map(key).join(' / ')}, action ${Object.values(c.action).map(key).join(' / ')}, Identify ${key(c.identify)}, Ready ${key(c.ready)}</li>`).join('');
    const html = `<div class="drawer-head" tabindex="0">Keys &amp; pads${seated ? ` · ${seated} playing` : ''}</div>
      <div class="dr-bar"><button type="button" data-act="keys-toggle" aria-pressed="${on}">Keyboard players: ${on ? 'on' : 'off'}</button><button type="button" data-act="controls">Controls</button></div>
      ${padsHint ? `<p class="dr-options" data-more-pads>${padsHint}</p>` : ''}
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
      el.innerHTML = last = html;
      el.querySelector<HTMLDetailsElement>('[data-keyboard-options]')!.open = open;
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
    render();
  });
  render();
  const t = setInterval(render, o.everyMs ?? 500);
  return () => clearInterval(t);
}
