import './style.css';
import { store, type State } from './state/store';
import { installToastRoot, toast } from './ui/toast';
import { installRollPopup } from './ui/rollPopup';
import { renderToolbar } from './ui/toolbar';
import { renderSidebarLeft } from './ui/sidebarLeft';
import { renderSidebarRight } from './ui/sidebarRight';
import { renderSbIconRail } from './ui/sbIconRail';
import { renderSceneNav } from './ui/sceneNav';
import { renderPlayersList } from './ui/playersList';
import { installContextMenu } from './ui/contextMenu';
import { installSheetModal } from './ui/sheetModal';
import { installHotkeyOverlay } from './ui/hotkeyOverlay';
import { installHotkeys } from './ui/hotkeys';
import { installHud } from './ui/hud';
import { installInputHandlers } from './ui/inputHandlers';
import { Renderer } from './render/renderer';
import { assets } from './render/assets';
import { MAP_H, MAP_W } from './engine/grid';
import { camera } from './engine/camera';
import { loadFromStorage, initAutosave, applyScene } from './state/persistence';
import { seedDemoParty } from './features/spawn';
import { demoRoom } from './engine/walls';
import { DEFAULT_MACROS } from './features/macros';
import type { ChatPlayer } from './state/schemas';
import { installWelcomeFlow } from './ui/welcome';
import { importManifestUrl, assetPacks } from './features/assetManifest';
import { awaitLogin } from './ui/loginScreen';

/**
 * Bootstrap — build DOM scaffold, install subsystems, hydrate state.
 *
 * Order matters:
 *   1. Structural DOM (so everything else can `appendChild` into it).
 *   2. Toast root + roll popup (so anything can call `toast()` immediately).
 *   3. Panels (toolbar, sidebars).
 *   4. Overlays (context menu, sheet modal, hotkey overlay, HUD).
 *   5. Canvas + renderer + input handlers.
 *   6. Hydrate from storage or seed the demo scene.
 *   7. Start autosave + hotkeys + renderer tick.
 */

function buildScaffold(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app not found in index.html');
  app.innerHTML = `
    <div id="tool-rail" role="toolbar" aria-orientation="vertical" aria-label="Scene tools"></div>
    <aside id="sidebar-left" aria-label="Scene, tokens, layers"></aside>
    <div id="board-wrap">
      <canvas id="board" tabindex="0" aria-label="Battle map"></canvas>
      <div id="scene-nav" role="navigation" aria-label="Scene navigation"></div>
      <div id="players-list" role="region" aria-label="Connected players"></div>
    </div>
    <aside id="sidebar-right" class="has-icon-rail" aria-label="Chat, macros and assets"></aside>
    <nav id="sb-icon-rail" role="tablist" aria-orientation="vertical" aria-label="Sidebar tabs"></nav>
  `;
}

function installPlayers(): void {
  // Seed the demo roster. `currentUserId` is left as the placeholder default
  // until the user picks an identity in the login screen — the canvas + UI
  // are still wired but every interaction that depends on identity will be
  // gated until that completes.
  const players: ChatPlayer[] = [
    { id: 'dm', name: 'Game Master', color: '#c9983a', role: 'gm' },
    { id: 'p1', name: 'Aldric',      color: '#5a8abf', role: 'player' },
    { id: 'p2', name: 'Mira',        color: '#bf8a5a', role: 'player' },
    { id: 'p3', name: 'Vayne',       color: '#5abf8a', role: 'player' }
  ];
  store.setState({ players } as Partial<State>);
  if (!store.getState().macros.length) {
    store.setState({ macros: [...DEFAULT_MACROS] } as Partial<State>);
  }
}

function hydrateOrSeed(): void {
  const saved = loadFromStorage();
  if (saved) {
    applyScene(saved);
    toast('Scene restored from last session', 'ok');
    return;
  }
  // Fresh demo scene.
  store.setState({ walls: demoRoom() } as Partial<State>);
  seedDemoParty();
  store.getState().addChat({ type: 'system', body: 'Welcome, Game Master. Press ? for keyboard shortcuts.' });
}

function startRenderer(): Renderer {
  const canvas = document.getElementById('board') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  const renderer = new Renderer(canvas, ctx);
  // Prime the map asset + fit the camera.
  assets.generateMapCanvas(MAP_W, MAP_H);
  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());
  camera.fit(canvas.clientWidth, canvas.clientHeight, MAP_W, MAP_H);
  renderer.start();
  installInputHandlers(canvas, renderer);
  return renderer;
}

