import { store } from '../state/store';
import type { Token } from '../state/schemas';

/**
 * Role rules (review item #3).
 *
 * A user is either 'gm' or 'player'. In player mode:
 *   - Walls tool and fog-toggle are hidden.
 *   - Token-spawn button is hidden.
 *   - Monster HP on tokens is hidden in the list (a dash is shown instead).
 *   - Token movement is restricted to tokens the player owns.
 *   - Chat messages tagged with visibility: ['dm'] are hidden.
 */

export function isGM(): boolean {
  return store.getState().role === 'gm';
}

export function canEditWalls(): boolean {
  return isGM();
}

export function canToggleFog(): boolean {
  return isGM();
}

export function canSpawnTokens(): boolean {
  return isGM();
}

export function canMoveToken(tok: Token): boolean {
  if (isGM()) return true;
  return tok.ownerId === store.getState().currentUserId;
}

export function canSeeTokenHp(tok: Token): boolean {
  if (isGM()) return true;
  // Players see their own token HP and their allies' (any non-enemy) HP.
  if (tok.type === 'enemy') return false;
  return true;
}

export function canSeeMessage(msg: { visibility?: string[] }): boolean {
  if (!msg.visibility) return true;
  const uid = store.getState().currentUserId;
  return msg.visibility.includes(uid);
}
