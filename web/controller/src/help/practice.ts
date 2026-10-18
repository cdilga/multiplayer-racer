// The practice scene on the phone (P1-C10, master §4.3). While a round runs, a newcomer can practise on their own small
// course (their tile on the TV shows it, with the C06 prompts) before joining, from the join screen ("Practise first") or
// from Help. While practising the phone keeps its sticks and shows one bar: what this is, and Join the race, which enters
// the running round at the tail like any late joiner (R63). It is never a queue or a step anyone has to take: Join the race
// stays the big button on the join screen, and practice ends by itself when the next round's countdown starts.
import type { Session } from '../app/session';
import './practice.css';

/** Practice is offered while a round is racing (the host refuses it in the Lobby and the countdown). */
export const practiceOffered = (session: Session): boolean => session.roomPhase === 'Racing' && !session.practising;

/** The join card's offer while a round runs: a line and a second button under Join the race. */
export function practiceOfferHtml(session: Session): string {
  if (session.roomPhase !== 'Racing' || session.removed) return '';
  return `<div class="practice-offer" data-box="practice-offer"><p>A race is on. Join it at the back now, or practise first on your own course.</p><button type="button" class="btn brush" data-act="practise-first">Practise first</button></div>`;
}

/** The play screen's practice bar while this seat practises (added, kept or removed on every HUD update). */
export function practiceBar(app: HTMLElement, session: Session): void {
  const screen = app.querySelector<HTMLElement>('.screen.play');
  let bar = app.querySelector<HTMLElement>('[data-practice-bar]');
  if (!screen || !session.practising) {
    bar?.remove();
    screen?.classList.remove('practising');
    return;
  }
  screen.classList.add('practising');
  if (bar) return;
  bar = document.createElement('div');
  bar.className = 'panel practice-bar';
  bar.dataset.practiceBar = '';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `<div class="practice-copy"><span class="tag"><span>Practice</span></span><span class="practice-line">Your own course on your TV tile. The race goes on.</span></div><button class="btn primary" type="button" data-act="join-race">Join the race</button>`;
  bar.querySelector('[data-act=join-race]')!.addEventListener('click', () => session.practice(false));
  screen.append(bar);
}
