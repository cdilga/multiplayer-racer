// What the controls cards read on the host (P1-C14): the key clusters (clusters.json) and the wheel profiles (wheels.json) as the
// input code itself reads them, plus the host's local-source registry so a seat's tile can name its source. `setControlsData`
// is the test seam: a test swaps the data and the Controls page, the drawer and the prompts follow.
import map from './clusters.json';
import wheels from './wheels.json';
import type { ControlsData, ControlsSource } from '../../../shared/ui';
import type { LocalInput, LocalSourceView } from './local';

let data: ControlsData = {
  clusters: map.clusters as ControlsData['clusters'],
  wheels: (wheels.profiles as Array<{ label: string; buttons: Record<string, number> }>).map((p) => ({ label: p.label, buttons: p.buttons })),
};
export const controlsData = (): ControlsData => data;
export const setControlsData = (d: ControlsData): void => {
  data = d;
};

let input: LocalInput | null = null;
export const attachLocalInput = (i: LocalInput): void => {
  input = i;
};
export const localView = (source: number | null | undefined): LocalSourceView | undefined =>
  source === null || source === undefined ? undefined : input?.list().find((s) => s.source === source);

/** The controls source behind a host-local source id (a pad, a wheel or a key cluster); undefined for anything else. */
export function sourceOf(source: number | null | undefined): ControlsSource | undefined {
  const v = localView(source);
  if (!v) return undefined;
  if (v.kind === 'keys') return { kind: 'keys', cluster: v.source };
  if (v.kind === 'wheel') return { kind: 'wheel', profile: v.wheel?.profile };
  return { kind: 'pad' };
}
