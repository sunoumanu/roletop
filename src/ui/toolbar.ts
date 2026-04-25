import { store } from '../state/store';
import { exportJson, importJsonFromFile, applyScene } from '../state/persistence';
import { canEditWalls, canSpawnTokens, canToggleFog } from '../features/roles';
import { rollInitiative } from '../features/initiative';
import { toast } from './toast';
import { openHotkeyOverlay } from './hotkeyOverlay';
import { spawnRandomToken } from '../features/spawn';
import { pickImageFile, loadMapImage } from '../features/assetUpload';
import { isGM } from '../features/roles';

/**
 * Tool rail — vertical, Foundry-style. Icon-only buttons; tooltips carry the
 * label. No inline onclick, no global functions. Event handlers live here
 * and talk to the store/features directly.
 */
export function renderToolbar(mount: HTMLElement): void {
  // #14 iconography + #4 hotkey-annotated titles. Glyphs live as
  // `aria-hidden` spans alongside the (visually-hidden) label so screen
  // readers still read "Select" etc. (#9) — GM-only buttons stay in the
  // DOM but are rendered as disabled with a lock glyph when role=player.
  mount.innerHTML = `
    <div class="tr-logo" aria-hidden="true">⚔</div>
    <button class="tb-btn sb-toggle" data-action="toggle-sidebar-left" aria-label="Toggle scene panel" title="Toggle scene panel"><span class="tb-ico" aria-hidden="true">☰</span><span>Scene panel</span></button>
    <div class="tb-sep"></div>
    <button class="tb-btn" data-action="tool-select" title="Select (S)"><span class="tb-ico" aria-hidden="true">↖</span><span>Select</span></button>
    <button class="tb-btn" data-action="tool-measure" title="Measure (M)"><span class="tb-ico" aria-hidden="true">📏</span><span>Measure</span></button>
    <button class="tb-btn" data-action="tool-aoe" title="AoE template (T)"><span class="tb-ico" aria-hidden="true">🎯</span><span>Template</span></button>
    <button class="tb-btn" data-action="tool-wall" data-gm-only title="Walls (W) — GM only"><span class="tb-ico" aria-hidden="true">🧱</span><span>Walls</span></button>
    <button class="tb-btn" data-action="tool-fogbrush" data-gm-only title="Paint manual fog (Shift+F) — GM only"><span class="tb-ico" aria-hidden="true">🌫</span><span>Fog</span></button>
    <div class="tb-sep"></div>
    <button class="tb-btn" data-action="add-token" data-gm-only title="Spawn random token (N) — GM only"><span class="tb-ico" aria-hidden="true">＋</span><span>Add token</span></button>
    <button class="tb-btn" data-action="toggle-fog" data-gm-only title="Toggle vision / fog (V) — GM only"><span class="tb-ico" aria-hidden="true">👁</span><span>Vision</span></button>
    <button class="tb-btn" data-action="toggle-grid" title="Toggle grid (G)"><span class="tb-ico" aria-hidden="true">⊞</span><span>Grid</span></button>
    <div class="tb-sep"></div>
    <button class="tb-btn" data-action="undo" title="Undo (Ctrl+Z)"><span class="tb-ico" aria-hidden="true">↶</span><span>Undo</span></button>
    <button class="tb-btn" data-action="redo" title="Redo (Ctrl+Shift+Z / Ctrl+Y)"><span class="tb-ico" aria-hidden="true">↷</span><span>Redo</span></button>
    <div class="tb-sep"></div>
    <button class="tb-btn" data-action="load-map" data-gm-only title="Upload a battle-map image — GM only"><span class="tb-ico" aria-hidden="true">🖼</span><span>Upload map</span></button>
    <button class="tb-btn" data-action="clear-map" data-gm-only title="Clear uploaded map image — GM only"><span class="tb-ico" aria-hidden="true">🧹</span><span>Clear map</span></button>
    <button class="tb-btn" data-action="export" title="Export scene to JSON"><span class="tb-ico" aria-hidden="true">⇧</span><span>Export</span></button>
    <label class="tb-btn" data-action="import-label" title="Import a scene JSON file" style="cursor:pointer">
      <span class="tb-ico" aria-hidden="true">⇩</span><span>Import</span>
      <input type="file" accept="application/json" data-action="import" hidden />
    </label>
    <div class="tb-spacer"></div>
    <button class="tb-btn" data-action="show-hotkeys" title="Hotkeys (?)"><span class="tb-ico" aria-hidden="true">⌨</span><span>Hotkeys</span></button>
    <div class="tb-sep"></div>
    <div class="tr-badge" id="tr-role-badge" title="Your role for this session">GM</div>
    <button class="tb-btn tb-signout" data-action="sign-out" title="Sign out — return to login"><span class="tb-ico" aria-hidden="true">⏻</span><span>Sign out</span></button>
  `;

  mount.addEventListener('click', async (e) => {
    const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!target) return;
    // #9 — GM-only buttons stay in the DOM for Player view but are disabled.
    // Block clicks and explain rather than silently no-op.
    if (target.hasAttribute('aria-disabled') && target.getAttribute('aria-disabled') === 'true') {
      e.preventDefault();
      toast('GM only', 'warn');
      return;
    }
    const action = target.getAttribute('data-action');
    const s = store.getState();
    switch (action) {
      case 'tool-select': s.setTool('select'); break;
      case 'tool-measure': s.setTool('measure'); break;
      case 'tool-wall':
        if (!canEditWalls()) { toast('Walls are a GM-only tool', 'warn'); return; }
        s.setTool('wall');
        break;
      case 'tool-aoe': s.setTool('aoe'); break;
      case 'tool-fogbrush':
        if (!canToggleFog()) { toast('Fog brush is GM-only', 'warn'); return; }
        s.setTool('fogbrush');
        break;
      case 'add-token':
        if (!canSpawnTokens()) { toast('Only GMs can spawn tokens', 'warn'); return; }
        spawnRandomToken();
        break;
      case 'load-map': {
        if (!isGM()) { toast('Only the GM can set the map', 'warn'); return; }
        const file = await pickImageFile();
        if (file) await loadMapImage(file);
        break;
      }
      case 'clear-map': {
        if (!isGM()) { toast('Only the GM can clear the map', 'warn'); return; }
        if (!s.mapImage) { toast('No custom map to clear', 'warn'); return; }
        s.setMapImage(null);
        toast('Map cleared', 'ok');
        break;
      }
      case 'toggle-fog':
        if (!canToggleFog()) { toast('Vision toggle is GM-only', 'warn'); return; }
        s.setFog(!s.fogEnabled);
        toast(s.fogEnabled ? '🌫 Vision enabled' : '☀ Vision off', s.fogEnabled ? 'ok' : 'warn');
        break;
      case 'toggle-grid': s.toggleLayer('grid'); break;
      case 'roll-init': rollInitiative(); break;
      case 'show-hotkeys': openHotkeyOverlay(); break;
      case 'undo': {
        const { undo } = await import('../state/history');
        const label = undo();
        toast(label ? `Undo: ${label}` : 'Nothing to undo', label ? 'ok' : 'warn');
        break;
      }
      case 'redo': {
        const { redo } = await import('../state/history');
        const label = redo();
        toast(label ? `Redo: ${label}` : 'Nothing to redo', label ? 'ok' : 'warn');
        break;
      }
      case 'export':
        exportJson();
        toast('Scene exported', 'ok');
        break;
      case 'toggle-sidebar-left':
        toggleSidebar('left');
        break;
      case 'toggle-sidebar-right':
        toggleSidebar('right');
        break;
      case 'toggle-more':
        toggleMoreMenu(mount);
        break;
      case 'sign-out': {
        const { logout } = await import('../features/auth');
        logout();
        toast('Signed out', 'ok');
        // Reload so the login overlay re-mounts cleanly. SessionStorage is
        // already cleared by `logout()`.
        setTimeout(() => window.location.reload(), 250);
        break;
      }
    }
  });

  const importInput = mount.querySelector<HTMLInputElement>('input[data-action="import"]')!;
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const scene = await importJsonFromFile(file);
      applyScene(scene);
      toast('Scene imported', 'ok');
    } catch (err) {
      toast(`Invalid scene: ${(err as Error).message}`, 'err');
    } finally {
      importInput.value = '';
    }
  });

  // Close slide-in drawers when the user taps outside on narrow layouts.
  document.addEventListener('click', (e) => {
    const root = document.documentElement;
    const anyOpen = root.hasAttribute('data-sidebar-left') || root.hasAttribute('data-sidebar-right');
    if (!anyOpen) return;
    const target = e.target as HTMLElement;
    if (target.closest('#sidebar-left, #sidebar-right, .sb-toggle')) return;
    root.removeAttribute('data-sidebar-left');
    root.removeAttribute('data-sidebar-right');
    const app = document.getElementById('app');
    app?.classList.remove('has-backdrop');
  });

  // Initial visibility pass + subscribe for role changes outside the toolbar.
  refreshGmOnlyVisibility(mount);
  refreshRoleBadge(mount);
  store.subscribe((s, prev) => {
    if (s.role !== prev.role) {
      refreshGmOnlyVisibility(mount);
      refreshRoleBadge(mount);
    }
    if (s.currentTool !== prev.currentTool) refreshActiveTool(mount);
    if (s.layers.grid !== prev.layers.grid) refreshGridActive(mount);
    if (s.fogEnabled !== prev.fogEnabled) refreshFogActive(mount);
  });
  refreshActiveTool(mount);
  refreshGridActive(mount);
  refreshFogActive(mount);

  // #22 — responsive overflow menu. On narrow screens, ask CSS to hide
  // `.tb-overflowable` buttons, then mirror them into a "More ⋯" dropdown.
  const onResize = () => syncMoreMenu(mount);
  window.addEventListener('resize', onResize);
  syncMoreMenu(mount);

  // Close the More menu when clicking outside it.
  document.addEventListener('click', (e) => {
    const menu = mount.querySelector<HTMLElement>('#tb-more-menu');
    if (!menu || menu.hidden) return;
    const target = e.target as HTMLElement;
    if (target.closest('#tb-more-wrap')) return;
    closeMoreMenu(mount);
  });
}

