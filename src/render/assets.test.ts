import { describe, it, expect } from 'vitest';
import { SpriteAtlas, type AtlasSlot } from './assets';

/**
 * Atlas packing tests. They bypass `document.createElement` via an injected
 * `pageFactory` that returns a minimal canvas-like stub — the allocator
 * cares only about bookkeeping, so we don't need a real DOM for this.
 */
function stubFactory(w: number, h: number): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

function rectsOverlap(a: AtlasSlot, b: AtlasSlot): boolean {
  if (a.source !== b.source) return false;
  return !(a.sx + a.sw <= b.sx || b.sx + b.sw <= a.sx ||
           a.sy + a.sh <= b.sy || b.sy + b.sh <= a.sy);
}

describe('SpriteAtlas / shelf packing', () => {
  it('packs several small sprites without overlap', () => {
    const atlas = new SpriteAtlas({ pageW: 100, pageH: 100, pageFactory: stubFactory });
    const a = atlas.allocate(30, 30);
    const b = atlas.allocate(30, 30);
    const c = atlas.allocate(30, 30);
    expect(a.source).toBe(b.source);
    expect(b.source).toBe(c.source);
    expect(rectsOverlap(a, b)).toBe(false);
    expect(rectsOverlap(b, c)).toBe(false);
    expect(rectsOverlap(a, c)).toBe(false);
    // Expected layout: (0,0), (30,0), (60,0).
    expect(a.sx).toBe(0); expect(a.sy).toBe(0);
    expect(b.sx).toBe(30); expect(b.sy).toBe(0);
    expect(c.sx).toBe(60); expect(c.sy).toBe(0);
  });

  it('advances to a new shelf when horizontal space runs out', () => {
    const atlas = new SpriteAtlas({ pageW: 100, pageH: 100, pageFactory: stubFactory });
    atlas.allocate(40, 30);   // (0,0)
    atlas.allocate(40, 30);   // (40,0) — shelf full at 80
    const third = atlas.allocate(40, 30); // doesn't fit → wrap to y=30
    expect(third.sx).toBe(0);
    expect(third.sy).toBe(30);
  });

  it('allocates a new page when the current one fills', () => {
    const atlas = new SpriteAtlas({ pageW: 100, pageH: 100, pageFactory: stubFactory });
    // Four 50×50 sprites fit (2×2 on page 1). A fifth forces a new page.
    const slots: AtlasSlot[] = [];
    for (let i = 0; i < 5; i++) slots.push(atlas.allocate(50, 50));
    expect(atlas.pageCount).toBe(2);
    expect(slots[0]!.source).toBe(slots[3]!.source);
    expect(slots[4]!.source).not.toBe(slots[0]!.source);
    expect(slots[4]!.sx).toBe(0);
    expect(slots[4]!.sy).toBe(0);
  });

  it('uses the tallest-in-shelf height for wrapping', () => {
    const atlas = new SpriteAtlas({ pageW: 100, pageH: 100, pageFactory: stubFactory });
    atlas.allocate(40, 20);          // shelf 0, y=0, h=20 so far
    atlas.allocate(40, 40);          // shelf 0, y=0, h grows to 40
    const wrap = atlas.allocate(40, 20); // wraps: y=40, not y=20
    expect(wrap.sy).toBe(40);
  });

  it('oversized sprites get their own standalone canvas', () => {
    const atlas = new SpriteAtlas({ pageW: 100, pageH: 100, pageFactory: stubFactory });
    const normal = atlas.allocate(50, 50);
    const huge = atlas.allocate(200, 200);
    expect(huge.source).not.toBe(normal.source);
    expect(huge.sx).toBe(0);
    expect(huge.sy).toBe(0);
    expect(huge.sw).toBe(200);
    expect(huge.sh).toBe(200);
    // pageCount counts only the atlas pages, not the standalone canvas.
    expect(atlas.pageCount).toBe(1);
  });

  it('reset clears all pages and cursor state', () => {
    const atlas = new SpriteAtlas({ pageW: 100, pageH: 100, pageFactory: stubFactory });
    atlas.allocate(30, 30);
    atlas.allocate(30, 30);
    expect(atlas.pageCount).toBe(1);
    atlas.reset();
    expect(atlas.pageCount).toBe(0);
    const fresh = atlas.allocate(30, 30);
    expect(fresh.sx).toBe(0);
    expect(fresh.sy).toBe(0);
  });
});
