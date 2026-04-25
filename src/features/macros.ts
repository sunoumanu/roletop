import { store } from '../state/store';
import type { Macro } from '../state/schemas';
import { send as sendChat } from './chat';
import { rollInitiative } from './initiative';
import { toast } from '../ui/toast';
import { roll, isError } from '../engine/dice';
import { syncTokenHp } from './sheet';

export function run(macro: Macro): void {
  if (macro.cmd.startsWith('/r ')) {
    // Go through the normal chat path so the roll renders as a roll-card.
    sendChat(macro.cmd);
    return;
  }
  if (macro.cmd === 'initiative') {
    rollInitiative();
    return;
  }
  if (macro.cmd === 'shortrest') {
    shortRest();
    return;
  }
  if (macro.cmd.startsWith('/w ')) {
    sendChat(macro.cmd);
    return;
  }
  toast(`Unknown macro command: ${macro.cmd}`, 'err');
}

export function runByKey(key: string): void {
  const m = store.getState().macros.find((x) => x.key === key);
  if (m) run(m);
}

export function shortRest(): void {
  const s = store.getState();
  for (const tok of s.tokens) {
    const r = roll('1d6+1');
    if (isError(r)) continue;
    syncTokenHp(tok.id, Math.min(tok.maxHp, tok.hp + r.total));
  }
  s.addChat({ type: 'system', body: '🛌 Short Rest — each PC heals 1d6+1 HP' });
  toast('Short Rest taken', 'ok');
}

export const DEFAULT_MACROS: readonly Macro[] = [
  { key: 'F1', name: 'Attack Roll',  cmd: '/r 1d20+5',  type: 'roll' },
  { key: 'F2', name: 'Healing Word', cmd: '/r 1d4+4',   type: 'roll' },
  { key: 'F3', name: 'Fireball',     cmd: '/r 8d6',     type: 'roll' },
  { key: 'F4', name: 'Perception',   cmd: '/r 1d20+3',  type: 'roll' },
  { key: 'F5', name: 'Initiative',   cmd: 'initiative', type: 'action' },
  { key: 'F6', name: 'Short Rest',   cmd: 'shortrest',  type: 'action' }
];
