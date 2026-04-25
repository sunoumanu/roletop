import { store, nextId } from '../state/store';
import { camera } from '../engine/camera';
import { snap, cellsInRect } from '../engine/grid';
import { canEditWalls, canMoveToken } from '../features/roles';
import { execute, cmdAddWall, cmdMoveToken, cmdAddAoE } from '../state/history';
import { show as showContextMenu, hide as hideContextMenu } from './contextMenu';
import { toast } from './toast';
import { isGM } from '../features/roles';
import type { Renderer } from '../render/renderer';
import type { Token, AoETemplate } from '../state/schemas';

/**
 * Canvas input handling.
 *
 * Ported from phase-5's inline event wiring. Everything talks to the store
 * or the `Renderer`'s drafts (wallDraft, aoePreview, measure). Tool-specific
 * behavior is chosen by the current tool + modifier keys.
 */

interface DragState {
  kind: 'none' | 'pan' | 'token';
  tokenId?: number;
  lastSx: number;
  lastSy: number;
  startWx?: number;
  startWy?: number;
}

// #5 — affordance for the right-click context menu. We keep a localStorage
// flag so the hint fires exactly once per browser; the flag is set either
// when the tip shows OR when the user discovers right-click / long-press
// on their own, so power users never see it.
const RIGHT_CLICK_HINT_KEY = 'vtt:phase6:right-click-tip-seen';
function hasSeenRightClickTip(): boolean {
  try { return localStorage.getItem(RIGHT_CLICK_HINT_KEY) === '1'; } catch { return true; }
}
function markRightClickTipSeen(): void {
  try { localStorage.setItem(RIGHT_CLICK_HINT_KEY, '1'); } catch { /* private mode etc. */ }
}
function maybeShowRightClickTip(): void {
  if (hasSeenRightClickTip()) return;
  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  const hint = touch
    ? 'Tip: long-press a token for damage, conditions, and sheet.'
    : 'Tip: right-click a token for damage, conditions, and sheet.';
  toast(hint, 'info');
  markRightClickTipSeen();
}

