import { store } from '../state/store';
import { escapeHtml } from '../utils/escape';
import type { Token } from '../state/schemas';
import { roll, isError } from '../engine/dice';
import { execute, cmdApplyHp, cmdRemoveToken, cmdSequence, undo as undoLast } from '../state/history';
import { pushRoll } from '../features/chat';
import { ensureSheetForToken, attackRollExpr, syncTokenHp } from '../features/sheet';
import { toast } from './toast';
import { CONDITIONS, CONDITIONS_BY_ID } from '../engine/conditions';
import { isGM } from '../features/roles';
import { pickImageFile, loadTokenImage } from '../features/assetUpload';

/**
 * Right-click context menu for tokens.
 *
 * Phase-5 used `onclick="ctxDamage()"` — a global. Here, every menu item is
 * wired in one place with event delegation. Damage/heal/attack rolls use the
 * linked sheet's modifiers (review item #4).
 */

let menuEl: HTMLDivElement | null = null;
let currentTokenId: number | null = null;

export function installContextMenu(parent: HTMLElement): void {
  const m = document.createElement('div');
  m.id = 'ctx-menu';
  m.setAttribute('role', 'menu');
  m.setAttribute('aria-label', 'Token actions');
  parent.appendChild(m);
  menuEl = m;

  m.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
    if (!el || currentTokenId === null) return;
    const cmd = el.getAttribute('data-cmd')!;
    const arg = el.getAttribute('data-arg');
    runContext(cmd, currentTokenId, arg);
    hide();
  });

  // Keyboard navigation within the menu.
  m.addEventListener('keydown', (e) => {
    if (!menuEl || !menuEl.classList.contains('visible')) return;
    const items = Array.from(
      menuEl.querySelectorAll<HTMLElement>('[data-cmd]:not([hidden])')
    ).filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? items.indexOf(active) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1 + items.length) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (active && active.hasAttribute('data-cmd') && currentTokenId !== null) {
        e.preventDefault();
        const cmd = active.getAttribute('data-cmd')!;
        const arg = active.getAttribute('data-arg');
        runContext(cmd, currentTokenId, arg);
        hide();
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!menuEl || !menuEl.classList.contains('visible')) return;
    if (!(e.target as HTMLElement).closest('#ctx-menu')) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
}

export function show(x: number, y: number, tok: Token): void {
  if (!menuEl) return;
  currentTokenId = tok.id;
  menuEl.innerHTML = renderItems(tok);
  menuEl.style.left = `${x}px`;
  menuEl.style.top = `${y}px`;
  menuEl.classList.add('visible');
  // Focus the first interactive item so arrow keys and Enter work immediately.
  const first = menuEl.querySelector<HTMLElement>('[data-cmd]:not([hidden])');
  queueMicrotask(() => first?.focus());
}

export function hide(): void {
  if (menuEl) menuEl.classList.remove('visible');
  currentTokenId = null;
}

