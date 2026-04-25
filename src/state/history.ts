import type { State } from './store';
import { store } from './store';
import { distanceFt } from '../engine/grid';

/**
 * #6 — look up a token's current name for undo labels. Labels are baked at
 * command-creation time, so later renames don't retroactively change history
 * text (which is fine — users want the label to reflect what they saw at the
 * moment of the action).
 */
function tokenName(id: number): string {
  return store.getState().tokens.find((t) => t.id === id)?.name ?? `token ${id}`;
}

/**
 * Undo/redo history (review item #7).
 *
 * Design: commands are plain objects with `do()` and `undo()`. We don't diff
 * the store — subsystems push explicit commands when they perform an undoable
 * action (move token, delete token, add wall, apply damage, etc.).
 *
 * Unbundled mutations (camera pan, selection, tool switch, chat messages) do
 * not go through commands — they are transient UI state.
 */
export interface Command {
  label: string;
  do(): void;
  undo(): void;
}

const MAX_HISTORY = 100;
const undoStack: Command[] = [];
const redoStack: Command[] = [];

export function execute(cmd: Command): void {
  cmd.do();
  undoStack.push(cmd);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
}

export function undo(): string | null {
  const cmd = undoStack.pop();
  if (!cmd) return null;
  cmd.undo();
  redoStack.push(cmd);
  return cmd.label;
}

export function redo(): string | null {
  const cmd = redoStack.pop();
  if (!cmd) return null;
  cmd.do();
  undoStack.push(cmd);
  return cmd.label;
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}
export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function clearHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
}

// ── Prebuilt command factories ────────────────────────────────────

export function cmdMoveToken(id: number, from: { wx: number; wy: number }, to: { wx: number; wy: number }): Command {
  const name = tokenName(id);
  const ft = Math.round(distanceFt(from.wx, from.wy, to.wx, to.wy));
  const label = ft > 0 ? `moved ${name} ${ft}ft` : `moved ${name}`;
  return {
    label,
    do: () => store.getState().moveToken(id, to.wx, to.wy),
    undo: () => store.getState().moveToken(id, from.wx, from.wy)
  };
}

export function cmdAddToken(token: State['tokens'][number]): Command {
  return {
    label: `added ${token.name}`,
    do: () => store.getState().addToken(token),
    undo: () => store.getState().removeToken(token.id)
  };
}

export function cmdRemoveToken(token: State['tokens'][number]): Command {
  return {
    label: `removed ${token.name}`,
    do: () => store.getState().removeToken(token.id),
    undo: () => store.getState().addToken(token)
  };
}

export function cmdAddWall(wall: State['walls'][number]): Command {
  return {
    label: 'added wall segment',
    do: () => store.getState().addWall(wall),
    undo: () => {
      const s = store.getState();
      const idx = s.walls.lastIndexOf(wall);
      if (idx >= 0) s.removeWallAt(idx);
    }
  };
}

export function cmdClearWalls(previous: State['walls']): Command {
  const n = previous.length;
  return {
    label: `cleared ${n} wall${n === 1 ? '' : 's'}`,
    do: () => store.getState().clearWalls(),
    undo: () => store.getState().replaceWalls(previous)
  };
}

export function cmdApplyHp(id: number, before: number, after: number): Command {
  const name = tokenName(id);
  const delta = after - before;
  const label =
    delta === 0 ? `HP unchanged on ${name}` :
    delta > 0 ? `healed ${name} +${delta}` :
    `damaged ${name} ${delta}`;
  return {
    label,
    do: () => store.getState().updateToken(id, { hp: after } as Partial<State['tokens'][number]>),
    undo: () => store.getState().updateToken(id, { hp: before } as Partial<State['tokens'][number]>)
  };
}

/**
 * Bundle several commands into a single undoable unit. `do()` runs them in
 * order, `undo()` reverses them in opposite order. Use when one user-visible
 * action maps to two or more atomic mutations (e.g. damage → kill, where the
 * user expects one Undo to revert both the HP change and the removal).
 */
export function cmdSequence(label: string, parts: Command[]): Command {
  return {
    label,
    do: () => { for (const p of parts) p.do(); },
    undo: () => { for (let i = parts.length - 1; i >= 0; i--) parts[i]!.undo(); }
  };
}

export function cmdAddAoE(a: State['aoeTemplates'][number]): Command {
  return {
    label: `added ${a.shape} template`,
    do: () => store.getState().addAoE(a),
    undo: () => store.getState().removeAoE(a.id)
  };
}

export function cmdRemoveAoE(a: State['aoeTemplates'][number]): Command {
  return {
    label: `removed ${a.shape} template`,
    do: () => store.getState().removeAoE(a.id),
    undo: () => store.getState().addAoE(a)
  };
}
