import { SceneSchema, type Scene } from './schemas';
import { store, type State } from './store';
import { debounce } from '../utils/events';
import { ZodError } from 'zod';

/**
 * Persistence (review item #8).
 *
 * - Autosave: on every mutation, debounce-write a snapshot of the scene slice to localStorage.
 * - Export: serialise scene slice → JSON file download.
 * - Import: read a JSON file → validate via Zod → loadScene.
 *
 * localStorage is fine for now (scene JSON is ~10-50 KB). Swap in idb-keyval once
 * scenes include image assets.
 */
const STORAGE_KEY = 'vtt:phase6:scene';

function pickScene(s: State): Scene {
  // NOTE: `role` and `currentUserId` are *identity*, not scene data. They are
  // chosen at the login screen on every boot and must NOT round-trip through
  // the saved scene — otherwise a scene last saved by the GM would force every
  // subsequent player login back into GM view.
  return {
    version: 6,
    tokens: s.tokens,
    walls: s.walls,
    sheets: s.sheets,
    aoeTemplates: s.aoeTemplates,
    chat: s.chat,
    macros: s.macros,
    players: s.players,
    initiative: s.initiative,
    layers: s.layers,
    fogEnabled: s.fogEnabled,
    manualFog: s.manualFog,
    manualFogEnabled: s.manualFogEnabled,
    mapImage: s.mapImage
  };
}

export function saveNow(): void {
  try {
    const snapshot = pickScene(store.getState());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // Storage full, private mode, etc. — fail silently; this is best-effort.
    console.warn('[persistence] save failed', err);
  }
}

const debouncedSave = debounce(saveNow, 400);

export function initAutosave(): void {
  // Subscribe to ALL state changes; persist only scene slice fields.
  store.subscribe((s, prev) => {
    // Skip if only transient fields changed.
    // role + currentUserId are session identity, not scene data — see
    // `pickScene` for the rationale. Don't trigger autosave on those.
    const sceneKeys: (keyof State)[] = [
      'tokens', 'walls', 'sheets', 'aoeTemplates',
      'chat', 'macros', 'players', 'initiative', 'layers', 'fogEnabled',
      'manualFog', 'manualFogEnabled', 'mapImage'
    ];
    for (const k of sceneKeys) {
      if (s[k] !== prev[k]) {
        debouncedSave();
        return;
      }
    }
  });
}

export function loadFromStorage(): Scene | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return SceneSchema.parse(parsed);
  } catch (err) {
    console.warn('[persistence] invalid saved scene, ignoring', err);
    return null;
  }
}

export function exportJson(): void {
  const snapshot = pickScene(store.getState());
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  a.download = `vtt-scene-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * #8 — translate a Zod error into a plain-language description of the
 * first problem encountered, so the import toast is actionable instead of
 * `Invalid scene: Expected array at …`. The raw Zod error is left in
 * `console.warn` for debugging.
 */
export function describeSceneError(err: unknown): string {
  if (err instanceof ZodError) {
    console.warn('[persistence] scene validation failed', err);
    const issue = err.issues[0];
    if (!issue) return 'Scene file does not match the expected format.';
    const path = issue.path.length ? issue.path.join('.') : 'file';
    switch (issue.code) {
      case 'invalid_type':
        return `${path}: expected ${issue.expected}, got ${issue.received}.`;
      case 'invalid_literal':
        if (path === 'version') {
          return `Scene version mismatch (expected ${String(issue.expected)}). Re-export the file from Phase 6.`;
        }
        return `${path}: unexpected value.`;
      case 'too_small':
        return `${path}: value is too small or field is empty.`;
      case 'too_big':
        return `${path}: value is too large.`;
      case 'unrecognized_keys':
        return `${path}: contains unknown fields.`;
      default:
        return `${path}: ${issue.message}`;
    }
  }
  if (err instanceof SyntaxError) {
    return 'File is not valid JSON. Was it edited by hand?';
  }
  return (err as Error)?.message ?? 'Unknown error.';
}

export async function importJsonFromFile(file: File): Promise<Scene> {
  const text = await file.text();
  try {
    return SceneSchema.parse(JSON.parse(text));
  } catch (err) {
    // Wrap so toolbar.ts can surface a friendly message without knowing
    // about Zod internals.
    throw new Error(describeSceneError(err));
  }
}

export function applyScene(scene: Scene): void {
  // Defense in depth: even if a saved scene from an earlier build still has
  // `role`/`currentUserId` baked in, never let it overwrite the post-login
  // identity that was just established by `awaitLogin`.
  const { role: _role, currentUserId: _uid, ...sceneOnly } =
    scene as Scene & { role?: unknown; currentUserId?: unknown };
  void _role; void _uid;
  store.getState().loadScene(sceneOnly as unknown as Partial<State>);
}

export function clearSaved(): void {
  localStorage.removeItem(STORAGE_KEY);
}