function renderItems(tok: Token): string {
  const gm = isGM();
  const conditionMenu = CONDITIONS.map((c) => {
    const active = !!store.getState().sheets[tok.sheetId ?? '']?.conditions.find((x) => x.id === c.id);
    return `<div class="ctx-item" role="menuitemcheckbox" aria-checked="${active}" tabindex="-1" data-cmd="toggle-condition" data-arg="${escapeHtml(c.id)}">
      <span style="color:${escapeHtml(c.tint)};width:14px;display:inline-block" aria-hidden="true">${escapeHtml(c.glyph)}</span>
      ${escapeHtml(c.label)}${active ? ' ✓' : ''}
    </div>`;
  }).join('');
  return `
    <div class="ctx-hdr" role="presentation">${escapeHtml(tok.name.toUpperCase())}</div>
    <div class="ctx-item" role="menuitem" tabindex="-1" data-cmd="roll" data-arg="1d20">🎲 Roll d20 <span class="ctx-key">R</span></div>
    <div class="ctx-item" role="menuitem" tabindex="-1" data-cmd="roll" data-arg="2d20kh1">⚡ Advantage</div>
    <div class="ctx-item" role="menuitem" tabindex="-1" data-cmd="attack">⚔ Attack + Damage</div>
    <div class="ctx-item" role="menuitem" tabindex="-1" data-cmd="open-sheet">📜 Open Sheet</div>
    <div class="ctx-sep" role="separator"></div>
    <div class="ctx-item" role="menuitem" tabindex="-1" data-cmd="heal">💚 Heal +1d6</div>
    <div class="ctx-item" role="menuitem" tabindex="-1" data-cmd="damage">🩸 Damage −1d6</div>
    <div class="ctx-sep" role="separator"></div>
    <div class="ctx-item" role="menuitem" tabindex="-1" aria-haspopup="true" data-cmd="toggle-submenu" data-arg="conditions">
      ⊕ Conditions…
    </div>
    <div class="ctx-submenu" id="ctx-conditions" role="group" aria-label="Conditions" hidden>${conditionMenu}</div>
    ${gm ? `
      <div class="ctx-sep" role="separator"></div>
      <div class="ctx-item" role="menuitem" tabindex="-1" data-cmd="whisper">💬 DM Whisper</div>
      <div class="ctx-item" role="menuitem" tabindex="-1" data-cmd="set-init">⏱ Set Initiative</div>
      <div class="ctx-item" role="menuitem" tabindex="-1" data-cmd="upload-art">🖼 Upload Art…</div>
      ${tok.image ? `<div class="ctx-item" role="menuitem" tabindex="-1" data-cmd="clear-art">✂ Clear Art</div>` : ''}
      <div class="ctx-item danger" role="menuitem" tabindex="-1" data-cmd="remove">🗑 Remove <span class="ctx-key">Del</span></div>
    ` : ''}
  `;
}

