import { describe, it, expect, vi } from 'vitest';

/**
 * Background-composite cache (Phase B #20).
 *
 * The renderer reuses a pre-baked canvas for the static layers (map + grid
 * + walls + AoE) and only redraws it when one of those inputs changes. This
 * test pokes the private machinery via a subclass — real perf proof lives in
 * a Playwright harness, but here we pin the invalidation contract so a
 * regression (e.g. rebuilding on every frame) shows up as a failing unit.
 */

// Dynamic import so the module-level `devicePixelRatio` access doesn't blow
// up when Node runs this before vitest configures a jsdom environment.
const canUseDom = typeof document !== 'undefined';
const maybeDescribe = canUseDom ? describe : describe.skip;

maybeDescribe('Renderer / bg composite cache', () => {
  it('hits the cache when static inputs are unchanged', async () => {
    const { Renderer } = await import('./renderer');
    const { store } = await import('../state/store');
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    Object.defineProperty(canvas, 'clientWidth', { value: 400 });
    Object.defineProperty(canvas, 'clientHeight', { value: 300 });
    const ctx = canvas.getContext('2d')!;
    // Stub drawImage to a noop so a missing asset doesn't throw.
    vi.spyOn(ctx, 'drawImage');

    const r = new Renderer(canvas, ctx);
    const privateR = r as unknown as {
      drawFrame: () => void;
      bgCacheStats: () => { hits: number; misses: number };
    };

    // Seed the store with enough for drawFrame to run without touching live
    // store subscribers from the bootstrapped app.
    store.setState({
      walls: [],
      aoeTemplates: [],
      mapImage: null,
      tokens: []
    } as never);

    // First two frames: one miss (cold), then one hit (nothing changed).
    privateR.drawFrame();
    privateR.drawFrame();
    const stats = privateR.bgCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
  });

  it('invalidates when the walls array is replaced', async () => {
    const { Renderer } = await import('./renderer');
    const { store } = await import('../state/store');
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 320 });
    Object.defineProperty(canvas, 'clientHeight', { value: 240 });
    const ctx = canvas.getContext('2d')!;
    vi.spyOn(ctx, 'drawImage');

    const r = new Renderer(canvas, ctx);
    const privateR = r as unknown as {
      drawFrame: () => void;
      bgCacheStats: () => { hits: number; misses: number };
    };
    store.setState({ walls: [], aoeTemplates: [], tokens: [], mapImage: null } as never);

    privateR.drawFrame();              // cold miss
    privateR.drawFrame();              // hit
    store.setState({ walls: [{ x1: 0, y1: 0, x2: 10, y2: 10 }] } as never);
    privateR.drawFrame();              // expected miss

    const stats = privateR.bgCacheStats();
    expect(stats.misses).toBeGreaterThanOrEqual(2);
  });
});
