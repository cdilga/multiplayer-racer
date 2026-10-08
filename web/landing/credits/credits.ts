// The Credits and licences page (P1-C09). The prose is in index.html; the third-party list is generated from the lockfiles
// (`tools/licences/generate.mjs` writes licences.json, the CI check keeps it current) and bundled here, so the page makes
// no request of its own beyond its assets (R70).
import { applyProfile } from '../../shared/ui';
import { basePath } from '../../shared/src/base';
import '../src/landing.css';
import './credits.css';
import licences from './licences.json';
import ofl from '../../../art/ui/fonts/OFL.txt?raw';
import { REFERENCES } from './sources';

applyProfile();

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`credits: ${sel} missing`);
  return el;
};

$<HTMLAnchorElement>('#back').href = basePath();
$('#ofl').textContent = ofl;

$('#refs').innerHTML = REFERENCES.map(
  (r) => `<li><a href="${esc(r.url)}" rel="noopener">${esc(r.title)}</a> by ${esc(r.author)}, <a href="${esc(r.licenceUrl)}" rel="noopener">${esc(r.licence)}</a></li>`,
).join('');

type Row = { name: string; version: string; licence: string | null };
const rows = (list: Row[], home: string) =>
  list.map((e) => `<tr><th scope="row"><a href="${home}${esc(e.name)}" rel="noopener">${esc(e.name)}</a></th><td>${esc(e.version)}</td><td>${esc(e.licence ?? 'see the package')}</td></tr>`).join('');
$('#lic-web tbody').innerHTML = rows(licences.web as Row[], 'https://www.npmjs.com/package/');
$('#lic-rust tbody').innerHTML = rows(licences.rust as Row[], 'https://crates.io/crates/');
$('#lic-summary').insertAdjacentHTML('beforeend', ` <b>${licences.web.length}</b> browser packages and <b>${licences.rust.length}</b> Rust crates.`);

(window as unknown as { __jjCredits: unknown }).__jjCredits = { web: licences.web.length, rust: licences.rust.length };
document.documentElement.dataset.jjCredits = 'ready';
