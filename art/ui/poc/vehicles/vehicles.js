// Vehicles index: one card per roster vehicle (roster.json is generated from art/vehicles/*), and one viewer whose
// toggles (LOD, damage states, seat paints) apply to whichever vehicle is selected. No vehicle is named in this file.
import { loadTokens } from '../shared/tokens.js';
import { VehicleViewer, viewerControls } from './viewer.js';
import { chip, esc } from './status.js';

await loadTokens();
const roster = await (await fetch('./roster.json')).json();
const cards = document.getElementById('cards'), stage = document.getElementById('stage'), msg = document.getElementById('msg');
let viewer = null, controls = null;

cards.innerHTML = roster.vehicles.map((v) => `
  <article class="card" data-id="${esc(v.id)}">
    <h3>${esc(v.name)}</h3>
    <div class="meta">${chip(v.status)}${v.date ? `<span>${esc(v.date)}</span>` : ''}${(v.beads ?? []).map((b) => `<span class="chip">${esc(b)}</span>`).join('')}</div>
    <p style="margin:0">${esc(v.summary ?? (v.missing ? `Missing: ${v.missing.join(', ')}` : ''))}</p>
    <div class="row">${v.missing ? '' : `<button type="button" class="btn primary" data-view="${esc(v.id)}" style="font:inherit;cursor:pointer;border-radius:10px">Turn it here</button><a class="btn" href="./review.html?v=${encodeURIComponent(v.id)}">Full review page</a>`}</div>
  </article>`).join('');

async function show(id) {
  const base = new URL(`./${id}/`, location.href);
  const review = await (await fetch(new URL('review.json', base))).json();
  msg.hidden = false; msg.textContent = 'Loading the model…';
  viewer ??= new VehicleViewer(stage);
  viewer.resize();
  await viewer.load(review, base);
  controls?.remove(); controls = viewerControls(viewer, review);
  document.getElementById('controls').append(controls);
  document.getElementById('current').textContent = `${review.name}: ${review.turntable.lods.length} LODs, ${review.damage.parts.length} parts. LOD, damage and paint apply to this vehicle only.`;
  for (const c of cards.children) c.classList.toggle('on', c.dataset.id === id);
  msg.hidden = true; history.replaceState(null, '', `#${id}`);
}
cards.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) show(b.dataset.view).catch(fail); });
const fail = (e) => { msg.hidden = false; msg.textContent = `Could not load the model: ${e.message}`; };
const first = roster.vehicles.find((v) => v.id === location.hash.slice(1) && !v.missing) ?? roster.vehicles.find((v) => !v.missing);
if (first) show(first.id).catch(fail); else msg.textContent = 'No roster vehicle has review data yet.';
