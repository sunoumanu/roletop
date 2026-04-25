import { assetPacks, importManifestUrl, type AssetEntry, type AssetKind } from '../features/assetManifest';
import { escapeHtml } from '../utils/escape';
import { toast } from './toast';
import { isGM } from '../features/roles';
import { thumbnail } from '../features/thumbnail';
import { store } from '../state/store';
import { execute, cmdAddToken } from '../state/history';
import { GRID_SIZE } from '../engine/grid';
import { camera } from '../engine/camera';
import { defaultSheet } from '../features/sheet';
import type { Token } from '../state/schemas';

/**
 * Asset library (Phase B, #19).
 *
 * Lives as a tab inside the right sidebar (see `sidebarRight.ts`). Previously
 * floated as its own panel but that competed with the map for screen space,
 * so the chrome — toggle button, floating card, separate z-index stack — was
 * removed in favour of a docked tab.
 *
 * Each visible row is draggable onto the canvas:
 *   - `kind: 'token' | 'portrait'` → drops as a new token using the asset
 *     URL as `Token.image`.
 *   - `kind: 'map'` → drops as the battle-map background.
 *   - anything else → a toast explaining we don't know what to do.
 *
 * The canvas-side drop handler lives in `inputHandlers.ts` and reads a JSON
 * payload off `DataTransfer.types` (`application/x-vtt-asset`). We could
 * pass a full asset object, but `dataTransfer.setData` stringifies anything
 * non-string, so we serialise ourselves for predictable decode.
 *
 * Thumbnails:
 *   - If the manifest entry carries a dedicated `thumbnail` URL we use that.
 *   - Otherwise we lazily run the asset URL through `features/thumbnail.ts`,
 *     which caps at 512 px and caches the result for the tab's lifetime.
 *   - While thumbnails resolve we show a neutral placeholder so the panel
 *     stays laid-out instead of reflowing as images decode.
 */

/** MIME-ish identifier we write to the drag DataTransfer. */
export const DRAG_MIME = 'application/x-vtt-asset';

/**
 * Wire format for a dragged asset. Kept minimal — the canvas drop handler
 * doesn't need the full manifest row.
 */
export interface DraggedAsset {
  name: string;
  url: string;
  kind: AssetKind;
}

/** Pill labels for the kind filter. Empty string = All. */
const KIND_PILLS: Array<{ kind: AssetKind | ''; label: string }> = [
  { kind: '',         label: 'All' },
  { kind: 'token',    label: 'Tokens' },
  { kind: 'map',      label: 'Maps' },
  { kind: 'tile',     label: 'Tiles' },
  { kind: 'portrait', label: 'Portraits' },
  { kind: 'audio',    label: 'Audio' }
];

/**
 * Render the asset library into `mount`. Returns a disposer that unsubscribes
 * from `assetPacks` and clears the mount — callers that dispose-and-remount
 * on role change (e.g. tab switches) should honour it to avoid leaks.
 */
