// The vendored Lucide icons (web/shared/ui/icons, copied from art/ui/icons; ISC), as bundled asset URLs: no CDN, no network at run time (R70).
const urls = import.meta.glob<string>('./icons/*.svg', { eager: true, query: '?url', import: 'default' });

const byName = new Map<string, string>();
for (const [path, url] of Object.entries(urls)) byName.set(path.slice(path.lastIndexOf('/') + 1, -4), url);

/** An icon element tinted by currentColor. Unknown names give an empty (still sized) span rather than throwing. */
export function icon(name: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'ic';
  el.setAttribute('aria-hidden', 'true');
  const url = byName.get(name);
  if (url) el.style.setProperty('--ic', `url("${url}")`);
  return el;
}