export function installInputHandlers(canvas: HTMLCanvasElement, renderer: Renderer): void {
  const drag: DragState = { kind: 'none', lastSx: 0, lastSy: 0 };

  canvas.addEventListener('mousedown', (e) => {
    hideContextMenu();
    const { wx, wy } = screenToWorld(canvas, e);
    const s = store.getState();
    drag.lastSx = e.clientX;
    drag.lastSy = e.clientY;

    // Middle-click or space+drag-ish: pan.
    if (e.button === 1 || e.shiftKey) {
      drag.kind = 'pan';
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;

    const tool = s.currentTool;

    if (tool === 'wall') {
      if (!canEditWalls()) { toast('Walls are GM-only', 'warn'); return; }
      const snapped = snap(wx, wy);
      renderer.wallDraft.begin(snapped.wx, snapped.wy);
      s.markDirty();
      return;
    }

    if (tool === 'measure') {
      renderer.measureStart = { wx, wy };
      renderer.measureEnd = { wx, wy };
      s.markDirty();
      return;
    }

    if (tool === 'fogbrush') {
      if (!isGM()) { toast('Fog brush is GM-only', 'warn'); return; }
      renderer.fogBrushPreview = {
        mode: s.fogBrushMode,
        a: { wx, wy },
        b: { wx, wy }
      };
      s.markDirty();
      return;
    }

    if (tool === 'aoe') {
      // Place a preview at click; finalize on mouseup (or rotate via move for cone/line).
      const preview: AoETemplate = {
        id: nextId(),
        shape: s.aoeShape,
        originX: wx,
        originY: wy,
        sizeFt: s.aoeSize,
        angle: 0,
        color: '#c8622a'
      };
      renderer.aoePreview = preview;
      s.markDirty();
      return;
    }

    // Select / drag token
    const hit = hitToken(s.tokens, wx, wy);
    if (hit) {
      s.selectToken(hit.id);
      // #5 — surface the right-click menu on first selection for new users.
      maybeShowRightClickTip();
      if (canMoveToken(hit)) {
        drag.kind = 'token';
        drag.tokenId = hit.id;
        drag.startWx = hit.wx;
        drag.startWy = hit.wy;
        // Start a drag-trail visualisation so players + GM see the path + distance.
        renderer.tokenDrag = {
          tokenId: hit.id,
          from: { wx: hit.wx, wy: hit.wy },
          to: { wx: hit.wx, wy: hit.wy },
          path: [{ wx: hit.wx, wy: hit.wy }]
        };
        s.markDirty();
      }
    } else {
      s.selectToken(null);
      drag.kind = 'pan';
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const s = store.getState();
    const { wx, wy } = screenToWorld(canvas, e);

    if (drag.kind === 'pan') {
      const dx = (e.clientX - drag.lastSx) / camera.zoom;
      const dy = (e.clientY - drag.lastSy) / camera.zoom;
      camera.x -= dx;
      camera.y -= dy;
      drag.lastSx = e.clientX;
      drag.lastSy = e.clientY;
      s.markDirty();
      return;
    }

    if (drag.kind === 'token' && drag.tokenId !== undefined) {
      const snapped = snap(wx, wy);
      s.moveToken(drag.tokenId, snapped.wx, snapped.wy);
      if (renderer.tokenDrag) {
        const t = renderer.tokenDrag;
        const last = t.path[t.path.length - 1];
        if (!last || last.wx !== snapped.wx || last.wy !== snapped.wy) {
          t.path.push({ wx: snapped.wx, wy: snapped.wy });
          // Cap the trail length so long drags don't balloon memory.
          if (t.path.length > 200) t.path.splice(0, t.path.length - 200);
        }
        t.to = { wx: snapped.wx, wy: snapped.wy };
        s.markDirty();
      }
      return;
    }

    if (renderer.wallDraft.drawing) {
      const snapped = snap(wx, wy);
      renderer.wallDraft.update(snapped.wx, snapped.wy);
      s.markDirty();
      return;
    }

    if (renderer.measureStart) {
      renderer.measureEnd = { wx, wy };
      s.markDirty();
      return;
    }

    if (renderer.fogBrushPreview) {
      renderer.fogBrushPreview = { ...renderer.fogBrushPreview, b: { wx, wy } };
      s.markDirty();
      return;
    }

    if (renderer.aoePreview) {
      // For cone/line, mouse position determines direction from origin.
      const shape = renderer.aoePreview.shape;
      if (shape === 'cone' || shape === 'line') {
        const angle = Math.atan2(wy - renderer.aoePreview.originY, wx - renderer.aoePreview.originX);
        renderer.aoePreview = { ...renderer.aoePreview, angle };
      } else {
        renderer.aoePreview = { ...renderer.aoePreview, originX: wx, originY: wy };
      }
      s.markDirty();
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    const s = store.getState();
    const { wx, wy } = screenToWorld(canvas, e);

    if (drag.kind === 'token' && drag.tokenId !== undefined &&
        drag.startWx !== undefined && drag.startWy !== undefined) {
      const snapped = snap(wx, wy);
      const from = { wx: drag.startWx, wy: drag.startWy };
      const to = { wx: snapped.wx, wy: snapped.wy };
      if (from.wx !== to.wx || from.wy !== to.wy) {
        // Snap back to origin first so the command's `do()` performs the real move.
        s.moveToken(drag.tokenId, from.wx, from.wy);
        execute(cmdMoveToken(drag.tokenId, from, to));
      }
      // Clear the drag-trail preview.
      renderer.tokenDrag = null;
      s.markDirty();
    }

    if (renderer.wallDraft.drawing) {
      const wall = renderer.wallDraft.finish();
      if (wall) execute(cmdAddWall(wall));
    }

    if (renderer.aoePreview) {
      execute(cmdAddAoE(renderer.aoePreview));
      toast(`${renderer.aoePreview.shape} ${renderer.aoePreview.sizeFt}ft placed`, 'ok');
      renderer.aoePreview = null;
    }

    if (renderer.fogBrushPreview) {
      const { a, b, mode } = renderer.fogBrushPreview;
      const cells = cellsInRect(a.wx, a.wy, b.wx, b.wy);
      if (cells.length) {
        // Auto-enable the manual-fog overlay the first time the GM paints,
        // so the effect is immediately visible.
        if (!s.manualFogEnabled) s.setManualFogEnabled(true);
        s.applyFogBrush(cells, mode);
        toast(`${mode === 'reveal' ? 'Revealed' : 'Hid'} ${cells.length} cell${cells.length === 1 ? '' : 's'}`, 'ok');
      }
      renderer.fogBrushPreview = null;
      s.markDirty();
    }

    if (renderer.measureStart) {
      renderer.measureStart = null;
      renderer.measureEnd = null;
      const el = document.getElementById('measure-display');
      if (el) el.textContent = '';
      s.markDirty();
    }

    drag.kind = 'none';
    drag.tokenId = undefined;
    drag.startWx = undefined;
    drag.startWy = undefined;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    camera.zoomAt(factor, sx, sy, canvas.clientWidth, canvas.clientHeight);
    store.getState().markDirty();
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { wx, wy } = screenToWorld(canvas, e);
    const s = store.getState();
    const hit = hitToken(s.tokens, wx, wy);
    if (!hit) { hideContextMenu(); return; }
    // #5 — user has discovered right-click on their own, suppress future tips.
    markRightClickTipSeen();
    s.selectToken(hit.id);
    showContextMenu(e.clientX, e.clientY, hit);
  });

  canvas.addEventListener('dblclick', (e) => {
    const { wx, wy } = screenToWorld(canvas, e);
    const hit = hitToken(store.getState().tokens, wx, wy);
    if (hit) store.getState().setOpenSheet(hit.sheetId ?? null);
  });

  // ── Drag-and-drop image upload (review §3 image map) ──────────
  // GM can drop a PNG/JPG/WebP/GIF onto the canvas to set it as the battle
  // map background. We lazy-import the upload helper so the renderer bundle
  // doesn't pull in FileReader glue on the paths that never touch it.
  canvas.addEventListener('dragover', (e) => {
    if (!e.dataTransfer) return;
    // Accept file drops *or* asset-library drags (our own MIME). The library
    // advertises the custom type on `dataTransfer.types`, so we don't have
    // to read the payload twice to decide if we should prevent default.
    const hasFile = Array.from(e.dataTransfer.items ?? []).some((it) => it.kind === 'file');
    const hasAsset = Array.from(e.dataTransfer.types ?? []).includes('application/x-vtt-asset');
    if (!hasFile && !hasAsset) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  canvas.addEventListener('drop', async (e) => {
    // Library drags are pure metadata — they carry a URL, not a File.
    // Handle them first so file uploads don't shadow a library drop.
    const { readAssetFromDataTransfer, handleAssetDrop } = await import('./assetLibrary');
    const asset = readAssetFromDataTransfer(e.dataTransfer);
    if (asset) {
      e.preventDefault();
      const { wx, wy } = screenToWorld(canvas, e);
      handleAssetDrop(asset, { wx, wy });
      return;
    }
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.preventDefault();
    if (!isGM()) { toast('Only the GM can set the map', 'warn'); return; }
    const { loadMapImage } = await import('../features/assetUpload');
    await loadMapImage(file);
  });

  // ── Touch gestures (review §2 #10 tablet support) ──────────────
  // Single-finger: route to the mouse handlers (browsers synthesise mouse
  // events by default, so this mostly "just works"). Two-finger: pinch to
  // zoom + pan. We set `touch-action: none` on the canvas so the browser
  // stops trying to handle the gesture for us.
  canvas.style.touchAction = 'none';
  let pinch: {
    startDist: number;
    startZoom: number;
    startCenter: { sx: number; sy: number };
    startCam: { x: number; y: number };
  } | null = null;

  // #21 — long-press → context menu state. Declared here so all three touch
  // handlers + `cancelLongPress` close over the same bindings.
  let longPressTimer: number | null = null;
  let longPressFired = false;
  let longPressStart: { sx: number; sy: number; tokenId: number } | null = null;
  const cancelLongPress = (): void => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressStart = null;
  };

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      cancelLongPress();
      const rect = canvas.getBoundingClientRect();
      const t0 = e.touches[0]!, t1 = e.touches[1]!;
      const dx = t1.clientX - t0.clientX;
      const dy = t1.clientY - t0.clientY;
      pinch = {
        startDist: Math.hypot(dx, dy),
        startZoom: camera.zoom,
        startCenter: {
          sx: (t0.clientX + t1.clientX) / 2 - rect.left,
          sy: (t0.clientY + t1.clientY) / 2 - rect.top
        },
        startCam: { x: camera.x, y: camera.y }
      };
      return;
    }
    // #21 — single-finger long-press opens the context menu on touch.
    // The browser synthesises mouse events from this same touch (for tap
    // select / drag), so we start the long-press timer in parallel; if it
    // fires, we cancel the in-progress mouse drag and swap to the menu.
    if (e.touches.length === 1) {
      const t = e.touches[0]!;
      const { wx, wy } = screenToWorld(canvas, { clientX: t.clientX, clientY: t.clientY } as MouseEvent);
      const hit = hitToken(store.getState().tokens, wx, wy);
      if (!hit) return;
      longPressFired = false;
      longPressStart = { sx: t.clientX, sy: t.clientY, tokenId: hit.id };
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        if (!longPressStart) return;
        const s = store.getState();
        const tok = s.tokens.find((tt) => tt.id === longPressStart!.tokenId);
        if (!tok) { longPressStart = null; return; }
        longPressFired = true;
        // If the mouse-synth drag has started on this same token, roll it back
        // to where the finger first landed so the long-press doesn't double as
        // a move command.
        if (drag.kind === 'token' && drag.tokenId === tok.id) {
          if (drag.startWx !== undefined && drag.startWy !== undefined) {
            s.moveToken(tok.id, drag.startWx, drag.startWy);
          }
          renderer.tokenDrag = null;
          drag.kind = 'none';
          drag.tokenId = undefined;
          drag.startWx = undefined;
          drag.startWy = undefined;
        }
        s.selectToken(tok.id);
        markRightClickTipSeen();
        showContextMenu(longPressStart.sx, longPressStart.sy, tok);
        s.markDirty();
      }, 450);
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    // Cancel long-press if the finger slides more than a grid cell's worth.
    if (longPressStart && !longPressFired && e.touches.length === 1) {
      const t = e.touches[0]!;
      const dx = t.clientX - longPressStart.sx;
      const dy = t.clientY - longPressStart.sy;
      if (dx * dx + dy * dy > 12 * 12) cancelLongPress();
    }
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const t0 = e.touches[0]!, t1 = e.touches[1]!;
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    const dist = Math.hypot(dx, dy);
    const ratio = dist / pinch.startDist;
    const newZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, pinch.startZoom * ratio));
    // Zoom around the initial pinch center.
    camera.zoom = newZoom;
    // Pan based on how the pinch center moved in screen space.
    const cx = (t0.clientX + t1.clientX) / 2 - rect.left;
    const cy = (t0.clientY + t1.clientY) / 2 - rect.top;
    camera.x = pinch.startCam.x - (cx - pinch.startCenter.sx) / camera.zoom;
    camera.y = pinch.startCam.y - (cy - pinch.startCenter.sy) / camera.zoom;
    store.getState().markDirty();
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinch = null;
    // If the long-press fired, swallow the synthesised click that would
    // otherwise immediately dismiss the context menu we just opened.
    if (longPressFired) {
      e.preventDefault();
      longPressFired = false;
    }
    cancelLongPress();
  }, { passive: false });
  canvas.addEventListener('touchcancel', () => { pinch = null; cancelLongPress(); });
}

function screenToWorld(canvas: HTMLCanvasElement, e: MouseEvent): { wx: number; wy: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  return camera.screenToWorld(sx, sy, canvas.clientWidth, canvas.clientHeight);
}

function hitToken(tokens: readonly Token[], wx: number, wy: number): Token | null {
  // Tokens are 0.85 grid cells; hit within their radius.
  const r = 30;
  // Iterate in reverse so top-most (last-added) wins on overlap.
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    const dx = wx - t.wx;
    const dy = wy - t.wy;
    if (dx * dx + dy * dy <= r * r) return t;
  }
  return null;
}
