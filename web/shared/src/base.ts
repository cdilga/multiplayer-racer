// The deployment base path B (plan §5.1): `/` in production, `/p/<id>/` in a preview. One build serves every base
// (Vite's relative base), so the pages learn B from the `<meta name="jj-base">` the server writes into them
// (crates/jj-server/src/statics.rs). Without it (a dev server), B is where Vite's base resolves from this page.

/** The base path, starting and ending with `/`. */
export function basePath(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="jj-base"]')?.content;
  const raw = meta ?? new URL(import.meta.env.BASE_URL, location.href).pathname;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/** An absolute path under the base: `apiPath('api/v1/rooms')` → `/p/x/api/v1/rooms`. */
export function underBase(rel: string): string {
  return basePath() + rel.replace(/^\/+/, '');
}
