import { createStore } from 'zustand/vanilla';
import type {
  AoETemplate,
  CharacterSheet,
  ChatMsg,
  ChatPlayer,
  InitiativeEntry,
  Macro,
  Role,
  Token,
  Wall
} from './schemas';

/**
 * Single source of truth.
 *
 * Design notes:
 * - Subsystems (chat, initiative, sheet, rtc, renderer) READ from here and SUBSCRIBE
 *   to relevant slices. They never mutate state by reaching into each other.
 * - All mutations go through command methods (below) so that history.ts can wrap
 *   them in undoable commands.
 * - State that does NOT need to persist (camera position, dragging, currentTool,
 *   rendering dirty flag) lives in Transient — kept out of Scene for export.
 */

export interface Layers {
  map: boolean;
  grid: boolean;
  tokens: boolean;
  overlay: boolean;
  fog: boolean;
}

export interface Initiative {
  order: InitiativeEntry[];
  current: number;
  round: number;
}

export interface State {
  // ── Persisted scene state ──
  role: Role;
  currentUserId: string;
  tokens: Token[];
  walls: Wall[];
  sheets: Record<string, CharacterSheet>;
  aoeTemplates: AoETemplate[];
  chat: ChatMsg[];
  macros: Macro[];
  players: ChatPlayer[];
  initiative: Initiative;
  layers: Layers;
  fogEnabled: boolean;
  /**
   * Manual fog-of-war (review §2 #7). Set of "cx,cy" grid-cell keys the GM
   * has explicitly revealed. When `manualFogEnabled` is on, any cell NOT in
   * this set is hidden from players. Stored as a sorted string[] so scene
   * JSON round-trips cleanly via Zod.
   */
  manualFog: string[];
  manualFogEnabled: boolean;
  /** Uploaded battle-map image — data-URL or http URL, or null for procedural. */
  mapImage: string | null;

  // ── Transient UI state (NOT persisted) ──
  selectedTokenId: number | null;
  currentTool: 'select' | 'measure' | 'wall' | 'aoe' | 'fogbrush';
  aoeShape: 'sphere' | 'cone' | 'line' | 'cube';
  fogBrushMode: 'reveal' | 'hide';
  aoeSize: number; // feet
  openSheetId: string | null;
  dirty: boolean; // renderer dirty flag
  nextTokenId: number;
  nextChatId: number;
  /**
   * "Speaking as" identity (review §2 #11). `null` means the user speaks as
   * themselves (the player row matching `currentUserId`). Otherwise one of:
   *   - a player id ("p1", "p2", …) — speak as that PC
   *   - "token:<id>" — speak as an NPC/enemy token the GM controls
   * Persistence-free: transient UI state.
   */
  speakingAs: string | null;

  // ── Commands (mutations) ──
  replace: (patch: Partial<State>) => void;
  setRole: (r: Role) => void;
  setCurrentUser: (id: string) => void;
  setSpeakingAs: (id: string | null) => void;
  setTool: (t: State['currentTool']) => void;
  setAoeShape: (s: State['aoeShape']) => void;
  setAoeSize: (n: number) => void;

  addToken: (t: Token) => void;
  updateToken: (id: number, patch: Partial<Token>) => void;
  removeToken: (id: number) => void;
  selectToken: (id: number | null) => void;
  moveToken: (id: number, wx: number, wy: number) => void;

  addWall: (w: Wall) => void;
  removeWallAt: (index: number) => void;
  clearWalls: () => void;
  replaceWalls: (ws: Wall[]) => void;

  addSheet: (s: CharacterSheet) => void;
  updateSheet: (id: string, patch: Partial<CharacterSheet>) => void;
  setOpenSheet: (id: string | null) => void;

  addAoE: (a: AoETemplate) => void;
  removeAoE: (id: string) => void;
  clearAoE: () => void;

  addChat: (m: Omit<ChatMsg, 'id' | 'time'> & { time?: number }) => void;
  clearChat: () => void;

  setInitiative: (i: Initiative) => void;
  nextInitiative: () => InitiativeEntry | null;
  /** Update one entry's roll and re-sort, keeping `current` pointing to the same entry. */
  setInitiativeRoll: (id: number, roll: number) => void;
  /** Remove one entry from initiative; keeps `current` valid. */
  removeFromInitiative: (id: number) => void;
  /** Add a token to initiative in sorted position; caller supplies the rolled value. */
  addToInitiative: (entry: InitiativeEntry) => void;
  /** Move the currently-acting entry to the end of the round (acts last). */
  delayCurrentTurn: () => InitiativeEntry | null;

