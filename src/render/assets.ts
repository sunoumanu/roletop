/**
 * Procedural asset cache.
 *
 * Phase 5 drew the map and token sprites imperatively every frame; here we
 * cache both into offscreen canvases keyed by their visual identity so the
 * renderer just blits. User-uploaded images (map, token art — §3) are loaded
 * asynchronously and cached by URL so the render loop can blit them without
 * re-decoding every frame.
 */

/**
 * Decoded image handle. `drawImage` accepts both, so the renderer doesn't
 * care which one it gets — it just blits.
 *
 * `ImageBitmap` is preferred on modern browsers: `fetch` + `createImageBitmap`
 * decodes off-thread and yields a GPU-friendly handle. `HTMLImageElement` is
 * the fallback for `data:` URLs (where fetch overhead is pure cost) and
 * environments without `createImageBitmap`.
 */
export type DecodedImage = ImageBitmap | HTMLImageElement;

/**
 * Descriptor attached to a token to signal that its `image` URL is an
 * animated source. Schema mirror of `TokenAnimation` in `state/schemas.ts` —
 * kept local so `assets.ts` doesn't reach back into state.
 */
export type AnimationDescriptor =
  | { kind: 'video' }
  | { kind: 'sprite'; cols: number; rows: number; fps: number };

/**
 * Decoded asset handed back by `getAsset`. Discriminated union so the
 * renderer can switch on `kind` and apply the right blit strategy.
 */
export type Asset =
  | { kind: 'image'; source: DecodedImage }
  | { kind: 'video'; source: HTMLVideoElement }
  | { kind: 'sprite'; source: DecodedImage; cols: number; rows: number; fps: number };

/** True when `createImageBitmap` is usable — feature-detected once at load. */
const HAS_IMAGE_BITMAP: boolean =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { createImageBitmap?: unknown }).createImageBitmap === 'function';

/**
 * A rectangular region of a shared atlas canvas. Callers blit with the
 * 9-arg form of `ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh)`.
 *
 * Returned by {@link AssetManager.generateTokenSprite} instead of a
 * per-sprite canvas (Phase B [M]). Canvas 2D sees a modest win from fewer
 * live canvases; the real payoff is the Pixi migration — one texture
 * upload per atlas page instead of one per unique `(color, initial, type)`.
 */
export interface AtlasSlot {
  /** The atlas page canvas. Many slots share a single page. */
  readonly source: HTMLCanvasElement;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

/** Page dimensions for the sprite atlas. 1024² fits comfortably in every
 *  consumer GPU's minimum max-texture bound even at 2× DPR. */
const ATLAS_PAGE_W = 1024;
const ATLAS_PAGE_H = 1024;

/**
 * Factory a packer uses to create a new atlas page. Default implementation
 * uses `document.createElement('canvas')`; tests inject a DOM-free stub.
 * Abstracted because the packing bookkeeping is pure arithmetic and we
 * want to unit-test it in plain Node without jsdom.
 */
export type AtlasPageFactory = (w: number, h: number) => HTMLCanvasElement;

const defaultPageFactory: AtlasPageFactory = (w, h) => {
  const page = document.createElement('canvas');
  page.width = w;
  page.height = h;
  return page;
};

/**
 * Simple shelf packer. Not optimal, but cheap, deterministic, and adequate
 * for a token roster that tops out in the low hundreds. Sprites are
 * square-ish and similarly sized, so shelf waste is minimal.
 *
 * Layout rules:
 *   - Cursor walks left-to-right along the current shelf.
 *   - Shelf height is the max sprite height allocated into it so far.
 *   - When a request won't fit on the current shelf, start a new shelf
 *     below (cursor = 0, y += shelfHeight).
 *   - When the new shelf would overflow the page, allocate a new page.
 *
 * We never reclaim slots — the token roster is small enough that leaks
 * aren't a concern, and compaction would invalidate every outstanding slot.
 */
export class SpriteAtlas {
  private pages: HTMLCanvasElement[] = [];
  private pageIdx = -1;
  private cursorX = 0;
  private cursorY = 0;
  private shelfH = 0;
  private readonly pageW: number;
  private readonly pageH: number;
  private readonly newCanvas: AtlasPageFactory;

