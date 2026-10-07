// The host's round screens over the world (P1-G01): Lobby (the join QR with the room code, every player with their
// Ready state, Start race), the 3-2-1-GO countdown, and Round complete (results, the next round's timer). Driven by the
// worker's room view (`SimClient.onRoom`). Functional first: P1-R07 builds the accepted POC look (art/ui/poc/tv,
// lobby / results / per-tile HUD) on this same data. Copy says room and round, never game (R112).
import { paintKit, paperQrCard } from '../../../shared/ui';
import type { RoomView, SimClient } from '../worker/client';

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const secs = (ms: number | null) => (ms === null ? '' : String(Math.max(0, Math.ceil(ms / 1000))));
const time = (ms: number | null) => (ms === null ? 'DNF' : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(2).padStart(5, '0')}`);

export function mountRoundScreens(client: SimClient, join: { code: string; joinUrl: string }): void {
  const root = document.createElement('div');
  root.className = 'jj-round';
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;font-family:var(--font-body,system-ui)';
  // On the body, not in #app: #app is fixed (its own stacking context), and the round screens sit above the host's
  // input drawer and the grid's join chip.
  document.body.append(root);
  const qr = join.code ? paperQrCard({ url: join.joinUrl, code: join.code, domain: new URL(join.joinUrl).host, size: 200 }) : null;
  let shown = '';

  const lobby = (room: RoomView) => {
    const players = room.seats
      .map(
        (s) =>
          `<li data-seat="${s.seat}" data-ready="${s.ready}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;background:var(--c-paper,#fff4de);color:var(--c-ink,#15203a);border:3px solid ${hex(s.rgb)}"><b style="font-size:1.4em;color:${hex(s.rgb)}">#${s.number}</b><span style="flex:1">${esc(s.name || (s.local ? 'Host keys' : 'Player'))}</span><span>${s.ready ? 'Ready ✓' : 'Choosing…'}</span></li>`,
      )
      .join('');
    root.innerHTML = `<section data-screen="lobby" style="position:absolute;inset:0;display:grid;grid-template-columns:auto 1fr;gap:24px;padding:4vmin;background:var(--c-ink,#15203a);color:var(--c-paper,#fff4de);pointer-events:auto;overflow:auto">
      <div style="display:grid;gap:12px;align-content:start"><h1 class="display italic" style="margin:0;font-size:5vmin">Room ${esc(join.code)}</h1><div data-qr></div>
      <button class="btn brush primary big" data-act="start" ${room.seats.length ? '' : 'disabled'}>Start race</button>
      <p style="margin:0;max-width:22em">${room.seats.length ? 'Everyone ready starts the race on its own.' : 'Scan to join on your phone, or press a key cluster or pad.'} ${room.laps} lap${room.laps === 1 ? '' : 's'}.</p></div>
      <ol data-players style="list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(16em,1fr));gap:10px;align-content:start">${players}</ol></section>`;
    if (qr) root.querySelector('[data-qr]')!.append(qr);
    paintKit(root);
    root.querySelector('[data-act=start]')?.addEventListener('click', () => client.input({ type: 'ui', ui: 'start' }));
  };

  const countdown = (room: RoomView) => {
    root.innerHTML = `<div data-screen="countdown" style="position:absolute;inset:0;display:grid;place-items:center"><span class="display italic" style="font-size:22vmin;color:var(--c-saffron,#ffb400);text-shadow:0 0.04em 0 var(--c-ink,#15203a)">${secs(room.remainingMs) || 'GO'}</span></div>`;
  };

  const results = (room: RoomView) => {
    const rows = (room.results ?? [])
      .map((r) => `<tr><td>${r.place || '–'}</td><td>#${r.number}</td><td>${esc(r.name)}</td><td>${time(r.time_ms)}</td><td>${r.points}</td></tr>`)
      .join('');
    root.innerHTML = `<section data-screen="results" style="position:absolute;inset:0;display:grid;place-items:center;background:rgb(21 32 58 / .82);color:var(--c-paper,#fff4de);pointer-events:auto">
      <div style="display:grid;gap:12px;min-width:min(90vw,40em)"><h1 class="display italic" style="margin:0;font-size:5vmin">Round complete</h1>
      <table data-results style="font-size:2.4vmin;border-collapse:collapse;text-align:left"><thead><tr><th>Place</th><th>#</th><th>Name</th><th>Time</th><th>Points</th></tr></thead><tbody>${rows}</tbody></table>
      <p data-next style="margin:0">Next round in ${secs(room.remainingMs)} s</p>
      <button class="btn brush primary big" data-act="start">Start next round now</button></div></section>`;
    paintKit(root);
    root.querySelector('[data-act=start]')?.addEventListener('click', () => client.input({ type: 'ui', ui: 'start' }));
  };

  client.onRoom = (room) => {
    const key = `${room.phase}:${room.seats.map((s) => `${s.seat}${s.ready}`).join()}:${room.round}`;
    if (room.phase === 'Countdown' || room.phase === 'Preparing') return countdown(room);
    if (room.phase === 'Intermission') {
      if (shown === key) {
        const next = root.querySelector('[data-next]');
        if (next) next.textContent = `Next round in ${secs(room.remainingMs)} s`;
        return;
      }
      shown = key;
      return results(room);
    }
    if (room.phase === 'Lobby') {
      if (shown !== key) {
        shown = key;
        lobby(room);
      }
      return;
    }
    // Running and Finalising: the tiles are the screen (the per-tile HUD is R07's).
    shown = key;
    root.replaceChildren();
  };
}
