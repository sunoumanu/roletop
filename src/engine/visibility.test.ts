import { describe, it, expect, beforeEach } from 'vitest';
import type { Wall } from '../state/schemas';
import { clearVisibilityCache, computeVisibility, primeVisibilityCache } from './walls';
import { VisibilityProvider, WORKER_WALL_THRESHOLD } from './visibility';

/**
 * These tests exercise the provider's logic with `forceSync: true` so the
 * branch doesn't try to spawn a Worker in jsdom. The worker path itself is
 * best covered by Playwright where a real Worker runs.
 *
 * Paths covered here:
 *   - Small scene: sync compute matches the direct call exactly.
 *   - Large scene w/ forceSync: still sync, never throws for missing Worker.
 *   - Cache hit: provider returns the same object as a repeated computation.
 *   - `primeVisibilityCache` seed is visible on subsequent `get`s.
 */
describe('VisibilityProvider (sync fallback)', () => {
  beforeEach(() => clearVisibilityCache());

  it('matches computeVisibility for small scenes', () => {
    const walls: Wall[] = [{ x1: 600, y1: 400, x2: 600, y2: 600 }];
    const provider = new VisibilityProvider({ forceSync: true });
    const direct = computeVisibility(walls, 500, 500, 300);
    clearVisibilityCache();
    const viaProvider = provider.get(walls, 500, 500, 300);
    expect(viaProvider.rayCount).toBe(direct.rayCount);
    expect(viaProvider.points.length).toBe(direct.points.length);
  });

  it('hits the sync cache on repeat calls', () => {
    const walls: Wall[] = [{ x1: 600, y1: 400, x2: 600, y2: 600 }];
    const provider = new VisibilityProvider({ forceSync: true });
    const a = provider.get(walls, 500, 500, 300);
    const b = provider.get(walls, 500, 500, 300);
    expect(b).toBe(a);
  });

  it('returns a primed cache entry without recomputing', () => {
    const walls: Wall[] = [{ x1: 600, y1: 400, x2: 600, y2: 600 }];
    const stub = { points: [], rayCount: 0 };
    primeVisibilityCache(walls, 500, 500, 300, stub);
    const provider = new VisibilityProvider({ forceSync: true });
    expect(provider.get(walls, 500, 500, 300)).toBe(stub);
  });

  it('handles large scenes without a worker by running sync', () => {
    const walls: Wall[] = [];
    // Well over the worker threshold so the non-sync branch would be taken.
    for (let i = 0; i < WORKER_WALL_THRESHOLD + 20; i++) {
      const t = (i / 60) * Math.PI * 2;
      walls.push({
        x1: 500 + Math.cos(t) * 150,
        y1: 500 + Math.sin(t) * 150,
        x2: 500 + Math.cos(t) * 170,
        y2: 500 + Math.sin(t) * 170
      });
    }
    const provider = new VisibilityProvider({ forceSync: true });
    const res = provider.get(walls, 500, 500, 400);
    expect(res.points.length).toBeGreaterThan(0);
    expect(res.rayCount).toBeGreaterThan(0);
  });
});