function runContext(cmd: string, tokenId: number, arg: string | null): void {
  const s = store.getState();
  const tok = s.tokens.find((t) => t.id === tokenId);
  if (!tok) return;

  switch (cmd) {
    case 'roll': {
      const r = roll(arg ?? '1d20');
      if (isError(r)) { toast(r.error, 'err'); return; }
      pushRoll(r);
      break;
    }
    case 'attack': {
      const sheet = ensureSheetForToken(tok.id);
      if (!sheet) return;
      const expr = attackRollExpr(sheet, 'str', true);
      const atk = roll(expr);
      if (!isError(atk)) pushRoll(atk);
      // Damage dice aren't derived from the sheet in phase 6 yet — keep 1d8+STR.
      const dmgMod = Math.floor((sheet.abilities.str - 10) / 2);
      const dmgExpr = `1d8${dmgMod >= 0 ? `+${dmgMod}` : `${dmgMod}`}`;
      if (!isError(atk) && atk.total >= 12) {
        setTimeout(() => {
          const dmg = roll(dmgExpr);
          if (isError(dmg)) return;
          pushRoll(dmg);
          // Re-resolve the token under the current state so we don't damage a
          // stale snapshot if HP changed between attack and the damage tick.
          const live = store.getState().tokens.find((t) => t.id === tok.id);
          if (!live) return;
          const before = live.hp;
          const after = Math.max(0, before - dmg.total);
          // Bundle HP + (optional) defeat into ONE undoable unit so a single
          // Undo restores both. Mirrors the `damage` flow below.
          if (after === 0 && live.type !== 'pc') {
            execute(cmdSequence(`attacked ${live.name} (defeated)`, [
              cmdApplyHp(live.id, before, after),
              cmdRemoveToken(live)
            ]));
            syncTokenHp(live.id, after);
            toast(`${live.name} defeated — Undo`, 'warn', () => {
              undoLast();
              syncTokenHp(live.id, before);
              toast(`Restored ${live.name}`, 'ok');
            });
          } else {
            execute(cmdApplyHp(live.id, before, after));
            syncTokenHp(live.id, after);
          }
        }, 400);
      }
      break;
    }
    case 'heal': {
      const r = roll('1d6');
      if (isError(r)) return;
      pushRoll(r);
      const before = tok.hp;
      const after = Math.min(tok.maxHp, before + r.total);
      execute(cmdApplyHp(tok.id, before, after));
      syncTokenHp(tok.id, after);
      break;
    }
    case 'damage': {
      const r = roll('1d6');
      if (isError(r)) return;
      pushRoll(r);
      const before = tok.hp;
      const after = Math.max(0, before - r.total);
      // Soft-delete enemies at 0 HP; PCs stay on death saves. When defeat
      // happens, bundle HP + remove into ONE undoable unit so a single Undo
      // restores the token AND its previous HP (previously two undos were
      // needed and the toast Undo only ran one, leaving the token at 0 HP).
      if (after === 0 && tok.type !== 'pc') {
        execute(cmdSequence(`damaged ${tok.name} (defeated)`, [
          cmdApplyHp(tok.id, before, after),
          cmdRemoveToken(tok)
        ]));
        syncTokenHp(tok.id, after);
        toast(`${tok.name} defeated — Undo`, 'warn', () => {
          undoLast();
          syncTokenHp(tok.id, before);
          toast(`Restored ${tok.name}`, 'ok');
        });
      } else {
        execute(cmdApplyHp(tok.id, before, after));
        syncTokenHp(tok.id, after);
      }
      break;
    }
    case 'whisper': {
      if (!isGM()) return;
      const input = document.getElementById('chat-in') as HTMLTextAreaElement | null;
      if (!input) return;
      input.value = `/w ${tok.name.split(' ')[0]} `;
      input.focus();
      break;
    }
    case 'set-init': {
      const r = roll('1d20');
      if (isError(r)) return;
      const order = [...s.initiative.order];
      const idx = order.findIndex((e) => e.id === tok.id);
      if (idx >= 0) order[idx] = { ...order[idx]!, roll: r.total };
      else order.push({ id: tok.id, name: tok.name, color: tok.color, roll: r.total, hp: tok.hp, maxHp: tok.maxHp });
      order.sort((a, b) => b.roll - a.roll);
      s.setInitiative({ ...s.initiative, order });
      toast(`${tok.name} initiative: ${r.total}`, 'ok');
      break;
    }
    case 'remove': {
      if (!isGM()) return;
      execute(cmdRemoveToken(tok));
      toast(`${tok.name} removed — Undo`, 'warn', () => {
        undoLast();
        toast(`Restored ${tok.name}`, 'ok');
      });
      break;
    }
    case 'upload-art': {
      if (!isGM()) return;
      // Fire-and-forget: the picker is user-initiated, so the promise
      // chain doesn't need to be awaited by the click handler.
      void (async () => {
        const file = await pickImageFile();
        if (file) await loadTokenImage(tok.id, file);
      })();
      break;
    }
    case 'clear-art': {
      if (!isGM()) return;
      if (!tok.image) { toast('No custom art to clear', 'warn'); return; }
      store.getState().updateToken(tok.id, { image: undefined });
      toast('Token art cleared', 'ok');
      break;
    }
    case 'open-sheet': {
      if (!tok.sheetId) ensureSheetForToken(tok.id);
      store.getState().setOpenSheet(tok.sheetId ?? null);
      break;
    }
    case 'toggle-submenu': {
      const sub = document.getElementById(`ctx-${arg}`);
      if (sub) sub.hidden = !sub.hidden;
      break;
    }
    case 'toggle-condition': {
      if (!arg) return;
      const sheet = ensureSheetForToken(tok.id);
      if (!sheet) return;
      const def = CONDITIONS_BY_ID.get(arg);
      if (!def) return;
      const existing = sheet.conditions.findIndex((c) => c.id === arg);
      if (existing >= 0) {
        const next = sheet.conditions.slice();
        next.splice(existing, 1);
        store.getState().updateSheet(sheet.id, { conditions: next });
        toast(`${def.label} removed`, 'warn');
      } else {
        store.getState().updateSheet(sheet.id, {
          conditions: [...sheet.conditions, { id: arg, rounds: 10, appliedAt: Date.now() }]
        });
        toast(`${def.label} applied`, 'ok');
      }
      break;
    }
  }
}
