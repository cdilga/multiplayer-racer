// The sign kit's registry side (P1-M09): every assets/kit/signs/data/<name>.json becomes a code-built kit module under
// its id, so a new sign is a new data file plus its registry entry, never new geometry.
import type { KitModule } from '../kit/types';
import { signModule, type SignDef } from './sign-kit';

const files = import.meta.glob<SignDef>('../../../../../assets/kit/signs/data/*.json', { eager: true, import: 'default' });

export const SIGNS: Record<string, SignDef> = Object.fromEntries(Object.values(files).map((d) => [d.id, d]));
export const SIGN_MODULES: Record<string, KitModule> = Object.fromEntries(Object.values(SIGNS).map((d) => [d.id, signModule(d)]));
