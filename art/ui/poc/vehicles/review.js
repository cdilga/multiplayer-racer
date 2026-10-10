// The vehicle review template (R126, P1-D03b): renders one roster vehicle's complete page from <id>/review.json, which
// tools/vehicles/review/build.mjs generates from the roster data. The seven Vehicles-contract items, in order; the check
// (tools/vehicles/review/check.mjs) fails CI if any is missing for any roster vehicle.
import { loadTokens } from '../shared/tokens.js';
import { VehicleViewer, viewerControls } from './viewer.js';
import { chip, esc } from './status.js';

await loadTokens();
const id = new URLSearchParams(location.search).get('v') ?? '';
const main = document.getElementById('main');
const base = new URL(`./${encodeURIComponent(id)}/`, location.href);
const fetchReview = async (v) => { const r = await fetch(new URL(`./${encodeURIComponent(v)}/review.json`, location.href)); if (!r.ok) throw new Error(`${v}: no review page data (${r.status})`); return r.json(); };
let r;
try { r = await fetchReview(id); } catch (e) { main.innerHTML = `<p class="how"><b>${esc(e.message)}</b> Every roster vehicle gets a page from <a href="./">the Vehicles list</a>.</p>`; throw e; }
document.title = `${r.name}: vehicle review`;
document.getElementById('name').textContent = r.name;
document.getElementById('meta').innerHTML = `${chip(r.status)}<span>${esc(r.date)}</span>${r.beads.map((b) => `<span class="chip">${esc(b)}</span>`).join('')}`;
document.getElementById('summary').textContent = r.summary;

const m = (p) => new URL(p, base).href;
const img = (p, cap, alt) => `<figure><a href="${m(p)}"><img src="${m(p)}" alt="${esc(alt ?? cap)}"></a><figcaption>${cap}</figcaption></figure>`;
const f2 = (x) => (typeof x === 'number' ? x.toFixed(3) : '–');
const sect = (n, title, why, body) => `<section id="item-${n}"><h2><span class="n">${n}</span> ${title}</h2><p class="why">${why}</p>${body}</section>`;

const reference = r.reference.compare.map((c) => `
  <h3>${esc(c.label)}</h3>
  <div class="meta"><span class="big">${f2(c.weightedIou)}</span><span>weighted silhouette IoU</span></div>
  <div class="scroll"><table><thead><tr><th>View</th><th>Side</th><th>Top</th><th>Front</th><th>Rear</th></tr></thead><tbody>
    <tr><th>IoU</th>${['side', 'top', 'front', 'rear'].map((v) => `<td class="num">${f2(c.iou[v])}</td>`).join('')}</tr></tbody></table></div>
  ${img(c.sheet, 'Reference, the model from the same view, and the silhouette diff, per view.', `${r.name} ${c.label}: reference, model and silhouette diff`)}`).join('');

const lods = r.turntable.lods.map((l) => `<tr><th>LOD${l.lod}</th><td class="num">${l.tris} of ${l.maxTris}</td><td><div class="bar" role="img" aria-label="${l.tris} of ${l.maxTris} triangles"><i class="${l.withinBudget ? '' : 'over'}" style="width:${Math.min(100, (l.tris / l.maxTris) * 100)}%"></i></div></td><td class="num">${l.draws}</td><td>${l.withinBudget ? chip('pass').replace('Pass', 'within budget') : '<span class="chip fail">over budget</span>'}</td></tr>`).join('');

const hinge = (p) => (p.hinge ? `${p.hinge.min} to ${p.hinge.max} degrees about ${p.hinge.axis.join(',')}` : 'fixed (the shell)');
const parts = r.damage.parts.map((p) => `<tr><th>${esc(p.name)}</th><td>${esc(hinge(p))}</td></tr>`).join('');
const interiors = Object.entries(r.damage.interiors).map(([k, by]) => `<li><b>${esc(k)}</b> shows when ${esc(by.join(', '))} is loose or detached</li>`).join('');

const h = r.handling, num = (x, d = 2) => (typeof x === 'number' ? +x.toFixed(d) : x);
const handlingRows = h ? [
  ['Mass', `${h.massKg} kg, ${h.drive.toLowerCase()} drive`],
  ['Acceleration', `up to ${h.accel.value} m/s&sup2; at launch <small>(${esc(h.accel.note)})</small>`],
  ['Top speed', h.topSpeed.value != null ? `${h.topSpeed.value} m/s <small>${esc(h.topSpeed.note)}</small>` : `<i>${esc(h.topSpeed.note)}</i>`],
  ['Cornering', `max steer ${num(h.cornering.maxSteerRad)} rad, easing off from ${h.cornering.steerFalloffMps} m/s; tyre grip ${h.cornering.frictionSlip}, drift rear grip ${h.cornering.driftRearGrip}, roll ${h.cornering.rollInfluence}`],
  ['Braking', `${h.braking.maxBrakeForceN} N`],
  ['Boost', `+${Math.round(h.boost.engineGain * 100)}% engine force, drains ${h.boost.drainPerS}/s, recharges ${h.boost.rechargePerS}/s`],
].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('') : '';