/**
 * Auto-import the bundled starter pack on first run.
 *
 * The pack is shipped under `public/assets/` and registered with the shared
 * `assetPacks` index so the library UI, condition icons, and token art
 * fallback chain can all reach it. Behaviour notes:
 *
 *   - Guarded by a localStorage flag so the fetch only happens once per
 *     install. A returning user with a hydrated scene doesn't re-pay.
 *   - Failure is silent (warn-only). Offline dev, stripped-dist, or a
 *     renamed manifest must never break boot.
 *   - The absolute URL is computed against `window.location` so the
 *     `new URL(relativeAsset, base)` calls inside `normaliseManifest`
 *     receive a valid absolute base.
 */
const DEFAULT_PACK_FLAG = 'vtt.defaultPack.v1';
const DEFAULT_PACK_NAME = 'RoleTop Starter Pack';
/** Asset id in the starter pack to apply as the battle map on first run. */
const DEFAULT_MAP_ASSET_ID = 'map-dungeon-stone';

async function loadDefaultPack(): Promise<void> {
  // Re-register in-memory even if already seen, so the UI shows it after
  // a hard reload (the flag only suppresses the toast + re-fetch attempt
  // doesn't matter because fetch is cheap and the pack is small).
  try {
    const manifestUrl = new URL('assets/default-pack.json', window.location.href).toString();
    const pack = await importManifestUrl(manifestUrl);
    if (!localStorage.getItem(DEFAULT_PACK_FLAG)) {
      toast(`Loaded ${pack.name} (${pack.assets.length} assets)`, 'ok');
      // Apply a default map so the scene actually *uses* a starter asset
      // instead of just indexing them. Only when no map is set yet — any
      // previously restored scene takes priority.
      const s = store.getState();
      if (!s.mapImage) {
        const defaultMap = pack.assets.find((a) => a.id === DEFAULT_MAP_ASSET_ID)
          ?? pack.assets.find((a) => a.kind === 'map');
        if (defaultMap) s.setMapImage(defaultMap.url);
      }
      localStorage.setItem(DEFAULT_PACK_FLAG, '1');
    }
  } catch (err) {
    // Keep boot resilient — log, don't throw.
    // eslint-disable-next-line no-console
    console.warn(`Default asset pack unavailable: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  buildScaffold();

  installToastRoot(document.body);
  installRollPopup(document.body);
  installContextMenu(document.body);
  installSheetModal(document.body);
  installHotkeyOverlay(document.body);

  renderToolbar(document.getElementById('tool-rail')!);
  renderSidebarLeft(document.getElementById('sidebar-left')!);
  renderSidebarRight(document.getElementById('sidebar-right')!);
  renderSbIconRail(document.getElementById('sb-icon-rail')!);
  renderSceneNav(document.getElementById('scene-nav')!);
  renderPlayersList(document.getElementById('players-list')!);
  installHud(document.getElementById('board-wrap')!);

  installPlayers();

  // Block the rest of boot behind the login screen. `awaitLogin` resolves
  // once the user picks a role + identity (or restores a saved one). Until
  // then the canvas is masked by the login overlay so accidental input on
  // the still-empty scene can't happen.
  await awaitLogin(document.body);

  hydrateOrSeed();
  // `applyScene` inside hydrateOrSeed spreads the saved scene into the store,
  // which includes `fogEnabled` from whoever last saved (typically the GM,
  // with fog off). For players, vision-on is a per-user default, not scene
  // data — re-apply it here AFTER hydration so the load can't stomp it.
  if (store.getState().role === 'player' && !store.getState().fogEnabled) {
    store.getState().setFog(true);
  }
  startRenderer();
  // If the player owns a token, recenter the camera on it so their vision-lit
  // circle is immediately on screen. Default `camera.fit` centers the whole
  // map, which puts a player's small vision polygon off in a quadrant —
  // the rest of the canvas is opaque fog and the user reasonably reports
  // "I can only see the map when I pan around".
  if (store.getState().role === 'player') {
    const me = store.getState().tokens.find(
      (t) => t.ownerId === store.getState().currentUserId
    );
    if (me) {
      camera.x = me.wx;
      camera.y = me.wy;
      // Bring zoom up to a more useful level for in-character viewing —
      // the fit-to-map zoom is too low to read tokens at character scale.
      camera.zoom = Math.max(camera.zoom, 1);
      store.getState().markDirty();
    }
  }
  installHotkeys();
  initAutosave();

  // #1 — first-run welcome flow. Only shows when the welcome-seen flag is
  // absent, so returning users (with a hydrated scene) skip straight to play.
  installWelcomeFlow(document.body);

  // #19 — the asset library now lives as a tab inside the right sidebar
  // (see `sidebarRight.ts`). The sidebar mounts it once during its own render
  // so there's no separate install step here.

  // Auto-import the bundled starter pack. Fire-and-forget — the library UI
  // already subscribes to `assetPacks.onChange` so it'll refresh whenever the
  // pack lands. The `void` silences the floating-promise lint.
  if (!assetPacks.get(DEFAULT_PACK_NAME)) {
    void loadDefaultPack();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void main(); });
} else {
  void main();
}