export function renderAssetLibraryInto(mount: HTMLElement): () => void {
  mount.classList.add('al');
  mount.innerHTML = `
    <header class="al-hdr">
      <div class="sb-title">ASSETS</div>
      <span class="al-count" data-al-mount="count" aria-live="polite">0</span>
      <button class="sm-btn" data-al-action="toggle-import" aria-expanded="false" aria-controls="al-import-row" title="Import a manifest pack">+ Pack</button>
    </header>
    <div class="al-import" id="al-import-row" hidden>
      <input
        class="al-url"
        type="url"
        placeholder="Paste manifest URL…"
        aria-label="Manifest URL"
        data-al-input="url"
      />
      <button class="sm-btn primary" data-al-action="import">Add</button>
    </div>
    <div class="al-filter">
      <input
        class="al-search"
        type="search"
        placeholder="Search name, kind, tag…"
        aria-label="Filter assets"
        data-al-input="query"
      />
    </div>
    <div class="al-pills" role="tablist" aria-label="Filter by kind">
      ${KIND_PILLS.map(({ kind, label }) => `
        <button class="al-pill${kind === '' ? ' active' : ''}"
                role="tab" aria-selected="${kind === '' ? 'true' : 'false'}"
                data-al-action="filter-kind" data-kind="${escapeHtml(kind)}">
          ${escapeHtml(label)}
        </button>
      `).join('')}
    </div>
    <details class="al-packs-wrap">
      <summary>
        <span>Packs</span>
        <span class="al-pack-count" data-al-mount="pack-count">0</span>
      </summary>
      <div class="al-packs" data-al-mount="packs"></div>
    </details>
    <div class="al-grid" data-al-mount="grid" aria-live="polite"></div>
    <footer class="al-foot">Drag a tile onto the map to place it.</footer>
  `;

  // State for the filter widgets. Kept on the closure so re-renders don't
  // blow away the query between keystrokes.
  let query = '';
  let kindFilter: AssetKind | '' = '';

  const grid       = mount.querySelector<HTMLElement>('[data-al-mount="grid"]')!;
  const packsEl    = mount.querySelector<HTMLElement>('[data-al-mount="packs"]')!;
  const count      = mount.querySelector<HTMLElement>('[data-al-mount="count"]')!;
  const packCount  = mount.querySelector<HTMLElement>('[data-al-mount="pack-count"]')!;
  const urlInput   = mount.querySelector<HTMLInputElement>('[data-al-input="url"]')!;
  const searchInput = mount.querySelector<HTMLInputElement>('[data-al-input="query"]')!;
  const importRow  = mount.querySelector<HTMLElement>('#al-import-row')!;
  const importBtn  = mount.querySelector<HTMLElement>('[data-al-action="toggle-import"]')!;

  // Panel events. Delegated so we don't have to re-bind on every refresh.
  mount.addEventListener('click', async (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-al-action]');
    if (!el) return;
    const act = el.getAttribute('data-al-action');
    if (act === 'import') {
      await handleImport();
    } else if (act === 'toggle-import') {
      const open = !importRow.hidden;
      importRow.hidden = open;
      importBtn.setAttribute('aria-expanded', String(!open));
      if (!open) urlInput.focus();
    } else if (act === 'remove-pack') {
      const name = el.getAttribute('data-pack-name');
      if (name && assetPacks.remove(name)) toast(`Removed pack "${name}"`, 'ok');
    } else if (act === 'drop-asset') {
      // Keyboard / click fallback for users who can't drag — drops at map
      // origin. Rare but the a11y audit (#24) calls it out.
      const payload = el.getAttribute('data-asset');
      if (payload) handleAssetDrop(JSON.parse(payload) as DraggedAsset, originOfView());
    } else if (act === 'filter-kind') {
      kindFilter = (el.getAttribute('data-kind') as AssetKind | '') || '';
      refreshPills();
      renderGrid();
    }
  });
  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderGrid();
  });
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleImport();
    }
  });

  async function handleImport(): Promise<void> {
    const url = urlInput.value.trim();
    if (!url) { toast('Enter a manifest URL first', 'warn'); return; }
    try {
      const pack = await importManifestUrl(url);
      toast(`Imported "${pack.name}" (${pack.assets.length} asset${pack.assets.length === 1 ? '' : 's'})`, 'ok');
      urlInput.value = '';
      importRow.hidden = true;
      importBtn.setAttribute('aria-expanded', 'false');
    } catch (err) {
      toast(`Manifest import failed: ${(err as Error).message}`, 'err');
    }
  }

  function refresh(): void {
    renderPacks();
    renderGrid();
  }

  function refreshPills(): void {
    for (const pill of mount.querySelectorAll<HTMLElement>('.al-pill')) {
      const k = pill.getAttribute('data-kind') ?? '';
      const active = k === kindFilter;
      pill.classList.toggle('active', active);
      pill.setAttribute('aria-selected', String(active));
    }
  }

  function renderPacks(): void {
    const packs = assetPacks.list();
    packCount.textContent = String(packs.length);
    if (!packs.length) {
      packsEl.innerHTML = `<div class="empty-hint">No packs imported. Paste a manifest URL via <b>+ Pack</b>.</div>`;
      return;
    }
    packsEl.innerHTML = packs.map((p) => `
      <div class="al-pack">
        <span class="al-pack-nm" title="${escapeHtml(p.source)}">${escapeHtml(p.name)}</span>
        <span class="al-pack-ct">${p.assets.length}</span>
        <button class="sm-btn" data-al-action="remove-pack" data-pack-name="${escapeHtml(p.name)}" aria-label="Remove pack ${escapeHtml(p.name)}">✕</button>
      </div>
    `).join('');
  }

  function renderGrid(): void {
    const rows = assetPacks.search(query).filter(({ asset }) => !kindFilter || asset.kind === kindFilter);
    count.textContent = `${rows.length}`;
    if (!rows.length) {
      grid.innerHTML = assetPacks.list().length
        ? `<div class="empty-hint">No matches. Try a different search or kind filter.</div>`
        : `<div class="empty-hint">Import a pack to get started — tap <b>+ Pack</b> above.</div>`;
      return;
    }
    // Cap the grid to keep DOM cost sane on 1000-asset packs. A "show more"
    // affordance beats blocking the main thread laying out every row.
    const MAX = 200;
    const shown = rows.slice(0, MAX);
    grid.innerHTML = shown.map(({ pack, asset }) => {
      const payload = escapeHtml(JSON.stringify({ name: asset.name, url: asset.url, kind: asset.kind }));
      // Initial src uses the manifest-provided thumbnail if any, or a 1×1
      // transparent spacer; the lazy thumb runner will upgrade it on load.
      const initial = asset.thumbnail ?? 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=';
      return `
        <div class="al-card" draggable="true" data-asset-url="${escapeHtml(asset.url)}" data-asset='${payload}' tabindex="0"
             role="button" aria-label="${escapeHtml(asset.name)} (${escapeHtml(asset.kind)}) from ${escapeHtml(pack)}">
          <img class="al-thumb" alt="" loading="lazy" src="${escapeHtml(initial)}" data-src="${escapeHtml(asset.url)}" />
          <div class="al-meta">
            <div class="al-nm">${escapeHtml(asset.name)}</div>
            <div class="al-tag">${escapeHtml(asset.kind)}</div>
          </div>
        </div>
      `;
    }).join('') + (rows.length > MAX
      ? `<div class="empty-hint">Showing ${MAX} of ${rows.length}. Refine your search to see the rest.</div>`
      : '');

    // Wire drag + async thumbnail per card.
    for (const card of grid.querySelectorAll<HTMLElement>('.al-card')) {
      card.addEventListener('dragstart', (e) => {
        const payloadStr = card.getAttribute('data-asset');
        if (!payloadStr || !e.dataTransfer) return;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData(DRAG_MIME, payloadStr);
        // Fallback MIME so native browsers with strict DataTransfer rules
        // still get *something* (e.g. dropping into a text area works).
        e.dataTransfer.setData('text/uri-list', card.getAttribute('data-asset-url') ?? '');
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const payloadStr = card.getAttribute('data-asset');
          if (!payloadStr) return;
          handleAssetDrop(JSON.parse(payloadStr) as DraggedAsset, originOfView());
        }
      });
      const thumb = card.querySelector<HTMLImageElement>('.al-thumb');
      const src = thumb?.getAttribute('data-src');
      if (thumb && src && !thumb.src.startsWith('data:image/')) {
        // Manifest-provided thumbnail already set — leave alone.
        continue;
      }
      if (thumb && src) {
        // Off-thread decode + cap; `thumbnail` returns the source URL
        // unchanged when already small, so we don't waste a re-encode.
        thumbnail(src).then((tu) => { thumb.src = tu; }).catch(() => { /* leave placeholder */ });
      }
    }
  }

  // Subscribe to index changes so imports/removes refresh the panel.
  const unsub = assetPacks.onChange(refresh);
  refresh();

  return (): void => {
    unsub();
    mount.classList.remove('al');
    mount.innerHTML = '';
  };
}

