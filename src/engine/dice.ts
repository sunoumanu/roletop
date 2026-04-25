/**
 * Dice engine.
 *
 * Syntax: `NdS[mods]( ± NdS[mods] )*( ± bonus )?`
 * mods (applied in this order):
 *   - kh<N> keep highest N
 *   - kl<N> keep lowest N
 *   - r<N   reroll once anything below N
 *   - mi<N> minimum result per die
 *
 * Review item mentioned the phase-5 parser was fragile and untested. This port
 * factors out the mods cleanly and is covered by vitest in `dice.test.ts`.
 */

function secureRand(max: number): number {
  if (max <= 0 || !Number.isFinite(max)) throw new RangeError('rand: bad max');
  // Unbiased rejection sampling.
  const lim = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  // When running under Node (tests), globalThis.crypto is present (Node 20+).
  // Fallback to Math.random only if nothing else available.
  const cryptoObj = (globalThis as unknown as { crypto?: Crypto }).crypto;
  let n: number;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    do {
      cryptoObj.getRandomValues(buf);
      n = buf[0]!;
    } while (n >= lim);
    return (n % max) + 1;
  }
  return Math.floor(Math.random() * max) + 1;
}

export interface DiceGroup {
  count: number;
  sides: number;
  mods: string;
  sign: 1 | -1;
}

export interface Parsed {
  groups: DiceGroup[];
  bonus: number;
}

export interface RollGroup {
  count: number;
  sides: number;
  mods: string;
  rawRolls: number[];
  finalRolls: Array<number | null>; // null = dropped (kh/kl)
  subtotal: number;
  sign: 1 | -1;
}

export interface RollResult {
  expr: string;
  label: string;
  total: number;
  groups: RollGroup[];
  bonus: number;
  isCrit: boolean;
  isFumble: boolean;
}

export interface RollError {
  error: string;
}

const GROUP_RE = /^(\d+)d(\d+)((?:kh\d+|kl\d+|r<?\d+|mi\d+)*)$/i;
const FULL_RE =
  /^((?:\d+d\d+(?:kh\d+|kl\d+|r<?\d+|mi\d+)*[+\-])*(?:\d+d\d+(?:kh\d+|kl\d+|r<?\d+|mi\d+)*))([+\-]\d+)?$/i;

export function parse(expr: string): Parsed {
  const s = expr.replace(/\s+/g, '').toLowerCase();
  if (!FULL_RE.test(s)) throw new Error(`Invalid dice: ${expr}`);

  const groups: DiceGroup[] = [];
  const bm = s.match(/([+\-]\d+)$/);
  const bp = bm ? bm[1]! : '';
  const dp = bp ? s.slice(0, -bp.length) : s;
  let bonus = bp ? parseInt(bp, 10) : 0;

  for (const g of dp.split(/(?=[+\-])/).filter(Boolean)) {
    const sign: 1 | -1 = g.startsWith('-') ? -1 : 1;
    const cl = g.replace(/^[+\-]/, '');
    const m = cl.match(GROUP_RE);
    if (!m) {
      bonus += sign * parseInt(cl, 10);
      continue;
    }
    groups.push({
      count: parseInt(m[1]!, 10),
      sides: parseInt(m[2]!, 10),
      mods: (m[3] ?? '').toLowerCase(),
      sign
    });
  }
  return { groups, bonus };
}

function applyMods(group: DiceGroup, raw: number[]): Array<number | null> {
  let rolls: Array<number | null> = [...raw];
  const mods = group.mods;

  // reroll-once (apply BEFORE kh/kl so kept dice are post-reroll).
  const rm = mods.match(/r<?(\d+)/);
  if (rm) {
    const rn = parseInt(rm[1]!, 10);
    rolls = rolls.map((v) => (v !== null && v < rn ? secureRand(group.sides) : v));
  }

  // minimum-per-die.
  const mim = mods.match(/mi(\d+)/);
  if (mim) {
    const mn = parseInt(mim[1]!, 10);
    rolls = rolls.map((v) => (v !== null ? Math.max(v, mn) : null));
  }

  // keep-highest.
  const khm = mods.match(/kh(\d+)/);
  if (khm) {
    const n = parseInt(khm[1]!, 10);
    const kept = [...rolls].filter((v): v is number => v !== null).sort((a, b) => b - a).slice(0, n);
    const bag = [...kept];
    rolls = rolls.map((v) => {
      if (v === null) return null;
      const i = bag.indexOf(v);
      if (i !== -1) {
        bag.splice(i, 1);
        return v;
      }
      return null;
    });
  }

  // keep-lowest.
  const klm = mods.match(/kl(\d+)/);
  if (klm) {
    const n = parseInt(klm[1]!, 10);
    const kept = [...rolls].filter((v): v is number => v !== null).sort((a, b) => a - b).slice(0, n);
    const bag = [...kept];
    rolls = rolls.map((v) => {
      if (v === null) return null;
      const i = bag.indexOf(v);
      if (i !== -1) {
        bag.splice(i, 1);
        return v;
      }
      return null;
    });
  }

  return rolls;
}

export function roll(expr: string, label = ''): RollResult | RollError {
  let parsed: Parsed;
  try {
    parsed = parse(expr);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { groups, bonus } = parsed;
  const gr: RollGroup[] = [];
  let total = bonus;

  for (const g of groups) {
    const raw = Array.from({ length: g.count }, () => secureRand(g.sides));
    const rolls = applyMods(g, raw);
    const kept = rolls.filter((v): v is number => v !== null);
    const sum = kept.reduce((a, b) => a + b, 0);
    const sub = sum * g.sign;
    total += sub;
    gr.push({
      count: g.count,
      sides: g.sides,
      mods: g.mods,
      rawRolls: raw,
      finalRolls: rolls,
      subtotal: sub,
      sign: g.sign
    });
  }

  // Crit/fumble only apply to a single d20 group.
  const single = groups.length === 1 && groups[0]!.sides === 20 ? gr[0]! : null;
  const singleKept = single?.finalRolls.filter((v): v is number => v !== null) ?? [];
  const isCrit = !!single && singleKept.includes(20);
  const isFumble = !!single && singleKept.length > 0 && singleKept.every((v) => v === 1);

  return { expr, label, total, groups: gr, bonus, isCrit, isFumble };
}

export function isError(r: RollResult | RollError): r is RollError {
  return (r as RollError).error !== undefined;
}

/** Exposed for testing. */
export const __internal = { secureRand, applyMods };
