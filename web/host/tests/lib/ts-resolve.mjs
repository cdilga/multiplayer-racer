// Lets a node test import the host's TypeScript sources, which import each other without extensions (the bundler's
// resolution): relative specifiers that name no file get `.ts` (or `/index.ts`). Test-only; import it first.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      const base = new URL(specifier, context.parentURL);
      for (const tail of ['.ts', '/index.ts']) {
        const u = new URL(base.href + tail);
        if (existsSync(fileURLToPath(u))) return next(u.href, context);
      }
    }
    return next(specifier, context);
  },
});
