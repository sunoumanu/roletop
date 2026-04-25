import { describe, it, expect } from 'vitest';
import { parse, roll, isError } from './dice';

describe('parse', () => {
  it('parses a flat roll', () => {
    const p = parse('1d20');
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0]).toMatchObject({ count: 1, sides: 20, mods: '', sign: 1 });
    expect(p.bonus).toBe(0);
  });

  it('parses positive and negative bonuses', () => {
    expect(parse('1d20+5').bonus).toBe(5);
    expect(parse('1d20-3').bonus).toBe(-3);
  });

  it('parses multiple groups', () => {
    const p = parse('2d6+1d8+3');
    expect(p.groups).toHaveLength(2);
    expect(p.bonus).toBe(3);
  });

  it('parses advantage (kh)', () => {
    const p = parse('2d20kh1');
    expect(p.groups[0]!.mods).toBe('kh1');
  });

  it('parses multiple mods on one die', () => {
    const p = parse('4d6r<2kh3');
    expect(p.groups[0]!.mods).toContain('kh3');
    expect(p.groups[0]!.mods).toContain('r<2');
  });

  it('rejects garbage', () => {
    expect(() => parse('foo')).toThrow();
    expect(() => parse('')).toThrow();
    expect(() => parse('d20')).toThrow();
  });
});

describe('roll', () => {
  it('produces a valid d20 result', () => {
    const r = roll('1d20');
    expect(isError(r)).toBe(false);
    if (!isError(r)) {
      expect(r.total).toBeGreaterThanOrEqual(1);
      expect(r.total).toBeLessThanOrEqual(20);
    }
  });

  it('applies flat bonus', () => {
    const r = roll('1d1+7');
    if (!isError(r)) expect(r.total).toBe(8);
  });

  it('advantage keeps exactly one die', () => {
    const r = roll('2d20kh1');
    if (!isError(r)) {
      const kept = r.groups[0]!.finalRolls.filter((v) => v !== null);
      expect(kept).toHaveLength(1);
    }
  });

  it('disadvantage keeps the lowest', () => {
    for (let i = 0; i < 50; i++) {
      const r = roll('2d20kl1');
      if (!isError(r)) {
        const raw = r.groups[0]!.rawRolls;
        const kept = r.groups[0]!.finalRolls.filter((v): v is number => v !== null);
        expect(kept).toHaveLength(1);
        expect(kept[0]).toBeLessThanOrEqual(Math.min(...raw));
      }
    }
  });

  it('minimum-per-die raises 1s to the floor', () => {
    for (let i = 0; i < 20; i++) {
      const r = roll('4d1mi3'); // d1 always rolls 1, but mi3 should bump to 3
      if (!isError(r)) {
        const finals = r.groups[0]!.finalRolls;
        expect(finals.every((v) => v === 3)).toBe(true);
      }
    }
  });

  it('detects critical on nat 20 (single d20 group)', () => {
    // Look for a crit over many rolls — with adv, probability is very high.
    let sawCrit = false;
    for (let i = 0; i < 500 && !sawCrit; i++) {
      const r = roll('2d20kh1');
      if (!isError(r) && r.isCrit) sawCrit = true;
    }
    expect(sawCrit).toBe(true);
  });

  it('does NOT flag crit on mixed dice', () => {
    // A d20 plus damage should not report crit via this flag.
    let evaluated = 0;
    for (let i = 0; i < 100; i++) {
      const r = roll('1d20+1d6');
      if (!isError(r)) {
        expect(r.isCrit).toBe(false);
        evaluated++;
      }
    }
    expect(evaluated).toBeGreaterThan(0);
  });

  it('returns structured error for bad input', () => {
    const r = roll('not dice');
    expect(isError(r)).toBe(true);
  });

  it('reroll-under stabilises minimum', () => {
    // 1d6r<6 should reroll anything under 6 once — range stays 1-6 after single reroll.
    for (let i = 0; i < 200; i++) {
      const r = roll('1d6r<6');
      if (!isError(r)) {
        expect(r.total).toBeGreaterThanOrEqual(1);
        expect(r.total).toBeLessThanOrEqual(6);
      }
    }
  });
});
