// The Retry / Lobby screen after a failed round preparation (P1-M08a): the director has retried once with the conservative
// recipe and given up, so the next round has no track. The room, its players and the results stay as they were; the host
// chooses: Retry draws a fresh track seed and prepares again, Lobby goes back to the Lobby (and clears this screen).
import { paintKit } from '../../../shared/ui';
import './failure.css';

/** What the screen needs of the sim client. */
export interface FailureHost {
  input(input: { type: 'ui'; ui: 'reroll' | 'end' }): void;
}

export interface FailureScreen {
  show(message: string): void;
  hide(): void;
  readonly visible: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function mountFailureScreen(host: FailureHost): FailureScreen {
  // Inside the round screens' root when there is one (its size tokens apply), else a root of its own.
  const parent = document.querySelector<HTMLElement>('.jj-round') ?? document.body;
  const root = document.createElement('div');
  root.className = 'pf-root';
  parent.append(root);
  let on = false;
  const hide = () => {
    on = false;
    root.replaceChildren();
  };
  return {
    get visible() {
      return on;
    },
    hide,
    show(message) {
      on = true;
      root.innerHTML = `<section class="pf" data-screen="prepare-failed" role="alertdialog" aria-labelledby="pf-t">
        <div class="pf-card"><h2 class="pf-title" id="pf-t">No track this time</h2>
          <p class="pf-why">The next round's track couldn't be set up, even with the simple recipe. The room, the players and the results are all still here.</p>
          <p class="pf-detail" data-detail>${esc(message)}</p>
          <div class="pf-acts"><button class="btn brush primary big" data-act="retry" type="button">Retry</button>
            <button class="btn brush" data-act="lobby" type="button">Lobby</button></div></div></section>`;
      paintKit(root);
      root.querySelector('[data-act=retry]')!.addEventListener('click', () => {
        hide();
        host.input({ type: 'ui', ui: 'reroll' });
      });
      root.querySelector('[data-act=lobby]')!.addEventListener('click', () => {
        hide();
        host.input({ type: 'ui', ui: 'end' });
      });
      root.querySelector<HTMLElement>('[data-act=retry]')!.focus();
    },
  };
}
