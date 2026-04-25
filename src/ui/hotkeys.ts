import { store } from '../state/store';
import { execute, undo, redo, cmdRemoveToken } from '../state/history';
import { rollInitiative, nextTurn } from '../features/initiative';
import { runByKey } from '../features/macros';
import { openHotkeyOverlay, closeHotkeyOverlay } from './hotkeyOverlay';
import { toast } from './toast';
import { camera } from '../engine/camera';
import { canEditWalls, canSpawnTokens, canToggleFog } from '../features/roles';
import { spawnRandomToken } from '../features/spawn';

/**
 * Keyboard shortcut registry + global listener.
 *
 * Phase-5 had ad-hoc keyboard handlers scattered through the main script. Here
 * the list of shortcuts is data, rendered by `hotkeyOverlay.ts` and dispatched
 * by this file. Inputs swallow most keys so typing in chat won't fire tools.
 */

export interface HotkeyDef {
  /** Display label in the cheatsheet — e.g. "Ctrl+Z" */
  label: string;
  /** Group heading — e.g. "Tools" */
  group: string;
  /** One-line description for the overlay */
  description: string;
  /** Matcher — receives the event and returns true to fire `run` */
  match: (e: KeyboardEvent) => boolean;
  /** Action to run */
  run: () => void;
  /** If true, prevents default + stopPropagation when fired */
  preventDefault?: boolean;
  /** If true, hidden from the cheatsheet (e.g. arrow-key nudges) */
  hidden?: boolean;
}

const k = (key: string) => (e: KeyboardEvent) =>
  e.key.toLowerCase() === key.toLowerCase() && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