function refreshGmOnlyVisibility(mount: HTMLElement): void {
  // #9 — in Player view keep GM-only buttons visible but disabled, with a
  // lock glyph + "GM only" title, so switching roles no longer silently
  // reshapes the toolbar.
  const isGm = store.getState().role === 'gm';
  for (const el of mount.querySelectorAll<HTMLElement>('[data-gm-only]')) {
    if (isGm) {
      el.removeAttribute('aria-disabled');
      el.classList.remove('is-locked');
      // Restore the pre-lock title if we stashed one.
      const saved = el.getAttribute('data-title-base');
      if (saved !== null) {
        el.setAttribute('title', saved);
        el.removeAttribute('data-title-base');
      }
      const lock = el.querySelector('.tb-lock');
      if (lock) lock.remove();
      // Re-enable the underlying <button>/<label> control.
      if (el instanceof HTMLButtonElement) el.disabled = false;
      el.style.display = '';
      el.tabIndex = 0;
    } else {
      el.setAttribute('aria-disabled', 'true');
      el.classList.add('is-locked');
      // Stash the base title so we can restore it when the GM toggles back.
      if (!el.hasAttribute('data-title-base')) {
        el.setAttribute('data-title-base', el.getAttribute('title') ?? '');
      }
      el.setAttribute('title', 'GM only');
      if (!el.querySelector('.tb-lock')) {
        const lock = document.createElement('span');
        lock.className = 'tb-lock';
        lock.setAttribute('aria-hidden', 'true');
        lock.textContent = '🔒';
        el.appendChild(lock);
      }
      if (el instanceof HTMLButtonElement) el.disabled = false; // we handle clicks manually
      el.style.display = '';
      el.tabIndex = -1;
    }
  }
  syncMoreMenu(mount);
}

