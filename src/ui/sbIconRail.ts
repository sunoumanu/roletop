import { store } from '../state/store';
import { toast } from './toast';

/**
 * Right-side vertical icon rail (Foundry-style sidebar tabs).
 *
 * Mirrors the tabs in `sidebarRight.ts` (Chat, Macros, Assets) and adds a
 * collapse toggle. Clicking a tab activates it in the sidebar AND ensures
 * the sidebar is visible. Clicking the active tab collapses the sidebar.
 *
 * The actual tab content lives in `#sidebar-right`; this rail just controls
 * which tab is shown and the collapsed/expanded state.
 */

interface RailTab {
  id: 'chat' | 'macros' | 'assets';
  icon: string;
  label: string;
}

const TABS: RailTab[] = [
  { id: 'chat',   icon: '💬', label: 'Chat & rolls' },
  { id: 'macros', icon: '⚡', label: 'Macros' },
  { id: 'assets', icon: '🎨', label: 'Asset library' }
];

export function renderSbIconRail(mount: HTMLElement): void {
  mount.innerHTML = `
    ${TABS.map((t) => `
      <button class="icr-btn" role="tab"
              data-rail-tab="${t.id}"
              aria-label="${t.label}"
              title="${t.label}"><span aria-hidden="true">${t.icon}</span></button>
    `).join('')}
    <div class="tb-spacer"></div>
    <button class="icr-btn" data-rail-action="toggle-collapse" aria-label="Collapse sidebar"
            title="Collapse sidebar"><span aria-hidden="true">⇥</span></button>
    <button class="icr-btn" data-rail-action="show-hotkeys" aria-label="Hotkeys"
            title="Keyboard shortcuts"><span aria-hidden="true">⌨</span></button>
  `;

  mount.addEventListener('click', async (e) => {
    const tabBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-rail-tab]');
    const actionBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-rail-action]');

    if (tabBtn) {
      const id = tabBtn.getAttribute('data-rail-tab') as RailTab['id'];
      const collapsed = document.documentElement.getAttribute('data-sider-collapsed') === 'true';
      const lib = (window as unknown as {
        sidebarRight?: { activate: (tab: RailTab['id']) => void; current: () => string };
      }).sidebarRight;
      if (collapsed) {
        document.documentElement.removeAttribute('data-sider-collapsed');
        if (lib) lib.activate(id);
        refreshActive(mount);
        return;
      }
      // Already expanded — clicking the active tab collapses; clicking
      // another switches to it.
      if (lib && lib.current() === id) {
        document.documentElement.setAttribute('data-sider-collapsed', 'true');
      } else if (lib) {
        lib.activate(id);
      }
      refreshActive(mount);
      return;
    }

    if (actionBtn) {
      const action = actionBtn.getAttribute('data-rail-action');
      if (action === 'toggle-collapse') {
        const root = document.documentElement;
        const collapsed = root.getAttribute('data-sider-collapsed') === 'true';
        if (collapsed) root.removeAttribute('data-sider-collapsed');
        else root.setAttribute('data-sider-collapsed', 'true');
        refreshActive(mount);
        return;
      }
      if (action === 'show-hotkeys') {
        const { openHotkeyOverlay } = await import('./hotkeyOverlay');
        openHotkeyOverlay();
        return;
      }
    }
  });

  refreshActive(mount);
  // Subscribe to store so the active rail icon stays in sync if other code
  // toggles the active sidebar tab. We piggy-back on existing player/state
  // changes rather than introducing a new state field.
  store.subscribe(() => refreshActive(mount));

  // Watch the <html> element for collapse-state changes so the rail icons
  // de-highlight when collapsed.
  const observer = new MutationObserver(() => refreshActive(mount));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-sider-collapsed'] });

  // Acknowledge the toast import so eslint doesn't think it's unused.
  void toast;
}

function refreshActive(mount: HTMLElement): void {
  const collapsed = document.documentElement.getAttribute('data-sider-collapsed') === 'true';
  const lib = (window as unknown as {
    sidebarRight?: { current: () => string };
  }).sidebarRight;
  const active = collapsed ? null : (lib ? lib.current() : null);
  for (const btn of mount.querySelectorAll<HTMLElement>('[data-rail-tab]')) {
    btn.classList.toggle('active', btn.getAttribute('data-rail-tab') === active);
  }
  // Update collapse-toggle glyph + label for clarity.
  const collapseBtn = mount.querySelector<HTMLElement>('[data-rail-action="toggle-collapse"]');
  if (collapseBtn) {
    const span = collapseBtn.querySelector('span');
    if (span) span.textContent = collapsed ? '⇤' : '⇥';
    collapseBtn.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    collapseBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }
}
