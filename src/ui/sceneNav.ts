import { store } from '../state/store';
import { escapeHtml } from '../utils/escape';

/**
 * Scene navigation bar — Foundry-style floating "current scene" pill,
 * docked at the bottom-left of the canvas.
 *
 * For now we expose a single active scene with the active turn glued on
 * (so the previous `#initiative-badge` use-case is still served). Future
 * iterations can list multiple scenes here and let the GM hop between them.
 */

export function renderSceneNav(mount: HTMLElement): void {
  function render(): void {
    const s = store.getState();
    const sceneName = deriveSceneName(s.mapImage);
    const turnName = s.initiative.order[s.initiative.current]?.name ?? null;
    mount.innerHTML = `
      <div class="sn-tab active" data-action="roll-init" role="button" tabindex="0"
           title="Click to roll initiative (I)" aria-label="Active scene: ${escapeHtml(sceneName)}">
        <span class="sn-ico" aria-hidden="true">▣</span>
        <span class="sn-name">${escapeHtml(sceneName)}</span>
        ${turnName
          ? `<span class="sn-ico" aria-hidden="true" style="margin-left:6px">›</span>
             <span class="sn-name" id="ib-name">${escapeHtml(turnName)}</span>`
          : `<span class="sn-name" id="ib-name" style="display:none">—</span>`}
      </div>
    `;
  }

  mount.addEventListener('click', async (e) => {
    const target = (e.target as HTMLElement | null)?.closest('[data-action]');
    if (!target) return;
    const { rollInitiative } = await import('../features/initiative');
    rollInitiative();
  });

  render();
  store.subscribe((s, prev) => {
    if (s.mapImage !== prev.mapImage || s.initiative !== prev.initiative) render();
  });
}

function deriveSceneName(mapImage: string | null | undefined): string {
  if (!mapImage) return 'Default Scene';
  // Foundry shows the scene name; we don't track one separately yet, so
  // pull a friendly label from the asset URL (e.g. "Dungeon Stone").
  try {
    const url = new URL(mapImage, window.location.href);
    const last = url.pathname.split('/').pop() ?? '';
    const stem = last.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    if (!stem) return 'Custom Map';
    return stem
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  } catch {
    return 'Custom Map';
  }
}