function refreshActiveTool(mount: HTMLElement): void {
  const tool = store.getState().currentTool;
  const map: Record<string, string> = {
    select: 'tool-select',
    measure: 'tool-measure',
    wall: 'tool-wall',
    aoe: 'tool-aoe',
    fogbrush: 'tool-fogbrush'
  };
  for (const el of mount.querySelectorAll<HTMLElement>('[data-action^="tool-"]')) {
    el.classList.toggle('active', el.getAttribute('data-action') === map[tool]);
    el.classList.toggle('wall-active', tool === 'wall' && el.getAttribute('data-action') === 'tool-wall');
  }
}

function refreshGridActive(mount: HTMLElement): void {
  const el = mount.querySelector<HTMLElement>('[data-action="toggle-grid"]');
  if (el) el.classList.toggle('active', store.getState().layers.grid);
}
function refreshFogActive(mount: HTMLElement): void {
  const el = mount.querySelector<HTMLElement>('[data-action="toggle-fog"]');
  if (el) el.classList.toggle('active', store.getState().fogEnabled);
}
function refreshRoleBadge(mount: HTMLElement): void {
  const el = mount.querySelector<HTMLElement>('#tr-role-badge');
  if (!el) return;
  const role = store.getState().role;
  el.textContent = role === 'gm' ? 'GM' : 'PL';
  el.classList.toggle('is-gm', role === 'gm');
  el.classList.toggle('is-player', role === 'player');
}