  constructor(opts: { pageW?: number; pageH?: number; pageFactory?: AtlasPageFactory } = {}) {
    this.pageW = opts.pageW ?? ATLAS_PAGE_W;
    this.pageH = opts.pageH ?? ATLAS_PAGE_H;
    this.newCanvas = opts.pageFactory ?? defaultPageFactory;
  }

  /** Allocate a slot for a sprite of `w × h`. Page is created lazily. */
  allocate(w: number, h: number): AtlasSlot {
    if (w > this.pageW || h > this.pageH) {
      // Degenerate case — a sprite larger than a page. Give it its own
      // standalone canvas instead of failing. The renderer doesn't care
      // which canvas the slot points at, only that `drawImage` works.
      return { source: this.newCanvas(w, h), sx: 0, sy: 0, sw: w, sh: h };
    }
    if (this.pageIdx === -1) this.newPage();
    // New shelf if horizontal room ran out.
    if (this.cursorX + w > this.pageW) {
      this.cursorX = 0;
      this.cursorY += this.shelfH;
      this.shelfH = 0;
    }
    // New page if we've walked off the bottom.
    if (this.cursorY + h > this.pageH) {
      this.newPage();
    }
    const slot: AtlasSlot = {
      source: this.pages[this.pageIdx]!,
      sx: this.cursorX,
      sy: this.cursorY,
      sw: w,
      sh: h
    };
    this.cursorX += w;
    if (h > this.shelfH) this.shelfH = h;
    return slot;
  }

  /** Currently-allocated page count (primarily for tests). */
  get pageCount(): number {
    return this.pages.length;
  }

  /** Reset all state. Used by `clearCache` in tests and hot-reload. */
  reset(): void {
    this.pages = [];
    this.pageIdx = -1;
    this.cursorX = 0;
    this.cursorY = 0;
    this.shelfH = 0;
  }

  private newPage(): void {
    const page = this.newCanvas(this.pageW, this.pageH);
    this.pages.push(page);
    this.pageIdx = this.pages.length - 1;
    this.cursorX = 0;
    this.cursorY = 0;
    this.shelfH = 0;
  }
}

export class AssetManager {
  private readonly cache = new Map<string, HTMLCanvasElement>();
  /** Shared atlas for procedural token sprites. Each unique
   *  (color, initial, type, size) tuple gets one slot; duplicates share. */
  private readonly spriteAtlas = new SpriteAtlas();
  private readonly spriteSlots = new Map<string, AtlasSlot>();
  /**
   * User-supplied image cache, keyed by data-URL or http URL. An in-flight
   * decode is stored as a Promise so duplicate `loadImage` calls share work.
   * Once decoded, the decoded handle replaces the Promise. On decode error
   * the entry is removed so we don't hand out a broken reference.
   */
  private readonly images = new Map<string, DecodedImage | Promise<DecodedImage>>();
  /**
   * Separate cache for animated `<video>` sources. Entry value is either a
   * video element already marked ready (readyState >= HAVE_CURRENT_DATA) or
   * one still loading. We keep it separate from `images` because video
   * elements expose a different lifecycle (play/pause, `requestVideoFrameCallback`).
   */
  private readonly videos = new Map<string, HTMLVideoElement>();
  /** Callback fired when a requested image finishes decoding — lets the
   * renderer bump its dirty flag so the first frame with the new image
   * actually repaints. */
  onImageLoaded: (() => void) | null = null;

