import { store } from '../state/store';
import { escapeHtml } from '../utils/escape';
import { abilityMod, saveBonus, attackRollExpr, syncTokenHp } from '../features/sheet';
import { roll, isError } from '../engine/dice';
import { pushRoll } from '../features/chat';
import { toast } from './toast';
import { CONDITIONS, CONDITIONS_BY_ID } from '../engine/conditions';
import type { AbilityScores, CharacterSheet } from '../state/schemas';
import { isGM } from '../features/roles';
import { trap, type FocusTrap } from './focusTrap';
import { contrastingText } from '../utils/color';

/**
 * Character sheet editor modal (review item #4).
 *
 * Two-way bound to the store: changing a field updates the sheet; external
 * edits (HP from damage, etc.) re-render the currently-open sheet.
 */

let modalEl: HTMLDivElement | null = null;
let activeTrap: FocusTrap | null = null;

const ABILITY_KEYS: Array<keyof AbilityScores> = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export function installSheetModal(parent: HTMLElement): void {
  const el = document.createElement('div');
  el.id = 'sheet-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Character sheet');
  el.hidden = true;
  parent.appendChild(el);
  modalEl = el;

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === el || target.closest('[data-sheet-close]')) {
      store.getState().setOpenSheet(null);
      return;
    }
    handleAction(target);
  });
  el.addEventListener('change', (e) => handleInput(e.target as HTMLElement));
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    // Live-update text fields only on `change`; numbers/checkboxes go through both.
    if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'number') handleInput(t);
  });

  store.subscribe((s, prev) => {
    if (s.openSheetId !== prev.openSheetId) {
      if (s.openSheetId) renderSheet(s.openSheetId);
      else hide();
    } else if (s.openSheetId && s.sheets[s.openSheetId] !== prev.sheets[s.openSheetId]) {
      renderSheet(s.openSheetId);
    }
  });
}

function hide(): void {
  if (!modalEl) return;
  modalEl.hidden = true;
  modalEl.classList.remove('visible');
  if (activeTrap) {
    activeTrap.release();
    activeTrap = null;
  }
}

function renderSheet(sheetId: string): void {
  if (!modalEl) return;
  const s = store.getState();
  const sheet = s.sheets[sheetId];
  if (!sheet) { hide(); return; }
  const reopening = activeTrap !== null;
  modalEl.innerHTML = renderBody(sheet);
  modalEl.hidden = false;
  modalEl.classList.add('visible');
  // Only install a new trap on first open; re-renders (HP edits, etc.)
  // shouldn't steal focus away from whatever the user is editing.
  if (!reopening) {
    activeTrap = trap(modalEl);
  }
}

