import { escapeHtml } from '../utils/escape';
import { HOTKEYS } from './hotkeys';
import { trap, type FocusTrap } from './focusTrap';

/**
 * Hotkey cheatsheet overlay. Purely presentational — reads the HOTKEYS
 * registry so the list stays in sync with what `hotkeys.ts` actually wires up.
 */

let overlayEl: HTMLDivElement | null = null;
let activeTrap: FocusTrap | null = null;

export function installHotkeyOverlay(parent: HTMLElement): void {
  const el = document.createElement('div');
  el.id = 'hotkey-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Keyboard shortcuts');
  el.hidden = true;
  parent.appendChild(el);
  overlayEl = el;

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === el || target.closest('[data-action="close-hotkeys"]')) {
      closeHotkeyOverlay();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl && !overlayEl.hidden) {
      closeHotkeyOverlay();
    }
  });
}

export function openHotkeyOverlay(): void {
  if (!overlayEl) return;
  overlayEl.innerHTML = renderOverlay();
  overlayEl.hidden = false;
  overlayEl.classList.add('visible');
  const closeBtn = overlayEl.querySelector<HTMLElement>('[data-action="close-hotkeys"]');
  activeTrap = trap(overlayEl, closeBtn);
}

export function closeHotkeyOverlay(): void {
  if (!overlayEl) return;
  overlayEl.hidden = true;
  overlayEl.classList.remove('visible');
  if (activeTrap) {
    activeTrap.release();
    activeTrap = null;
  }
}

function renderOverlay(): string {
  const groups = new Map<string, typeof HOTKEYS>();
  for (const hk of HOTKEYS) {
    const arr = groups.get(hk.group) ?? [];
    arr.push(hk);
    groups.set(hk.group, arr);
  }
  const sections = Array.from(groups.entries()).map(([group, keys]) => `
    <section class="hk-section">
      <h3>${escapeHtml(group)}</h3>
      <dl>
        ${keys.map((k) => `
          <div class="hk-row">
            <dt><kbd>${escapeHtml(k.label)}</kbd></dt>
            <dd>${escapeHtml(k.description)}</dd>
          </div>
        `).join('')}
      </dl>
    </section>
  `).join('');
  return `
    <div class="hk-panel" role="document">
      <header class="hk-header">
        <h2>Keyboard Shortcuts</h2>
        <button class="sm-btn" data-action="close-hotkeys" aria-label="Close">✕</button>
      </header>
      <div class="hk-body">${sections}</div>
      <footer class="hk-footer">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</footer>
    </div>
  `;
}
