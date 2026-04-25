import { store } from '../state/store';
import { escapeHtml } from '../utils/escape';

/**
 * Players list — Foundry-style floating roster docked at the bottom-right
 * of the canvas. Renders connected players with a colored dot, name, and
 * role badge ("GM" / "PL"). The current user is subtly highlighted.
 *
 * No socket layer yet — this just reflects `store.players`. Once RTC is
 * promoted out of demo gating, this is where presence dots will live.
 */

export function renderPlayersList(mount: HTMLElement): void {
  function render(): void {
    const s = store.getState();
    const me = s.currentUserId;
    if (!s.players.length) {
      mount.innerHTML = '';
      return;
    }
    mount.innerHTML = `
      <div class="pl-header">Players</div>
      ${s.players.map((p) => `
        <div class="pl-row${p.id === me ? ' self' : ''}${p.role === 'gm' ? ' gm' : ''}"
             title="${escapeHtml(p.name)}${p.id === me ? ' (you)' : ''}">
          <span class="pl-dot" style="background:${escapeHtml(p.color)};color:${escapeHtml(p.color)}" aria-hidden="true"></span>
          <span class="pl-name">${escapeHtml(p.name)}${p.id === me ? ' <span class="pl-role">you</span>' : ''}</span>
          <span class="pl-role">${p.role === 'gm' ? 'GM' : 'PL'}</span>
        </div>
      `).join('')}
    `;
  }

  render();
  store.subscribe((s, prev) => {
    if (s.players !== prev.players || s.currentUserId !== prev.currentUserId) render();
  });
}