  addMacro: (m: Macro) => void;
  removeMacro: (key: string) => void;

  toggleLayer: (k: keyof Layers) => void;
  setFog: (on: boolean) => void;

  setFogBrushMode: (mode: 'reveal' | 'hide') => void;
  setManualFogEnabled: (on: boolean) => void;
  applyFogBrush: (cells: string[], mode: 'reveal' | 'hide') => void;
  clearManualFog: () => void;
  replaceManualFog: (cells: string[]) => void;

  /** Set or clear the uploaded map image. Passing null reverts to procedural. */
  setMapImage: (url: string | null) => void;

  markDirty: () => void;
  clearDirty: () => void;

  loadScene: (s: Partial<State>) => void;
}

/** Short helper to generate stable IDs for things that need them. */
export function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const store = createStore<State>((set, get) => ({
  role: 'gm',
  currentUserId: 'dm',
  tokens: [],
  walls: [],
  sheets: {},
  aoeTemplates: [],
  chat: [],
  macros: [],
  players: [],
  initiative: { order: [], current: 0, round: 1 },
  layers: { map: true, grid: true, tokens: true, overlay: true, fog: true },
  fogEnabled: false,
  manualFog: [],
  manualFogEnabled: false,
  mapImage: null,

  selectedTokenId: null,
  currentTool: 'select',
  fogBrushMode: 'reveal',
  aoeShape: 'sphere',
  aoeSize: 20,
  openSheetId: null,
  dirty: true,
  nextTokenId: 1,
  nextChatId: 1,
  speakingAs: null,

  replace: (patch) => set({ ...patch, dirty: true }),

  setRole: (role) => set({ role, dirty: true }),
  setCurrentUser: (id) => set({ currentUserId: id }),
  setSpeakingAs: (id) => set({ speakingAs: id }),
  setTool: (t) => set({ currentTool: t, dirty: true }),
  setAoeShape: (s) => set({ aoeShape: s, dirty: true }),
  setAoeSize: (n) => set({ aoeSize: n, dirty: true }),

  addToken: (t) => set((s) => ({ tokens: [...s.tokens, t], nextTokenId: Math.max(s.nextTokenId, t.id + 1), dirty: true })),
  updateToken: (id, patch) =>
    set((s) => ({
      tokens: s.tokens.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      dirty: true
    })),
  removeToken: (id) =>
    set((s) => ({
      tokens: s.tokens.filter((t) => t.id !== id),
      selectedTokenId: s.selectedTokenId === id ? null : s.selectedTokenId,
      initiative: { ...s.initiative, order: s.initiative.order.filter((e) => e.id !== id) },
      dirty: true
    })),
  selectToken: (id) => set({ selectedTokenId: id, dirty: true }),
  moveToken: (id, wx, wy) =>
    set((s) => ({
      tokens: s.tokens.map((t) => (t.id === id ? { ...t, wx, wy } : t)),
      dirty: true
    })),

  addWall: (w) => set((s) => ({ walls: [...s.walls, w], dirty: true })),
  removeWallAt: (index) => set((s) => ({ walls: s.walls.filter((_, i) => i !== index), dirty: true })),
  clearWalls: () => set({ walls: [], dirty: true }),
  replaceWalls: (ws) => set({ walls: ws, dirty: true }),

  addSheet: (sheet) => set((s) => ({ sheets: { ...s.sheets, [sheet.id]: sheet } })),
  updateSheet: (id, patch) =>
    set((s) => {
      const existing = s.sheets[id];
      if (!existing) return {};
      return { sheets: { ...s.sheets, [id]: { ...existing, ...patch } }, dirty: true };
    }),
  setOpenSheet: (id) => set({ openSheetId: id }),

  addAoE: (a) => set((s) => ({ aoeTemplates: [...s.aoeTemplates, a], dirty: true })),
  removeAoE: (id) => set((s) => ({ aoeTemplates: s.aoeTemplates.filter((a) => a.id !== id), dirty: true })),
  clearAoE: () => set({ aoeTemplates: [], dirty: true }),

  addChat: (m) =>
    set((s) => {
      const id = s.nextChatId;
      const time = m.time ?? Date.now();
      const msg: ChatMsg = { ...m, id, time } as ChatMsg;
      // Bounded ring buffer.
      const next = [...s.chat, msg];
      if (next.length > 200) next.splice(0, next.length - 200);
      return { chat: next, nextChatId: id + 1 };
    }),
  clearChat: () => set({ chat: [] }),

  setInitiative: (i) => set({ initiative: i, dirty: true }),
  nextInitiative: () => {
    const s = get();
    if (!s.initiative.order.length) return null;
    const nextIdx = (s.initiative.current + 1) % s.initiative.order.length;
    const round = nextIdx === 0 ? s.initiative.round + 1 : s.initiative.round;
    set({ initiative: { ...s.initiative, current: nextIdx, round }, dirty: true });
    return s.initiative.order[nextIdx] ?? null;
  },
  setInitiativeRoll: (id, rollVal) =>
    set((s) => {
      const currentEntry = s.initiative.order[s.initiative.current];
      const patched = s.initiative.order.map((e) => (e.id === id ? { ...e, roll: rollVal } : e));
      patched.sort((a, b) => b.roll - a.roll);
      const current = currentEntry ? Math.max(0, patched.findIndex((e) => e.id === currentEntry.id)) : 0;
      return { initiative: { ...s.initiative, order: patched, current }, dirty: true };
    }),
  removeFromInitiative: (id) =>
    set((s) => {
      if (!s.initiative.order.length) return {};
      const currentEntry = s.initiative.order[s.initiative.current];
      const order = s.initiative.order.filter((e) => e.id !== id);
      if (!order.length) {
        return { initiative: { order: [], current: 0, round: 1 }, dirty: true };
      }
      // If the removed entry was the current one, the slot advances naturally;
      // otherwise keep current pointing to the same entry by id.
      let current = 0;
      if (currentEntry && currentEntry.id !== id) {
        const idx = order.findIndex((e) => e.id === currentEntry.id);
        current = idx >= 0 ? idx : 0;
      } else {
        current = s.initiative.current % order.length;
      }
      return { initiative: { ...s.initiative, order, current }, dirty: true };
    }),
  addToInitiative: (entry) =>
    set((s) => {
      if (s.initiative.order.some((e) => e.id === entry.id)) return {};
      const currentEntry = s.initiative.order[s.initiative.current];
      const order = [...s.initiative.order, entry];
      order.sort((a, b) => b.roll - a.roll);
      const current = currentEntry ? Math.max(0, order.findIndex((e) => e.id === currentEntry.id)) : 0;
      return { initiative: { ...s.initiative, order, current }, dirty: true };
    }),
  delayCurrentTurn: () => {
    const s = get();
    const { order, current, round } = s.initiative;
    if (order.length < 2) return null;
    const entry = order[current];
    if (!entry) return null;
    // Find the smallest roll in the round; delayed entry goes just below it.
    let min = Infinity;
    for (const e of order) if (e.roll < min) min = e.roll;
    const bumped: InitiativeEntry = { ...entry, roll: (min === Infinity ? 0 : min) - 1 };
    // Rebuild order: same as before, patched + re-sorted; current stays at the
    // slot previously held by current (which now holds the next actor).
    const next = order.map((e) => (e.id === entry.id ? bumped : e));
    next.sort((a, b) => b.roll - a.roll);
    // The original `current` slot position now holds the next actor after the
    // delayed one. Clamp to the valid range.
    const nextIdx = Math.min(current, next.length - 1);
    set({ initiative: { order: next, current: nextIdx, round }, dirty: true });
    return next[nextIdx] ?? null;
  },

  addMacro: (m) =>
    set((s) => ({
      macros: [...s.macros.filter((x) => x.key !== m.key), m]
    })),
  removeMacro: (key) => set((s) => ({ macros: s.macros.filter((m) => m.key !== key) })),

  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] }, dirty: true })),
  setFog: (on) => set({ fogEnabled: on, dirty: true }),

  setFogBrushMode: (mode) => set({ fogBrushMode: mode }),
  setManualFogEnabled: (on) => set({ manualFogEnabled: on, dirty: true }),
  applyFogBrush: (cells, mode) =>
    set((s) => {
      const set_ = new Set(s.manualFog);
      if (mode === 'reveal') for (const c of cells) set_.add(c);
      else for (const c of cells) set_.delete(c);
      const arr = Array.from(set_);
      arr.sort();
      return { manualFog: arr, dirty: true };
    }),
  clearManualFog: () => set({ manualFog: [], dirty: true }),
  replaceManualFog: (cells) => {
    const arr = [...cells];
    arr.sort();
    set({ manualFog: arr, dirty: true });
  },

  setMapImage: (url) => set({ mapImage: url, dirty: true }),

  markDirty: () => set({ dirty: true }),
  clearDirty: () => set({ dirty: false }),

  loadScene: (p) => set({ ...p, dirty: true })
}));

/** Shorthand alias for subscribers. */
export const getState = store.getState;