/**
 * #22 — mirror overflowable toolbar buttons into a dropdown when the
 * viewport is narrow enough that CSS has hidden them from the primary row.
 * We copy the label/title/icon across so the dropdown mirrors the primary
 * toolbar's hotkey hints.
 */
function syncMoreMenu(mount: HTMLElement): void {
  const wrap = mount.querySelector<HTMLElement>('#tb-more-wrap');
  const menu = mount.querySelector<HTMLElement>('#tb-more-menu');
  if (!wrap || !menu) return;
  const overflowable = Array.from(
    mount.querySelectorAll<HTMLElement>('.tb-overflowable')
  );
  // CSS decides whether each one is hidden in the primary row; the menu
  // mirrors exactly the ones currently suppressed. getComputedStyle is
  // cheap here and avoids guessing the breakpoint in JS.
  const hidden = overflowable.filter((el) => getComputedStyle(el).display === 'none');
  if (!hidden.length) {
    wrap.hidden = true;
    menu.hidden = true;
    menu.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  menu.innerHTML = hidden.map((el) => {
    const action = el.getAttribute('data-action') ?? '';
    const title = el.getAttribute('title') ?? '';
    const label = el.querySelector('span:not(.tb-ico):not(.tb-lock)')?.textContent ?? action;
    const ico = el.querySelector('.tb-ico')?.textContent ?? '•';
    const locked = el.getAttribute('aria-disabled') === 'true';
    return `<button class="tb-more-item${locked ? ' is-locked' : ''}" data-mirror-action="${action}" role="menuitem" title="${title.replace(/"/g, '&quot;')}"${locked ? ' aria-disabled="true"' : ''}>
      <span class="tb-ico" aria-hidden="true">${ico}</span><span>${label}</span>${locked ? '<span class="tb-lock" aria-hidden="true">🔒</span>' : ''}
    </button>`;
  }).join('');
  // Wire each mirror button to invoke the underlying real button so the
  // existing click handler (and role-based gating) runs exactly once.
  menu.querySelectorAll<HTMLButtonElement>('[data-mirror-action]').forEach((btn) => {
    btn.onclick = () => {
      const action = btn.getAttribute('data-mirror-action');
      if (!action) return;
      const real = mount.querySelector<HTMLElement>(`[data-action="${CSS.escape(action)}"]`);
      if (real) real.click();
      closeMoreMenu(mount);
    };
  });
}

function toggleMoreMenu(mount: HTMLElement): void {
  const menu = mount.querySelector<HTMLElement>('#tb-more-menu');
  const btn = mount.querySelector<HTMLElement>('[data-action="toggle-more"]');
  if (!menu || !btn) return;
  const open = !menu.hidden;
  if (open) { closeMoreMenu(mount); return; }
  syncMoreMenu(mount);
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
}

function closeMoreMenu(mount: HTMLElement): void {
  const menu = mount.querySelector<HTMLElement>('#tb-more-menu');
  const btn = mount.querySelector<HTMLElement>('[data-action="toggle-more"]');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

/**
 * Toggle one of the slide-in sidebars (review §2 #10 responsive layout).
 * Only has a visible effect on narrow viewports — on desktop the sidebars
 * are permanent grid areas and the hamburger is hidden via CSS.
 */
function toggleSidebar(side: 'left' | 'right'): void {
  const root = document.documentElement;
  const attr = side === 'left' ? 'data-sidebar-left' : 'data-sidebar-right';
  const open = root.getAttribute(attr) === 'open';
  if (open) {
    root.removeAttribute(attr);
  } else {
    // Close the other drawer so only one is open at a time on small screens.
    const other = side === 'left' ? 'data-sidebar-right' : 'data-sidebar-left';
    root.removeAttribute(other);
    root.setAttribute(attr, 'open');
  }
  const app = document.getElementById('app');
  if (app) {
    const anyOpen = root.hasAttribute('data-sidebar-left') || root.hasAttribute('data-sidebar-right');
    app.classList.toggle('has-backdrop', anyOpen);
  }
}
