import { describe, it, expect } from 'vitest';
import { fitWithin, THUMBNAIL_MAX } from './thumbnail';

/**
 * fitWithin is pure math; the async pipeline (fetch + bitmap + blob) is
 * tested via Playwright since those APIs need a browser.
 */
describe('thumbnail / fitWithin', () => {
  it('returns source dims unchanged when already within the cap', () => {
    expect(fitWithin(200, 150, 512)).toEqual({ w: 200, h: 150 });
    expect(fitWithin(THUMBNAIL_MAX, THUMBNAIL_MAX, THUMBNAIL_MAX)).toEqual({ w: 512, h: 512 });
  });

  it('scales landscape sources to cap the long edge', () => {
    // 2000×1000 → scale 512/2000 → {512, 256}.
    expect(fitWithin(2000, 1000, 512)).toEqual({ w: 512, h: 256 });
  });

  it('scales portrait sources to cap the long edge', () => {
    // 1000×2000 → scale 512/2000 → {256, 512}.
    expect(fitWithin(1000, 2000, 512)).toEqual({ w: 256, h: 512 });
  });

  it('preserves aspect ratio on arbitrary dimensions', () => {
    const { w, h } = fitWithin(3840, 2160, 512);
    expect(w).toBe(512);
    // 2160 * (512/3840) = 288.
    expect(h).toBe(288);
  });

  it('never rounds a dimension to 0', () => {
    // A 10000×1 sliver: long-edge scale is 512/10000 → h rounds to 0
    // unless we clamp to 1.
    const { w, h } = fitWithin(10000, 1, 512);
    expect(w).toBe(512);
    expect(h).toBe(1);
  });
});
