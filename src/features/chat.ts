import { store } from '../state/store';
import type { ChatMsg } from '../state/schemas';
import { escapeHtml, htmlRaw, raw } from '../utils/escape';
import { roll, isError } from '../engine/dice';
import { canSeeMessage } from './roles';
import { toast } from '../ui/toast';
import type { RollResult } from '../engine/dice';
import { showRollPopup } from '../ui/rollPopup';

/**
 * Chat — with the phase-5 XSS bug fixed (review item #2).
 *
 * Every user-authored field is escaped at render time. Slash-commands are
 * resolved before the payload is pushed to the store, so macros/dice expressions
 * render via trusted components (`roll-card`), never as raw HTML.
 */

export function send(rawInput: string): void {
  const input = rawInput.trim();
  if (!input) return;
  const s = store.getState();

  // /r <expr>
  const rollMatch = /^\/r(?:oll)?\s+(.+)$/i.exec(input);
  if (rollMatch) {
    const expr = rollMatch[1]!.trim();
    const r = roll(expr);
    if (isError(r)) {
      // #11 — translate the most common dice-syntax stumbles into a nudge
      // the player can act on. The original error message stays visible so
      // experienced users aren't left guessing what the parser saw.
      const suggestion = suggestDiceFix(expr);
      const msg = suggestion
        ? `⚠ ${r.error} — did you mean \`/r ${suggestion}\`?`
        : `⚠ ${r.error}`;
      toast(msg, 'err');
      return;
    }
    pushRoll(r);
    return;
  }

  // /w <name> <msg>
  const whisperMatch = /^\/w\s+(\S+)\s+(.*)$/i.exec(input);
  if (whisperMatch) {
    const [, target, text] = whisperMatch;
    const player = s.players.find((p) => p.name.toLowerCase().startsWith(target!.toLowerCase()));
    if (!player) {
      toast(`Unknown player: ${target}`, 'err');
      return;
    }
    s.addChat({
      type: 'whisper',
      author: selfName(),
      color: selfColor(),
      whisperTo: player.name,
      body: text,
      self: true,
      visibility: [player.id, s.currentUserId]
    });
    toast(`Whisper → ${player.name}`, 'ok');
    return;
  }

  // /m <name>
  const macroMatch = /^\/m\s+(.+)$/i.exec(input);
  if (macroMatch) {
    const name = macroMatch[1]!.trim().toLowerCase();
    const macro = s.macros.find((m) => m.name.toLowerCase().includes(name));
    if (!macro) {
      toast(`Macro not found: ${name}`, 'err');
      return;
    }
    // Re-enter send() for `/r`-style macros; for action macros just log.
    if (macro.cmd.startsWith('/r ') || macro.cmd.startsWith('/w ')) send(macro.cmd);
    s.addChat({ type: 'macro-log', body: `${macro.name} (${macro.key})` });
    return;
  }

  // Plain chat.
  s.addChat({ type: 'chat', author: selfName(), color: selfColor(), body: input, self: true });
}

export function pushRoll(r: RollResult): void {
  const s = store.getState();
  s.addChat({
    type: 'roll',
    author: selfName(),
    color: selfColor(),
    expr: r.expr,
    result: r.total,
    breakdown: r.groups as unknown[],
    bonus: r.bonus,
    isCrit: r.isCrit,
    isFumble: r.isFumble,
    self: true
  });
  showRollPopup(r);
}

/**
 * Resolve the current chat identity.
 *
 * If `speakingAs` is set (review §2 #11), the user's chat is attributed to
 * that player or token. GM-only enforcement happens at the UI layer that
 * populates the options — this resolver trusts the current store state.
 */
function currentIdentity(): { name: string; color: string } {
  const s = store.getState();
  const speakingAs = s.speakingAs;

  if (speakingAs && speakingAs.startsWith('token:')) {
    const idPart = speakingAs.slice('token:'.length);
    const tokenId = Number(idPart);
    const tok = s.tokens.find((t) => t.id === tokenId);
    if (tok) return { name: tok.name, color: tok.color };
  }
  if (speakingAs) {
    const player = s.players.find((p) => p.id === speakingAs);
    if (player) return { name: player.name, color: player.color };
  }

  const self = s.players.find((p) => p.id === s.currentUserId);
  if (self) return { name: self.name, color: self.color };
  return { name: s.role === 'gm' ? 'You (DM)' : 'You', color: '#c8622a' };
}

function selfName(): string {
  return currentIdentity().name;
}
function selfColor(): string {
  return currentIdentity().color;
}

// ── Rendering ───────────────────────────────────────────────────────