  generateMapCanvas(w: number, h: number): HTMLCanvasElement {
    const mc = document.createElement('canvas');
    mc.width = w;
    mc.height = h;
    const c = mc.getContext('2d')!;
    c.fillStyle = '#191410';
    c.fillRect(0, 0, w, h);
    const sc = ['#201c18', '#1e1a14', '#221d17', '#1b1813'];
    for (let row = 0; row * 60 < h; row++) {
      const off = (row % 2) * 40;
      for (let col = -1; col * 80 < w + 80; col++) {
        const x = col * 80 + off;
        const y = row * 60;
        c.fillStyle = sc[Math.floor(Math.abs(Math.sin(col * 7 + row * 13) * 4))] ?? sc[0]!;
        c.fillRect(x + 1, y + 1, 78, 58);
        c.fillStyle = 'rgba(255,255,255,0.018)';
        c.fillRect(x + 2, y + 2, 76, 4);
      }
    }
    c.strokeStyle = '#080604';
    c.lineWidth = 22;
    c.strokeRect(10, 10, w - 20, h - 20);
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(18,12,8,0)');
    g.addColorStop(1, 'rgba(0,0,0,.68)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    [[100, 100], [w - 100, 100], [100, h - 100], [w - 100, h - 100], [w / 2, h / 2]].forEach(([tx, ty]) => {
      const tg = c.createRadialGradient(tx!, ty!, 0, tx!, ty!, 140);
      tg.addColorStop(0, 'rgba(200,98,42,.14)');
      tg.addColorStop(1, 'rgba(200,98,42,0)');
      c.fillStyle = tg;
      c.fillRect(0, 0, w, h);
    });
    this.cache.set('__map__', mc);
    return mc;
  }

  /**
   * Padding around the core sprite that carries the baked drop-shadow halo.
   * The shadow used to be applied per-frame via `ctx.shadowBlur` in the
   * renderer — the single slowest Canvas 2D op. We bake it once here into a
   * larger canvas (core + SPRITE_SHADOW_PAD on every side) so the renderer
   * can `drawImage` with no filter state at all.
   *
   * `spriteDrawSize(size)` returns the full drawImage dimensions; callers
   * blit the returned sprite centred on the token so the shadow sits behind
   * and below without offsetting the token itself.
   */
  static readonly SPRITE_SHADOW_PAD = 8;

  /** Full canvas side-length for a sprite of core diameter `size`. */
  static spriteDrawSize(size: number): number {
    return size + AssetManager.SPRITE_SHADOW_PAD * 2;
  }