/** World-space point at the centre of the current viewport. */
function originOfView(): { wx: number; wy: number } {
  return { wx: camera.x, wy: camera.y };
}

/**
 * Apply a dragged asset at world-space `(wx, wy)`. Exported so the canvas
 * drop handler can dispatch it without duplicating the kind-switch.
 */
export function handleAssetDrop(asset: DraggedAsset, at: { wx: number; wy: number }): void {
  if (!isGM()) { toast('Only the GM can drop assets', 'warn'); return; }
  switch (asset.kind) {
    case 'map': {
      store.getState().setMapImage(asset.url);
      toast(`Map set to ${asset.name}`, 'ok');
      return;
    }
    case 'token':
    case 'portrait':
    case 'tile':
    case 'other': {
      // Tile/other round-trip through the token pipeline — simplest way to
      // land a visual asset on the map today. Phase C will introduce a
      // dedicated "tile" primitive with its own layer.
      spawnTokenFromAsset(asset, at);
      return;
    }
    case 'audio': {
      toast('Audio assets are not yet playable in the scene', 'warn');
      return;
    }
  }
}

function spawnTokenFromAsset(asset: DraggedAsset, at: { wx: number; wy: number }): void {
  const s = store.getState();
  const sheet = defaultSheet(asset.name);
  s.addSheet(sheet);
  const initial = asset.name.charAt(0).toUpperCase() || '?';
  const gx = Math.round(at.wx / GRID_SIZE);
  const gy = Math.round(at.wy / GRID_SIZE);
  const token: Token = {
    id: s.nextTokenId,
    name: asset.name.slice(0, 40),
    type: 'npc',
    color: '#7a6a4a',
    initial: initial.slice(0, 2),
    wx: gx * GRID_SIZE + GRID_SIZE / 2,
    wy: gy * GRID_SIZE + GRID_SIZE / 2,
    hp: sheet.hp,
    maxHp: sheet.maxHp,
    ownerId: 'dm',
    sheetId: sheet.id,
    dead: false,
    image: asset.url
  };
  execute(cmdAddToken(token));
  toast(`${asset.name} added to the scene`, 'ok');
}

/**
 * Parse an `AssetEntry`-ish payload out of a DataTransfer. Returns null if
 * no asset payload is present. Exported for the canvas drop handler.
 */
export function readAssetFromDataTransfer(dt: DataTransfer | null): DraggedAsset | null {
  if (!dt) return null;
  const raw = dt.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as DraggedAsset;
    if (!v || typeof v.url !== 'string' || typeof v.name !== 'string') return null;
    return v;
  } catch {
    return null;
  }
}

/** Exposed for tests that want to assert the schema surface area. */
export function assetEntryToDragPayload(a: AssetEntry): DraggedAsset {
  return { name: a.name, url: a.url, kind: a.kind };
}