function renderBody(sheet: CharacterSheet): string {
  const gm = isGM();
  const pp = 10 + abilityMod(sheet.abilities.wis) + (sheet.saves.wis ? sheet.proficiency : 0);
  return `
    <div class="sheet-panel" role="document">
      <header class="sheet-hdr">
        <div class="sheet-title">
          <input class="sheet-name" data-field="name" value="${escapeHtml(sheet.name)}" ${gm ? '' : 'disabled'} />
          <input class="sheet-class" data-field="classLabel" value="${escapeHtml(sheet.classLabel)}" placeholder="Class / Ancestry" ${gm ? '' : 'disabled'} />
        </div>
        <button class="sm-btn" data-sheet-close aria-label="Close">✕</button>
      </header>

      <section class="sheet-top">
        <label class="sheet-stat">
          <span>Level</span>
          <input type="number" min="1" max="20" data-field="level" value="${sheet.level}" ${gm ? '' : 'disabled'} />
        </label>
        <label class="sheet-stat">
          <span>AC</span>
          <input type="number" min="1" max="30" data-field="ac" value="${sheet.ac}" ${gm ? '' : 'disabled'} />
        </label>
        <label class="sheet-stat">
          <span>Speed</span>
          <input type="number" min="0" max="120" step="5" data-field="speed" value="${sheet.speed}" ${gm ? '' : 'disabled'} />
        </label>
        <label class="sheet-stat">
          <span>Prof</span>
          <input type="number" min="2" max="6" data-field="proficiency" value="${sheet.proficiency}" ${gm ? '' : 'disabled'} />
        </label>
        <label class="sheet-stat">
          <span>PP</span>
          <input type="number" value="${pp}" disabled title="Passive Perception" />
        </label>
      </section>

      <section class="sheet-hp">
        <label>
          <span>HP</span>
          <input type="number" data-field="hp" value="${sheet.hp}" />
          <span>/</span>
          <input type="number" data-field="maxHp" value="${sheet.maxHp}" ${gm ? '' : 'disabled'} />
        </label>
        <label>
          <span>Temp</span>
          <input type="number" data-field="tempHp" min="0" value="${sheet.tempHp}" />
        </label>
        <div class="sheet-hp-actions">
          <button class="sm-btn" data-sheet-action="heal1d4">Heal 1d4</button>
          <button class="sm-btn" data-sheet-action="damage1d6">Dmg 1d6</button>
        </div>
      </section>

      <section class="sheet-abilities">
        ${ABILITY_KEYS.map((k) => {
          const score = sheet.abilities[k];
          const mod = abilityMod(score);
          const save = saveBonus(sheet, k);
          return `
            <div class="ab-box">
              <div class="ab-name">${k.toUpperCase()}</div>
              <input class="ab-score" type="number" min="1" max="30" data-ability="${k}" value="${score}" ${gm ? '' : 'disabled'} />
              <div class="ab-mod">${mod >= 0 ? '+' : ''}${mod}</div>
              <label class="ab-save">
                <input type="checkbox" data-save="${k}" ${sheet.saves[k] ? 'checked' : ''} ${gm ? '' : 'disabled'} />
                save ${save >= 0 ? '+' : ''}${save}
              </label>
              <button class="sm-btn" data-sheet-action="roll-check" data-ability="${k}">Check</button>
              <button class="sm-btn" data-sheet-action="roll-save" data-ability="${k}">Save</button>
            </div>
          `;
        }).join('')}
      </section>

      <section class="sheet-attacks">
        <div class="sb-lbl">Attacks</div>
        <div class="attack-row">
          <button class="sm-btn primary" data-sheet-action="attack" data-ability="str">STR Attack</button>
          <button class="sm-btn primary" data-sheet-action="attack" data-ability="dex">DEX Attack</button>
          <span class="muted">Uses ${escapeHtml(attackRollExpr(sheet, 'str', true))} / ${escapeHtml(attackRollExpr(sheet, 'dex', true))}</span>
        </div>
      </section>

      <section class="sheet-conditions">
        <div class="sb-lbl">Conditions</div>
        <div class="cond-chips">
          ${sheet.conditions.map((c) => {
            const def = CONDITIONS_BY_ID.get(c.id);
            if (!def) return '';
            // #25 — give the chip a tinted background for visual weight and
            // compute a guaranteed-legible foreground instead of relying on
            // hard-coded white. Falls back to parchment/ink from the palette.
            const fg = contrastingText(def.tint);
            return `
              <span class="cond-chip" style="background:${escapeHtml(def.tint)};color:${fg};border-color:${escapeHtml(def.tint)}">
                ${escapeHtml(def.glyph)} ${escapeHtml(def.label)}${c.rounds ? ` (${c.rounds}r)` : ''}
                <button data-sheet-action="remove-condition" data-arg="${escapeHtml(c.id)}" aria-label="Remove" style="color:${fg}">✕</button>
              </span>
            `;
          }).join('') || '<span class="muted">None</span>'}
        </div>
        <details class="cond-picker">
          <summary>Add condition…</summary>
          <div class="cond-list">
            ${CONDITIONS.map((c) => `
              <button class="cond-add" data-sheet-action="add-condition" data-arg="${escapeHtml(c.id)}" style="color:${escapeHtml(c.tint)}">
                ${escapeHtml(c.glyph)} ${escapeHtml(c.label)}
              </button>
            `).join('')}
          </div>
        </details>
      </section>

      <section class="sheet-notes">
        <div class="sb-lbl">Notes</div>
        <textarea data-field="notes" rows="4" placeholder="Spells, gear, flavor…">${escapeHtml(sheet.notes)}</textarea>
      </section>
    </div>
  `;
}

