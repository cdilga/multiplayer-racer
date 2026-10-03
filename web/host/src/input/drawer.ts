// The host's input drawer (P1-C05): which local sources exist, which have claimed a seat, which are unplugged, and
// each key cluster's legend. Its visual design belongs to the accepted TV mocks (R07); this is the plain version the
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
      const controls = seated
        ? ` <button type="button" data-act="sit-out" data-source="${s.source}">${s.sittingOut ? 'Return' : 'Sit out'}</button>` +
          ` <button type="button" data-act="leave" data-source="${s.source}">Leave</button>`
        : '';
      return `<li data-source="${s.source}" data-kind="${s.kind}" data-state="${state}">${s.label}: ${state}${controls}</li>`;
    });
    el.innerHTML = `<ul>${rows.join('')}</ul><ul>${input
      .clusters()
      .map((c) => `<li>${legend(c)}</li>`)
      .join('')}</ul>`;
  };
  // Sit out / Return and Leave act on that source's seat at the next tick boundary (plan §9).
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
    if (!b) return;
    const source = Number(b.dataset.source);
    if (b.dataset.act === 'sit-out') input.toggleSitOut(source);
    else input.leave(source);
    render();
  });
  render();
  const t = setInterval(render, everyMs);
  return () => clearInterval(t);
}
