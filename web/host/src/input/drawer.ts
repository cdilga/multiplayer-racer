// The host's input drawer (P1-C05): which local sources exist, which have claimed a seat, which are unplugged, and
// each key cluster's legend. Wheels (P1-C05.2) show their profile and live steering and pedals, and any device can be
// mapped as a wheel here: the prompts walk the calibration and the profile is saved for that device. Its visual design belongs to the accepted TV mocks (R07); this is the plain version the
// host shows until then, and the data the designed one will read.
import type { Cluster, LocalInput } from './local';

const key = (code: string) => code.replace(/^Key/, '').replace(/^Arrow/, '');

export function legend(c: Cluster): string {
  const stick = (s: Cluster['drive']) => `${key(s.up)}${key(s.left)}${key(s.down)}${key(s.right)}`;
  return `${c.label}: drive ${stick(c.drive)}, action ${stick(c.action)}, Identify ${key(c.identify)}, READY ${key(c.ready)} (hold both 2 s to leave)`;
}

/** Renders the drawer into `root` and keeps it current. */
export function mountDrawer(root: HTMLElement, input: LocalInput, everyMs = 500): () => void {
  const el = document.createElement('aside');
  el.dataset.jjInputDrawer = '';
  el.setAttribute('aria-label', 'Input drawer');
  root.append(el);
  const render = () => {
    const rows = input.list().map((s) => {
      const state = !s.connected
        ? 'unplugged'
        : !s.claimed
          ? 'press to join'
          : s.left
            ? 'left'
            : s.sittingOut
              ? 'sitting out'
              : 'playing';
      const seated = s.connected && s.claimed && !s.left;
      const btn = (act: string, text: string) => ` <button type="button" data-act="${act}" data-source="${s.source}">${text}</button>`;
      if (s.calibrating) {
        return `<li data-source="${s.source}" data-kind="${s.kind}" data-state="calibrating" data-step="${s.calibrating.step}">${s.label}: ${s.calibrating.prompt}${btn('skip', 'Skip')}${btn('cancel', 'Cancel')}</li>`;
      }
      let controls = seated ? btn('sit-out', s.sittingOut ? 'Return' : 'Sit out') + btn('leave', 'Leave') : '';
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
      return `<li data-source="${s.source}" data-kind="${s.kind}" data-state="${state}">${s.label}: ${state}${detail}${controls}</li>`;
    });
    // The head is what shows while a race collapses the drawer (it expands on hover or keyboard focus).
    const seated = input.list().filter((s) => s.connected && s.claimed && !s.left).length;
    const html = `<div class="drawer-head" tabindex="0">Keys &amp; pads${seated ? ` · ${seated} playing` : ''}</div><ul>${rows.join('')}</ul><ul>${input
      .clusters()
      .map((c) => `<li>${legend(c)}</li>`)
      .join('')}</ul>`;
    // Only when something changed: rebuilding every tick swaps the buttons out from under a pointer (or a
    // Playwright click) on a host whose frames are slow.
    if (html !== last) el.innerHTML = last = html;
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
    else if (act === 'calibrate') input.calibrate(source);
    else if (act === 'skip') input.skipStep(source);
    else if (act === 'cancel') input.cancelCalibration(source);
    else if (act === 'confirm') input.confirmWheel(source);
    render();
  });
  render();
  const t = setInterval(render, everyMs);
  return () => clearInterval(t);
}
