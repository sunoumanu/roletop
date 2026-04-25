import { describe, it, expect, beforeEach } from 'vitest';
import type { Wall } from '../state/schemas';
import { castRay, clearVisibilityCache, computeVisibility } from './walls';

/**
 * Tests exercise the visibility math, not the pixels — the renderer tests
 * are Playwright's job. What we want to lock down here:
 *   1. With no walls, every ray reaches the vision radius.
 *   2. A wall between the viewer and the ray direction truncates the hit.
 *   3. Repeated identical calls return the *same* result object — i.e. the
 *      cache actually caches. A referentially-new walls array invalidates.
 *   4. Ray count is bounded even with many walls.
 */
describe('walls / visibility', () => {
  beforeEach(() => clearVisibilityCache());

  it('open scene casts RADIAL_SAMPLES rays (no endpoints, radial fill only)', () => {
    const { points, rayCount } = computeVisibility([], 500, 500, 300);
    expect(rayCount).toBe(32);
    expect(points).toHaveLength(32);
    for (const p of points) expect(p.dist).toBeCloseTo(300, 3);
  });

  it('a wall truncates rays headed into it', () => {
    const walls: Wall[] = [{ x1: 600, y1: 400, x2: 600, y2: 600 }];
    // Ray from (500, 500) going +x hits the wall at x=600 → dist 100.
    const { points } = computeVisibility(walls, 500, 500, 400);
    const east = points.reduce((best, p) =>
      Math.abs(p.y - 500) < Math.abs(best.y - 500) && p.x > 500 ? p : best, { x: -Infinity, y: Infinity, dist: 0 });
    expect(east.dist).toBeCloseTo(100, 1);
  });

  it('caches identical queries (same walls ref, quantized viewer)', () => {
    const walls: Wall[] = [{ x1: 600, y1: 400, x2: 600, y2: 600 }];
    const a = computeVisibility(walls, 500, 500, 300);
    // Sub-pixel wobble should still hit the cache (quantize-to-int-px).
    const b = computeVisibility(walls, 500.2, 500.3, 300.1);
    expect(b).toBe(a);
  });

  it('new walls array invalidates the cache', () => {
    const walls1: Wall[] = [{ x1: 600, y1: 400, x2: 600, y2: 600 }];
    const a = computeVisibility(walls1, 500, 500, 300);
    const walls2: Wall[] = [{ x1: 700, y1: 400, x2: 700, y2: 600 }];
    const b = computeVisibility(walls2, 500, 500, 300);
    expect(b).not.toBe(a);
  });

  it('caps ray count under wall floods', () => {
    // Synthesize 500 walls with endpoints close enough to be within cutoff.
    const walls: Wall[] = [];
    for (let i = 0; i < 500; i++) {
      const t = (i / 500) * Math.PI * 2;
      walls.push({
        x1: 500 + Math.cos(t) * 200,
        y1: 500 + Math.sin(t) * 200,
        x2: 500 + Math.cos(t) * 220,
        y2: 500 + Math.sin(t) * 220
      });
    }
    const { rayCount } = computeVisibility(walls, 500, 500, 400);
    expect(rayCount).toBeLessThanOrEqual(720);
  });

  it('distant walls do not add to ray count (endpoint culling)', () => {
    // A wall at (5000, 5000) with short vision radius should not contribute.
    const near: Wall[] = [];
    const { rayCount: baseRays } = computeVisibility(near, 500, 500, 100);
    clearVisibilityCache();
    const far: Wall[] = [{ x1: 5000, y1: 5000, x2: 5100, y2: 5000 }];
    const { rayCount: farRays } = computeVisibility(far, 500, 500, 100);
    expect(farRays).toBe(baseRays);
  });
});

describe('walls / castRay', () => {
  it('returns max when nothing is in the way', () => {
    const p = castRay([], 0, 0, 0, 100);
    expect(p.dist).toBe(100);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('returns the nearest hit when multiple walls lie along the ray', () => {
    const walls: Wall[] = [
      { x1: 50, y1: -10, x2: 50, y2: 10 },
      { x1: 80, y1: -10, x2: 80, y2: 10 }
    ];
    const p = castRay(walls, 0, 0, 0, 200);
    expect(p.dist).toBeCloseTo(50, 5);
  });
});
