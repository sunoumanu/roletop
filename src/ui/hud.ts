import { roll, isError } from '../engine/dice';
import { pushRoll } from '../features/chat';
import { toast } from './toast';

/**
 * Floating HUD — dice tray and measure readout.
 *
 * The buttons here just call `roll('1dX')` and `pushRoll` so the output
 * renders as a chat roll-card. Phase-5 had a <button onclick="rollDie(6)">
 * binding to a global; here it's event delegation, same pattern as the rest.
 */

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;

export function installHud(parent: HTMLElement): void {
  const el = document.createElement('div');
  el.id = 'hud';
  el.innerHTML = `
    <div id="measure-display" class="hud-measure" aria-live="polite"></div>
    <div class="hud-dice" role="toolbar" aria-label="Quick dice">
      ${DICE.map((d) => `
        <button class="dice-btn" data-die="${d}" title="Roll 1d${d}" aria-label="Roll 1d${d}">
          <span class="d-face">d${d === 100 ? '%' : d}</span>
        </button>
      `).join('')}
    </div>
    <div class="hud-hints">
      <kbd>?</kbd> keys · <kbd>Space</kbd> next · <kbd>I</kbd> init
    </div>
  `;
  parent.appendChild(el);

  el.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-die]');
    if (!btn) return;
    const sides = Number(btn.getAttribute('data-die'));
    if (!sides) return;
    const expr = sides === 100 ? '1d100' : `1d${sides}`;
    const r = roll(expr);
    if (isError(r)) { toast(r.error, 'err'); return; }
    pushRoll(r);
  });
}