export function renderChatInto(target: HTMLElement): void {
  const s = store.getState();
  const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 40;
  const visible = s.chat.filter(canSeeMessage);
  target.innerHTML = visible.map(renderMsg).join('');
  if (atBottom) target.scrollTop = target.scrollHeight;
}

function renderMsg(m: ChatMsg): string {
  const time = formatTime(m.time);
  switch (m.type) {
    case 'system':
      return htmlRaw`<div class="chat-msg system"><div class="chat-body">${m.body ?? ''}</div></div>`;
    case 'div':
      return htmlRaw`<div class="chat-div"><span>${m.body ?? ''}</span></div>`;
    case 'macro-log':
      return htmlRaw`<div class="chat-msg macro-log"><div class="chat-body">⚡ ${m.body ?? ''}</div></div>`;
    case 'roll': {
      type Group = { finalRolls: Array<number | null> };
      const groups = (m.breakdown as Group[] | undefined) ?? [];
      const bd = groups.length
        ? groups.map((g) => `[${g.finalRolls.filter((v) => v !== null).join('+')}]`).join(' ')
        : `[${m.result ?? ''}]`;
      const bonStr = m.bonus ? (m.bonus > 0 ? `+${m.bonus}` : `${m.bonus}`) : '';
      const colorAttr = `color:${escapeHtml(m.color ?? '#c9983a')}`;
      const rollColor = m.isCrit ? '#c9983a' : m.isFumble ? '#8b2020' : 'var(--ember)';
      const critTag = m.isCrit
        ? raw('<span class="rc-crit">✦ CRIT</span>')
        : m.isFumble
          ? raw('<span class="rc-crit" style="color:var(--blood)">✦ FUMBLE</span>')
          : '';
      return htmlRaw`<div class="chat-msg roll${m.self ? ' self' : ''}">
        <div class="chat-meta">
          <span class="chat-author" style="${raw(colorAttr)}">${m.author ?? ''}</span>
          <span class="chat-time">${time}</span>
        </div>
        <div class="roll-card">
          <span class="rc-num" style="${raw(`color:${rollColor}`)}">${m.result ?? ''}</span>
          <div class="rc-detail">
            <span class="rc-expr">${(m.expr ?? '') + bonStr}</span>
            <span class="rc-break">${bd}</span>
            ${critTag}
          </div>
        </div>
      </div>`;
    }
    case 'whisper': {
      const tag = m.self
        ? raw(`<span class="whisper-tag">→ ${escapeHtml(m.whisperTo ?? '')}</span>`)
        : raw('<span class="whisper-tag">whisper</span>');
      const colorAttr = `color:${escapeHtml(m.color ?? '#c9983a')}`;
      return htmlRaw`<div class="chat-msg whisper${m.self ? ' self' : ''}">
        <div class="chat-meta">
          <span class="chat-author" style="${raw(colorAttr)}">${m.author ?? ''}</span>
          <span class="chat-time">${time}</span>
        </div>
        <div class="chat-body">${tag}${m.body ?? ''}</div>
      </div>`;
    }
    case 'chat':
    default: {
      const colorAttr = `color:${escapeHtml(m.color ?? '#c9983a')}`;
      return htmlRaw`<div class="chat-msg${m.self ? ' self' : ''}">
        <div class="chat-meta">
          <span class="chat-author" style="${raw(colorAttr)}">${m.author ?? ''}</span>
          <span class="chat-time">${time}</span>
        </div>
        <div class="chat-body">${m.body ?? ''}</div>
      </div>`;
    }
  }
}

/**
 * #11 — pattern-based "did you mean" helper for dice expressions. We don't
 * try to be exhaustive; we target the shapes players fumble most often.
 */
function suggestDiceFix(expr: string): string | null {
  const e = expr.trim();
  if (!e) return '1d20';
  // `d20` → `1d20` (missing count before the d)
  if (/^d\d+([+-]\d+)?$/i.test(e)) return `1${e.toLowerCase()}`;
  // `2D6` or `2 d 6` → `2d6` (stray whitespace / casing)
  if (/^\d+\s*[dD]\s*\d+([+-]\d+)?$/.test(e)) return e.replace(/\s+/g, '').toLowerCase();
  // `d20+5` fragments embedded in noise: extract the first recognisable term.
  const m = /(\d*)d(\d+)([+-]\d+)?/i.exec(e);
  if (m) {
    const count = m[1] || '1';
    const faces = m[2]!;
    const mod = m[3] ?? '';
    return `${count}d${faces}${mod}`;
  }
  // `20` (bare number) → `1d20` (assume they wanted a d<n>)
  if (/^\d+$/.test(e)) return `1d${e}`;
  return null;
}

function formatTime(t: number): string {
  const d = new Date(t);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