  /**
   * Return an atlas slot for the given token sprite. Previously this
   * returned a dedicated offscreen canvas per (color, initial, type, size)
   * tuple; we now pack into a shared atlas so Canvas 2D holds onto fewer
   * live canvas elements and the upcoming Pixi migration can upload one
   * texture per atlas page instead of one per sprite.
   *
   * Blit with the 9-arg form:
   *   `ctx.drawImage(slot.source, slot.sx, slot.sy, slot.sw, slot.sh, dx, dy, dw, dh)`
   */
  generateTokenSprite(opts: { color: string; initial: string; size?: number; type: 'pc' | 'npc' | 'enemy' }): AtlasSlot {
    const { color, initial, type } = opts;
    const size = opts.size ?? 48;
    const key = `tok_${color}_${initial}_${type}_${size}`;
    const cached = this.spriteSlots.get(key);
    if (cached) return cached;
    const pad = AssetManager.SPRITE_SHADOW_PAD;
    const full = AssetManager.spriteDrawSize(size);
    const slot = this.spriteAtlas.allocate(full, full);
    const c = slot.source.getContext('2d')!;
    // Painter operates in atlas-local coordinates. Save/restore so other
    // slots on the same page aren't polluted by our transform/shadow state.
    c.save();
    c.translate(slot.sx, slot.sy);
    const cx = full / 2;
    const cy = full / 2;
    const r = size / 2 - 2;
    // Baked drop shadow. Matches the values the renderer used to set on
    // every draw (rgba(0,0,0,.55) / blur 10 / offset-y 4). Capped so the
    // halo stays inside the SPRITE_SHADOW_PAD margin at 1× zoom.
    c.shadowColor = 'rgba(0,0,0,.55)';
    c.shadowBlur = Math.min(10, pad);
    c.shadowOffsetY = Math.min(4, pad);
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    // Disable shadow for the remaining strokes so the ring/letter render crisp.
    c.shadowColor = 'transparent';
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    c.beginPath();
    c.arc(cx, cy, r - 1, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255,255,255,.22)';
    c.lineWidth = 1.5;
    c.stroke();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.strokeStyle = type === 'enemy' ? '#8b2020' : type === 'npc' ? '#c9983a' : '#5a8a9f';
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,.9)';
    c.font = `bold ${Math.floor(size * 0.38)}px 'Cinzel',serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(initial, cx, cy + 1);
    c.restore();
    this.spriteSlots.set(key, slot);
    return slot;
  }

  /** Atlas introspection for tests / profiling. */
  get spriteAtlasPageCount(): number {
    return this.spriteAtlas.pageCount;
  }

  /** Drop every cached sprite slot and the atlas pages behind them. Used by
   *  tests and hot-reload. Does not touch image or procedural-canvas caches. */
  clearSpriteAtlas(): void {
    this.spriteSlots.clear();
    this.spriteAtlas.reset();
  }

  get(k: string): HTMLCanvasElement | null {
    return this.cache.get(k) ?? null;
  }

  /**
   * Return a loaded image handle for `url` if it's decoded, or start loading
   * it and return null. The renderer polls this on every frame; once the
   * load resolves we fire `onImageLoaded` so the renderer can redraw.
   *
   * Decode path:
   *   - http(s) URL → `fetch` + `createImageBitmap` so decode runs off the
   *     main thread (phase B [S]). Cross-origin images need CORS headers
   *     from the server; without them the fetch rejects and we fall back.
   *   - data: URL → skip fetch overhead and use `new Image()` directly.
   *   - any failure → fall back to `new Image()` so the old behaviour is
   *     preserved for legacy environments and hosts without CORS.
   */
  getImage(url: string): DecodedImage | null {
    const hit = this.images.get(url);
    if (hit instanceof HTMLImageElement) return hit;
    // `ImageBitmap` check is defensive — jsdom / SSR may not define it.
    if (typeof ImageBitmap !== 'undefined' && hit instanceof ImageBitmap) return hit;
    if (hit) return null; // in flight
    const pending = this.decode(url);
    this.images.set(url, pending);
    pending.then(
      (loaded) => {
        this.images.set(url, loaded);
        this.onImageLoaded?.();
      },
      () => {
        this.images.delete(url);
      }
    );
    return null;
  }

  /**
   * Return a decoded {@link Asset} for `url`, or `null` if it's still
   * loading. Handles three asset kinds:
   *   - animated `video`     → HTMLVideoElement, muted + looping
   *   - static  `image`      → image bitmap via the existing decode path
   *   - sheet   `sprite`     → the underlying image decoded as for `image`,
   *                            wrapped with `cols/rows/fps` for frame math
   *
   * `animation` controls which path is taken when present; when `undefined`
   * the caller wants a plain image (backwards-compat with existing token
   * art). The video path falls through to a static image when the token
   * URL doesn't carry a video type — graceful degradation beats exploding.
   */
  getAsset(url: string, animation?: AnimationDescriptor): Asset | null {
    if (!animation) {
      const img = this.getImage(url);
      return img ? { kind: 'image', source: img } : null;
    }
    if (animation.kind === 'video') {
      const vid = this.getVideo(url);
      if (!vid) return null;
      return { kind: 'video', source: vid };
    }
    // sprite sheet — same decode as a static image, extra metadata attached
    const img = this.getImage(url);
    if (!img) return null;
    return {
      kind: 'sprite',
      source: img,
      cols: animation.cols,
      rows: animation.rows,
      fps: animation.fps
    };
  }

  /**
   * Blit a decoded asset at `(dx, dy, dw, dh)`. Branches on the asset's
   * discriminant so the renderer can stay ignorant of the underlying
   * format:
   *   - `image`  → 5-arg drawImage with the decoded bitmap/element.
   *   - `video`  → same — `ctx.drawImage(HTMLVideoElement)` paints the
   *     current frame; the browser handles buffer swap as the video ticks.
   *   - `sprite` → 9-arg drawImage picking the current frame sub-rect out
   *     of a spritesheet arranged row-major in `cols × rows` cells at
   *     `fps` frames/second.
   *
   * `now` is `performance.now()` (ms); passed in so all tokens in a frame
   * see the same clock value — avoids a subtle tearing where sibling
   * sprites read slightly different frame indices.
   */
  drawAsset(
    ctx: CanvasRenderingContext2D,
    asset: Asset,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    now: number
  ): void {
    if (asset.kind === 'image') {
      ctx.drawImage(asset.source, dx, dy, dw, dh);
      return;
    }
    if (asset.kind === 'video') {
      // `readyState >= HAVE_CURRENT_DATA` (2) is enforced by getVideo — by
      // the time we get here the element has at least one frame on hand.
      ctx.drawImage(asset.source, dx, dy, dw, dh);
      return;
    }
    // Sprite sheet — pick the current frame.
    const total = asset.cols * asset.rows;
    if (total <= 0) return;
    const frame = Math.floor((now / 1000) * asset.fps) % total;
    const fw = asset.source.width / asset.cols;
    const fh = asset.source.height / asset.rows;
    const col = frame % asset.cols;
    const row = Math.floor(frame / asset.cols);
    ctx.drawImage(
      asset.source,
      col * fw, row * fh, fw, fh,
      dx, dy, dw, dh
    );
  }

  /**
   * True when any cached asset is animated (live videos or sprite-sheet
   * tokens requested this tab session). The renderer polls this to decide
   * whether to keep repainting after the store has settled — a video or
   * sprite animation advances independently of store mutations.
   */
  hasAnimatedAssets(): boolean {
    if (this.videos.size > 0) return true;
    return false;
  }

  /**
   * Get (and lazily load) an `<video>` element for `url`. Muted, looping,
   * and `playsinline` so mobile Safari doesn't fullscreen on play. Returns
   * null until the video has at least one frame ready to paint.
   */
  private getVideo(url: string): HTMLVideoElement | null {
    const hit = this.videos.get(url);
    if (hit) {
      // HAVE_CURRENT_DATA = 2 → a frame is available for drawImage.
      return hit.readyState >= 2 ? hit : null;
    }
    const v = document.createElement('video');
    v.src = url;
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    // Kick autoplay — Safari wants an explicit play() call even with
    // autoplay + muted. Silently ignore rejection (policy-blocked autoplay).
    v.play().catch(() => { /* user gesture will start it later */ });
    v.addEventListener('loadeddata', () => this.onImageLoaded?.());
    v.addEventListener('error', () => this.videos.delete(url));
    this.videos.set(url, v);
    return null;
  }

  /**
   * Kick off a decode. Prefers `createImageBitmap` for off-thread work on
   * http URLs; falls back to `new Image()` + onload for data URLs and for
   * environments where the modern path is unavailable.
   */
  private async decode(url: string): Promise<DecodedImage> {
    // `data:` URLs don't benefit from fetch — the bytes are already in the
    // string. HTMLImageElement decoding for data URLs is synchronous-ish
    // and has no off-thread advantage to reclaim.
    const isDataUrl = url.startsWith('data:');
    if (HAS_IMAGE_BITMAP && !isDataUrl) {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        return await createImageBitmap(blob);
      } catch {
        // Fall through to Image() — e.g. a host without CORS headers.
      }
    }
    return this.decodeViaImage(url);
  }

  private decodeViaImage(url: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    return new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Image failed to load: ${url.slice(0, 64)}`));
      img.src = url;
    });
  }

  /**
   * Walk an ordered list of URLs and return the first one that's already
   * decoded. For each URL we touch, `getImage` kicks off a decode if it's
   * not cached — so a missing primary naturally falls through to a loaded
   * fallback this frame, and the primary will replace it on the next frame
   * via the `onImageLoaded` callback.
   *
   * This is the shared resolver behind the token-art fallback chain
   * (`tok.image` → `sheet.portrait` → procedural). Callers pass `undefined`
   * for any tier they don't have, and we skip those transparently.
   */
  resolveFirstReady(...urls: Array<string | undefined | null>): DecodedImage | null {
    for (const u of urls) {
      if (!u) continue;
      const v = this.getImage(u);
      if (v) return v;
    }
    return null;
  }

  /** Drop cached entries no longer referenced (e.g. when the user replaces
   * the map image or removes token art). Conservative: only drops entries
   * whose keys are not in `keep`. ImageBitmap handles are explicitly closed
   * so the GPU-side pixels release without waiting on GC. */
  pruneImages(keep: Iterable<string>): void {
    const keepSet = new Set(keep);
    for (const [k, v] of this.images) {
      if (keepSet.has(k)) continue;
      if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) {
        try { v.close(); } catch { /* already closed */ }
      }
      this.images.delete(k);
    }
  }
}

export const assets = new AssetManager();