export const HOTKEYS: HotkeyDef[] = [
  {
    label: 'S', group: 'Tools', description: 'Select tool',
    match: k('s'), run: () => store.getState().setTool('select'), preventDefault: true
  },
  {
    label: 'M', group: 'Tools', description: 'Measure tool',
    match: k('m'), run: () => store.getState().setTool('measure'), preventDefault: true
  },
  {
    label: 'W', group: 'Tools', description: 'Wall tool (GM only)',
    match: k('w'),
    run: () => {
      if (!canEditWalls()) { toast('Walls are GM-only', 'warn'); return; }
      store.getState().setTool('wall');
    },
    preventDefault: true
  },
  {
    label: 'T', group: 'Tools', description: 'AoE template tool',
    match: k('t'), run: () => store.getState().setTool('aoe'), preventDefault: true
  },
  {
    label: 'Shift+F', group: 'Tools', description: 'Manual fog brush (GM only)',
    match: (e) => e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f',
    run: () => {
      if (!canToggleFog()) { toast('Fog brush is GM-only', 'warn'); return; }
      store.getState().setTool('fogbrush');
    },
    preventDefault: true
  },
  {
    label: 'G', group: 'View', description: 'Toggle grid',
    match: k('g'), run: () => store.getState().toggleLayer('grid'), preventDefault: true
  },
  {
    label: 'V', group: 'View', description: 'Toggle vision / fog',
    match: k('v'),
    run: () => {
      const s = store.getState();
      s.setFog(!s.fogEnabled);
      toast(s.fogEnabled ? '🌫 Vision enabled' : '☀ Vision off', s.fogEnabled ? 'ok' : 'warn');
    },
    preventDefault: true
  },
  {
    label: 'I', group: 'Initiative', description: 'Roll initiative',
    match: k('i'), run: () => rollInitiative(), preventDefault: true
  },
  {
    label: 'Space', group: 'Initiative', description: 'Next turn',
    match: (e) => e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey,
    run: () => nextTurn(),
    preventDefault: true
  },
  {
    label: 'N', group: 'Tokens', description: 'Spawn random token (GM)',
    match: k('n'),
    run: () => {
      if (!canSpawnTokens()) { toast('Spawn is GM-only', 'warn'); return; }
      spawnRandomToken();
    },
    preventDefault: true
  },
  {
    label: 'Del / Backspace', group: 'Tokens', description: 'Remove selected token (GM)',
    match: (e) => (e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey,
    run: () => {
      const s = store.getState();
      if (s.role !== 'gm' || s.selectedTokenId === null) return;
      const tok = s.tokens.find((t) => t.id === s.selectedTokenId);
      if (!tok) return;
      execute(cmdRemoveToken(tok));
      toast(`${tok.name} removed`, 'warn');
    },
    preventDefault: true
  },
  {
    label: 'F1–F6', group: 'Macros', description: 'Run macro bound to F-key',
    match: (e) => /^F[1-9]$|^F1[0-2]$/.test(e.key),
    run: () => { /* handled by matchFKey below */ },
    hidden: true
  },
  {
    label: 'Ctrl+Z', group: 'History', description: 'Undo last action',
    match: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z',
    run: () => {
      const label = undo();
      toast(label ? `Undo: ${label}` : 'Nothing to undo', label ? 'ok' : 'warn');
    },
    preventDefault: true
  },
  {
    label: 'Ctrl+Shift+Z / Ctrl+Y', group: 'History', description: 'Redo',
    match: (e) =>
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
      ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'y'),
    run: () => {
      const label = redo();
      toast(label ? `Redo: ${label}` : 'Nothing to redo', label ? 'ok' : 'warn');
    },
    preventDefault: true
  },
  {
    label: '+ / =', group: 'Camera', description: 'Zoom in',
    match: (e) => (e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey,
    run: () => {
      camera.zoom = Math.min(camera.maxZoom, camera.zoom + 0.15);
      store.getState().markDirty();
    }
  },
  {
    label: '−', group: 'Camera', description: 'Zoom out',
    match: (e) => (e.key === '-' || e.key === '_') && !e.ctrlKey && !e.metaKey,
    run: () => {
      camera.zoom = Math.max(camera.minZoom, camera.zoom - 0.15);
      store.getState().markDirty();
    }
  },
  {
    label: '0', group: 'Camera', description: 'Reset zoom to 100%',
    match: k('0'),
    run: () => { camera.zoom = 1; store.getState().markDirty(); },
    preventDefault: true
  },
  {
    label: 'Arrows', group: 'Camera', description: 'Pan camera',
    match: (e) => ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !e.ctrlKey && !e.metaKey,
    run: () => { /* handled inline to read the specific key */ },
    hidden: true
  },
  {
    label: '?', group: 'Help', description: 'Show / hide this shortcut list',
    match: (e) => (e.key === '?' || (e.key === '/' && e.shiftKey)),
    run: () => {
      const overlay = document.getElementById('hotkey-overlay');
      if (overlay && !overlay.hidden) closeHotkeyOverlay(); else openHotkeyOverlay();
    },
    preventDefault: true
  },
  {
    label: 'Esc', group: 'Help', description: 'Close overlays / clear selection',
    match: (e) => e.key === 'Escape',
    run: () => {
      const overlay = document.getElementById('hotkey-overlay');
      if (overlay && !overlay.hidden) { closeHotkeyOverlay(); return; }
      const s = store.getState();
      if (s.openSheetId) { s.setOpenSheet(null); return; }
      if (s.selectedTokenId !== null) s.selectToken(null);
    }
  }
];

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function installHotkeys(): void {
  document.addEventListener('keydown', (e) => {
    // Let typing proceed in inputs unless it's a modifier combo (Ctrl+Z etc).
    if (isTypingTarget(e.target) && !e.ctrlKey && !e.metaKey && e.key !== 'Escape') return;

    // F-key macros — look up by key label.
    if (/^F[1-9]$|^F1[0-2]$/.test(e.key)) {
      runByKey(e.key);
      e.preventDefault();
      return;
    }

    // Arrow-key nudges for pan — not listed in registry to avoid duplication.
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !e.ctrlKey && !e.metaKey) {
      if (isTypingTarget(e.target)) return;
      const step = 60 / camera.zoom;
      if (e.key === 'ArrowUp') camera.y -= step;
      else if (e.key === 'ArrowDown') camera.y += step;
      else if (e.key === 'ArrowLeft') camera.x -= step;
      else camera.x += step;
      store.getState().markDirty();
      e.preventDefault();
      return;
    }

    for (const hk of HOTKEYS) {
      if (hk.hidden) continue; // arrow/F-keys handled above
      if (hk.match(e)) {
        if (hk.preventDefault) { e.preventDefault(); e.stopPropagation(); }
        hk.run();
        return;
      }
    }
  });
}
