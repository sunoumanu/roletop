import type { AbilityScores, CharacterSheet } from '../state/schemas';
import { store, nextId } from '../state/store';

/**
 * Character sheet helpers (review item #4).
 *
 * A token has a `sheetId`. All rolls that should pull from the sheet (attacks,
 * saves, skills) go through the helpers below, replacing the hardcoded
 * `1d20+5` that phase 5 used for every attack.
 */

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function saveBonus(sheet: CharacterSheet, ability: keyof AbilityScores): number {
  const base = abilityMod(sheet.abilities[ability]);
  return sheet.saves[ability] ? base + sheet.proficiency : base;
}

export function initiativeBonus(sheet: CharacterSheet): number {
  return abilityMod(sheet.abilities.dex);
}

export function attackRollExpr(sheet: CharacterSheet, abilityKey: keyof AbilityScores = 'str', proficient = true): string {
  const bonus = abilityMod(sheet.abilities[abilityKey]) + (proficient ? sheet.proficiency : 0);
  return bonus >= 0 ? `1d20+${bonus}` : `1d20${bonus}`;
}

export function defaultSheet(name: string): CharacterSheet {
  return {
    id: nextId(),
    name,
    level: 1,
    classLabel: '',
    ac: 12,
    speed: 30,
    hp: 10,
    maxHp: 10,
    tempHp: 0,
    deathSaves: { successes: 0, failures: 0 },
    abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    saves: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
    proficiency: 2,
    passivePerception: 10,
    notes: '',
    conditions: []
  };
}

/** Get (creating if missing) the sheet for a given token id. */
export function ensureSheetForToken(tokenId: number): CharacterSheet | null {
  const s = store.getState();
  const tok = s.tokens.find((t) => t.id === tokenId);
  if (!tok) return null;
  if (tok.sheetId && s.sheets[tok.sheetId]) return s.sheets[tok.sheetId]!;
  const sheet = defaultSheet(tok.name);
  // HP mirrors the token's current HP so the two stay in sync on creation.
  sheet.hp = tok.hp;
  sheet.maxHp = tok.maxHp;
  s.addSheet(sheet);
  s.updateToken(tok.id, { sheetId: sheet.id } as Partial<typeof tok>);
  return sheet;
}

export function getSheetForToken(tokenId: number): CharacterSheet | null {
  const s = store.getState();
  const tok = s.tokens.find((t) => t.id === tokenId);
  if (!tok || !tok.sheetId) return null;
  return s.sheets[tok.sheetId] ?? null;
}

/** Sync token.hp ↔ sheet.hp — call after any HP mutation so both views stay aligned. */
export function syncTokenHp(tokenId: number, hp: number): void {
  const s = store.getState();
  const tok = s.tokens.find((t) => t.id === tokenId);
  if (!tok) return;
  s.updateToken(tokenId, { hp } as Partial<typeof tok>);
  if (tok.sheetId) s.updateSheet(tok.sheetId, { hp });
}