function handleInput(target: HTMLElement): void {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
  const s = store.getState();
  const id = s.openSheetId;
  if (!id) return;
  const sheet = s.sheets[id];
  if (!sheet) return;

  const field = target.getAttribute('data-field');
  const ability = target.getAttribute('data-ability');
  const save = target.getAttribute('data-save');

  if (field) {
    const patch: Partial<CharacterSheet> = {};
    if (target.type === 'number') {
      const n = Number(target.value);
      if (Number.isNaN(n)) return;
      (patch as Record<string, unknown>)[field] = n;
    } else {
      (patch as Record<string, unknown>)[field] = target.value;
    }
    s.updateSheet(id, patch);
    // Keep token.hp mirrored when HP edited directly.
    if (field === 'hp') {
      const tok = s.tokens.find((t) => t.sheetId === id);
      if (tok) syncTokenHp(tok.id, Number(target.value) || 0);
    }
    return;
  }
  if (ability) {
    const n = Number(target.value);
    if (Number.isNaN(n)) return;
    s.updateSheet(id, { abilities: { ...sheet.abilities, [ability]: n } as AbilityScores });
    return;
  }
  if (save) {
    const checked = (target as HTMLInputElement).checked;
    s.updateSheet(id, { saves: { ...sheet.saves, [save]: checked } });
    return;
  }
}

function handleAction(target: HTMLElement): void {
  const btn = target.closest<HTMLElement>('[data-sheet-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-sheet-action');
  const arg = btn.getAttribute('data-arg');
  const abilityAttr = btn.getAttribute('data-ability') as keyof AbilityScores | null;
  const s = store.getState();
  const id = s.openSheetId;
  if (!id) return;
  const sheet = s.sheets[id];
  if (!sheet) return;

  switch (action) {
    case 'roll-check': {
      if (!abilityAttr) return;
      const mod = abilityMod(sheet.abilities[abilityAttr]);
      const r = roll(mod >= 0 ? `1d20+${mod}` : `1d20${mod}`);
      if (!isError(r)) pushRoll(r);
      break;
    }
    case 'roll-save': {
      if (!abilityAttr) return;
      const bonus = saveBonus(sheet, abilityAttr);
      const r = roll(bonus >= 0 ? `1d20+${bonus}` : `1d20${bonus}`);
      if (!isError(r)) pushRoll(r);
      break;
    }
    case 'attack': {
      if (!abilityAttr) return;
      const r = roll(attackRollExpr(sheet, abilityAttr, true));
      if (!isError(r)) pushRoll(r);
      break;
    }
    case 'heal1d4': {
      const r = roll('1d4');
      if (isError(r)) return;
      pushRoll(r);
      const next = Math.min(sheet.maxHp, sheet.hp + r.total);
      s.updateSheet(id, { hp: next });
      const tok = s.tokens.find((t) => t.sheetId === id);
      if (tok) syncTokenHp(tok.id, next);
      break;
    }
    case 'damage1d6': {
      const r = roll('1d6');
      if (isError(r)) return;
      pushRoll(r);
      const next = Math.max(0, sheet.hp - r.total);
      s.updateSheet(id, { hp: next });
      const tok = s.tokens.find((t) => t.sheetId === id);
      if (tok) syncTokenHp(tok.id, next);
      break;
    }
    case 'add-condition': {
      if (!arg) return;
      const def = CONDITIONS_BY_ID.get(arg);
      if (!def) return;
      if (sheet.conditions.some((c) => c.id === arg)) return;
      s.updateSheet(id, { conditions: [...sheet.conditions, { id: arg, rounds: 10, appliedAt: Date.now() }] });
      toast(`${def.label} applied`, 'ok');
      break;
    }
    case 'remove-condition': {
      if (!arg) return;
      s.updateSheet(id, { conditions: sheet.conditions.filter((c) => c.id !== arg) });
      break;
    }
  }
}