main.innerHTML = `
  <div class="how"><b>Feedback:</b> ${esc(r.feedback)} Look at the numbered items below in order; the viewer in item 2 also drives items 3 and 4.</div>
  ${sect(1, 'Reference against model', 'The owner\'s reference sheet beside the model rendered from the same views, with the silhouette diff and IoU per view (the lowpoly-model-from-refs compose output). ' + esc(r.reference.note), reference + `<p><a class="btn" href="${m(r.reference.sheet)}">The reference sheet itself</a></p>`)}
  ${sect(2, 'Turntable at every LOD', 'The real baked GLBs: drag to turn, pinch or scroll to zoom. Triangles and draw calls are counted from the files against the contract budgets.',
    `<div class="stage" id="stage"><div class="msg" id="msg">Loading the model…</div></div><div id="controls"></div>
     <div class="scroll"><table><thead><tr><th>LOD</th><th>Triangles of budget</th><th></th><th>Draw calls</th><th></th></tr></thead><tbody>${lods}</tbody></table></div>
     ${img(r.turntable.sheet, 'The LOD ladder, side and three-quarter (captured from the bake).', `${r.name} at each LOD`)}`)}
  ${sect(3, 'Damage states', 'Intact, loose (swung about its hinge) and detached (lying where it fell, and it stays as debris). Set them per part group in the viewer above, or see the captured strip from the real host renderer.',
    `${img(r.damage.strip, esc(r.damage.note), `${r.name} damage states`)}${img(r.damage.overview, 'The same row from the overview camera.', `${r.name} damage row from the overview camera`)}
     <div class="scroll"><table><thead><tr><th>Part</th><th>Loose range</th></tr></thead><tbody>${parts}</tbody></table></div><ul class="findings">${interiors}</ul>`)}
  ${sect(4, 'Paints and identity', 'The same car in each seat colour (the paint key: pure-white atlas texels take the colour). Try them in the viewer above.',
    `${img(r.paints.sheet, 'The default paint and five seat colours (captured from the bake).', `${r.name} in the seat colours`)}
     <ul class="swatchlist">${r.paints.colours.map((c, i) => `<li><i style="background:${c.hex}"></i>${i + 1} ${esc(c.name)}</li>`).join('')}</ul><p>${esc(r.paints.pattern)}</p>`)}
  ${sect(5, 'In the world, in the comic look', 'The car in its grid tile at the sizes it is really seen, and from the Derby overview camera.',
    `<div class="grid2">${r.inWorld.map((w) => img(w.image, esc(w.label), `${r.name}: ${w.label}`)).join('')}</div>`)}
  ${sect(6, 'Validation gate and handling', 'The vehicle-model-validation gate result with its findings, and the handling profile the sim reads.',
    `<div class="meta"><span class="chip ${esc((r.gate.result ?? 'fail').toLowerCase())}">Gate: ${esc(r.gate.result ?? 'no result')}</span><a href="${m(r.gate.report)}">Full report</a></div>
     <ul class="findings">${r.gate.findings.map((x) => `<li><b>${esc(x.result)}</b> ${esc(x.text)}</li>`).join('')}</ul>
     <h3>Handling</h3><div class="scroll"><table><tbody>${handlingRows}</tbody></table></div>
     <p><small>From <code>${esc(h?.source ?? '')}</code> (the sim's own profile), not a measured lap. R123: handling is measured per car, not guessed.</small></p>`)}
  <section id="item-7"><h2><span class="n">7</span> Spec twin</h2><div id="twin"></div></section>`;

(async () => {
  const twin = document.getElementById('twin');
  if (!r.specTwin) { twin.innerHTML = '<p class="why">Not a spec twin. R123\'s Hawk Dash and Lion President share one spec and handling with different bodies; their pages show both cars side by side with the shared spec here.</p>'; return; }
  const t = await fetchReview(r.specTwin.id);
  const col = (x) => `<div><h3><a href="./review.html?v=${encodeURIComponent(x.id)}">${esc(x.name)}</a></h3>${img(x.inWorld[0].image.startsWith('media') ? `../${x.id}/${x.inWorld[0].image}` : x.inWorld[0].image, esc(x.inWorld[0].label), x.name)}<p>${chip(x.status)} Gate: ${esc(x.gate.result)}</p></div>`;
  twin.innerHTML = `<p class="why"><b>Shared spec:</b> ${esc(r.specTwin.sharedSpec)}</p><div class="grid2">${col(r)}${col(t)}</div>`;
})();

const stage = document.getElementById('stage'), msg = document.getElementById('msg');
try {
  const viewer = new VehicleViewer(stage);
  viewer.resize();
  await viewer.load(r, base);
  document.getElementById('controls').append(viewerControls(viewer, r));
  msg.hidden = true;
} catch (e) { msg.textContent = `Could not load the model: ${e.message}`; }
