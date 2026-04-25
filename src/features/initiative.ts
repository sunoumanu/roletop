import { store } from '../state/store';
import type { InitiativeEntry } from '../state/schemas';
import { roll, isError } from '../engine/dice';
import { ensureSheetForToken, initiativeBonus } from './sheet';
import { toast } from '../ui/toast';
import { CONDITIONS_BY_ID, tickRound } from '../engine/conditions';

/**
 * Initiative tracker.
 *
 * Fixes the phase-5 bug where every creature got a random DEX mod between
 * -1 and +4 — now we ensure each token has a sheet, then use its DEX mod.
 * Conditions with a duration decrement as we advance initiative.
 */

export function rollInitiative(): void {
  const s = store.getState();
  const order: InitiativeEntry[] = s.tokens.map((tok) => {
    const sheet = ensureSheetForToken(tok.id);
    const mod = sheet ? initiativeBonus(sheet) : 0;
    const r = roll(`1d20${mod >= 0 ? `+${mod}` : `${mod}`}`);
    const rollVal = isError(r) ? 10 : r.total;
    return { id: tok.id, name: tok.name, color: tok.color, roll: rollVal, hp: tok.hp, maxHp: tok.maxHp };
  });
  order.sort((a, b) => b.roll - a.roll);
  s.setInitiative({ order, current: 0, round: 1 });
  s.addChat({ type: 'system', body: '⏱ Initiative rolled — Round 1 begins' });
  s.addChat({ type: 'div', body: '── Round 1 ──' });
  order.forEach((e) => s.addChat({ type: 'system', body: `${e.name}: ${e.roll}` }));
  toast('Initiative rolled', 'ok');
}

export function nextTurn(): void {
  const state = store.getState();
  const before = state.initiative;
  const entry = state.nextInitiative();
  if (!entry) return;

  const after = store.getState().initiative;

  // Tick conditions on the creature whose turn JUST ended.
  const endingId = before.order[before.current]?.id;
  if (endingId !== undefined) tickTokenConditions(endingId);

  if (after.round !== before.round) {
    store.getState().addChat({ type: 'div', body: `── Round ${after.round} ──` });
  }
  store.getState().addChat({ type: 'system', body: `⏱ ${entry.name}'s turn` });
}

export function reset(): void {
  store.getState().setInitiative({ order: [], current: 0, round: 1 });
}

/**
 * Roll a single token into initiative mid-combat (§2 #9). Ensures the token
 * has a sheet, applies the real dex-based initiative bonus, and inserts it
 * into the existing order in sorted position.
 */
export function addTokenToInitiative(tokenId: number): void {
  const s = store.getState();
  const tok = s.tokens.find((t) => t.id === tokenId);
  if (!tok) return;
  if (s.initiative.order.some((e) => e.id === tokenId)) {
    toast(`${tok.name} is already in initiative`, 'warn');
    return;
  }
  const sheet = ensureSheetForToken(tok.id);
  const mod = sheet ? initiativeBonus(sheet) : 0;
  const r = roll(`1d20${mod >= 0 ? `+${mod}` : `${mod}`}`);
  const rollVal = isError(r) ? 10 : r.total;
  s.addToInitiative({
    id: tok.id,
    name: tok.name,
    color: tok.color,
    roll: rollVal,
    hp: tok.hp,
    maxHp: tok.maxHp
  });
  store.getState().addChat({ type: 'system', body: `⏱ ${tok.name} joined initiative (${rollVal})` });
  toast(`${tok.name}: ${rollVal}`, 'ok');
}

/**
 * Delay the current actor's turn — they go last in the round but don't drop
 * out. Announced in chat so everyone knows what's happening.
 */
export function delayTurn(): void {
  const s = store.getState();
  const acting = s.initiative.order[s.initiative.current];
  if (!acting) return;
  const next = s.delayCurrentTurn();
  if (!next) return;
  store.getState().addChat({
    type: 'system',
    body: `⏳ ${acting.name} delays — ${next.name}'s turn`
  });
  toast(`${acting.name} delayed`, 'warn');
}

/**
 * Reset initiative and offer a soft-delete Undo (§2 #14). Callers pass a
 * toaster that knows how to display the "Undo" action — this keeps UI-only
 * dependencies (toast imports) out of features/.
 */
export function resetWithUndo(offerUndo: (restore: () => void, count: number) => void): void {
  const s = store.getState();
  if (!s.initiative.order.length) return;
  const before = { order: [...s.initiative.order], current: s.initiative.current, round: s.initiative.round };
  s.setInitiative({ order: [], current: 0, round: 1 });
  offerUndo(() => store.getState().setInitiative(before), before.order.length);
}

function tickTokenConditions(tokenId: number): void {
  const s = store.getState();
  const tok = s.tokens.find((t) => t.id === tokenId);
  if (!tok || !tok.sheetId) return;
  const sheet = s.sheets[tok.sheetId];
  if (!sheet) return;
  const { remaining, expired } = tickRound(sheet.conditions);
  if (!expired.length && remaining.length === sheet.conditions.length) return;
  s.updateSheet(sheet.id, { conditions: remaining });
  for (const id of expired) {
    const def = CONDITIONS_BY_ID.get(id);
    s.addChat({ type: 'system', body: `⧗ ${tok.name}'s ${def?.label ?? id} ended` });
  }
}
