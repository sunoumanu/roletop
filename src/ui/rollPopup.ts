import type { RollResult } from '../engine/dice';
import { escapeHtml } from '../utils/escape';

let popupEl: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function installRollPopup(parent: HTMLElement): void {
  const el = document.createElement('div');
  el.id = 'roll-popup';
  el.innerHTML = `
    <div class="rp-expr" id="rp-expr"></div>
    <div class="rp-num" id="rp-num"></div>
    <div class="rp-break" id="rp-break"></div>
    <div class="rp-crit" id="rp-crit" hidden></div>
  `;
  parent.appendChild(el);
  popupEl = el;
}

export function showRollPopup(r: RollResult): void {
  if (!popupEl) return;
  const expr = popupEl.querySelector<HTMLElement>('#rp-expr')!;
  const num = popupEl.querySelector<HTMLElement>('#rp-num')!;
  const brk = popupEl.querySelector<HTMLElement>('#rp-break')!;
  const crit = popupEl.querySelector<HTMLElement>('#rp-crit')!;
  expr.textContent = r.expr + (r.label ? ` · ${r.label}` : '');
  num.textContent = String(r.total);
  num.style.color = r.isCrit ? '#c9983a' : r.isFumble ? '#8b2020' : 'var(--ember)';
  const bd = r.groups.map((g) => `[${g.finalRolls.filter((v) => v !== null).join('+')}]`).join(' ');
  brk.textContent = bd + (r.bonus !== 0 ? (r.bonus > 0 ? ` +${r.bonus}` : ` ${r.bonus}`) : '');
  if (r.isCrit) {
    crit.textContent = '✦ CRITICAL HIT ✦';
    crit.style.color = '';
    crit.hidden = false;
  } else if (r.isFumble) {
    crit.textContent = '✦ CRITICAL MISS ✦';
    crit.style.color = 'var(--blood)';
    crit.hidden = false;
  } else {
    crit.hidden = true;
  }
  popupEl.classList.add('show');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => popupEl?.classList.remove('show'), 2200);
  // Silence unused-import warning — escapeHtml is re-exported elsewhere.
  void escapeHtml;
}
