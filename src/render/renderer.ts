import { store, type State } from '../state/store';
import { camera } from '../engine/camera';
import { WallDraft } from '../engine/walls';
import { VisibilityProvider } from '../engine/visibility';
import { GRID_SIZE, MAP_W, MAP_H, FEET_PER_CELL, ftToPx, distanceFt, MAP_CELLS_X, MAP_CELLS_Y } from '../engine/grid';
import { tokenInside, templatePath } from '../engine/aoe';
import { CONDITIONS_BY_ID } from '../engine/conditions';
import { canSeeTokenHp } from '../features/roles';
import { assets, AssetManager, type DecodedImage, type Asset } from './assets';
import { assetPacks } from '../features/assetManifest';
import type { Token, AoETemplate, Wall } from '../state/schemas';

/**
 * Canvas renderer.
 *
 * Dirty-flag gated: we only re-draw when the store says something changed,
 * when the wall-draft is in flight, or when a token is lerping toward its
 * target world position. 60fps unconditional draw was item #7 in "what's
 * wrong today".
 */

export class Renderer {
  private fps = 60;
  private frameCount = 0;
  private lastFpsTime = performance.now();
  /** Per-token render position (interpolated toward wx/wy). */
  private renderPos = new Map<number, { rx: number; ry: number; pulse: number }>();
  /**
   * #24 — cache prefers-reduced-motion once. Users who opt out of motion
   * should not get the selection dash sweep or initiative pulse.
   */
  private reducedMotion = false;

  measureStart: { wx: number; wy: number } | null = null;
  measureEnd: { wx: number; wy: number } | null = null;
  wallDraft = new WallDraft();
  aoePreview: AoETemplate | null = null;
  /**
   * Token drag trail (review item §2 #5). While the player is dragging a
   * token, `tokenDrag` is non-null so the overlay layer draws the origin,
   * the live path to the current cursor cell, and a distance label. Cleared
   * on mouseup.
   */
  tokenDrag: {
    tokenId: number;
    from: { wx: number; wy: number };
    /** Last cell the cursor snapped to (updated on every mousemove). */
    to: { wx: number; wy: number };
    /** Ordered list of snapped cells traversed, for the highlight path. */
    path: Array<{ wx: number; wy: number }>;
  } | null = null;

  /**
   * Manual fog-of-war brush preview (review §2 #7). Set while the GM is
   * drag-painting a rectangular region before releasing.
   */
  fogBrushPreview: {
    mode: 'reveal' | 'hide';
    a: { wx: number; wy: number };
    b: { wx: number; wy: number };
  } | null = null;

  /**
   * Static walls cache (phase A #5). Committed walls rarely change, but
   * every frame was re-stroking every line + 2 arcs per wall. Instead we
   * rasterize them once into a world-space canvas and blit the whole thing.
   * Keyed on the walls array reference — the store spreads into a new array
   * on every mutation, so `!==` is a cheap revision check.
   */
  private staticWallsCanvas: HTMLCanvasElement | null = null;
  private staticWallsRef: readonly Wall[] | null = null;

  /**
   * Fog compositing canvas (phase A #6). Previously the main canvas had
   * `destination-out` + `source-atop` smeared onto it, which forces the
   * compositor to treat the whole canvas as one layer. Now fog builds on
   * its own buffer and blits with a plain `source-over`, keeping the main
   * context composite-mode-free for future lighting / weather layers.
   */
  private fogCanvas: HTMLCanvasElement | null = null;

  /**
   * Background composite cache (phase B #20 — dirty-rect partial redraws).
   *
   * Real dirty-rect compositing (track bounding boxes, clip to them, redraw
   * only what moved) is a big refactor and unlocks modest wins for this
   * scene — most frames already just lerp a token. Instead we cache the
   * expensive static layers (map / grid / walls / AoE) into a viewport-sized
   * canvas and blit one `drawImage` per frame. Dynamic layers (tokens,
   * overlay, manual + vision fog) still draw fresh. The cache is invalidated
   * whenever any input feeding the static composite changes.
   *
   * Key is a signature string assembled from the inputs; when it matches the
   * prior frame's signature we skip the expensive redraw entirely.
   */
  private bgCanvas: HTMLCanvasElement | null = null;
  /**
   * Prior frame's cache-detect inputs. Reference-equality checks cover the
   * store-owned arrays/objects (the store spreads into new containers on
   * every mutation, so `!==` tracks revisions for free). Scalars and the
   * wallDraft/aoePreview live-edit preview are checked by value.
   */
  private bgLast: {
    walls: readonly Wall[];
    aoeTemplates: readonly AoETemplate[];
    layers: State['layers'];
    mapImage: string | null;
    W: number;
    H: number;
    dpr: number;
    camX: number;
    camY: number;
    camZ: number;
    wallDraftSig: string;
    aoePreviewSig: string;
  } | null = null;
  /**
   * Instrumentation counter — how many frames reused the background cache
   * vs. rebuilt it. Exposed via `bgCacheStats()` for perf logging + tests.
   */
  private bgCacheHits = 0;
  private bgCacheMisses = 0;

  /**
   * Visibility compute offload (phase A #8). On large scenes the raycaster
   * dominates frame time; the provider runs it in a Web Worker and seeds the
   * main-thread cache on reply. When a fresh result lands we bump the dirty
   * flag so the next frame picks up the sharper polygon.
   */
  private readonly visibility: VisibilityProvider;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly ctx: CanvasRenderingContext2D) {
    this.visibility = new VisibilityProvider({ onResult: () => this.scheduleDirty() });
    // When an uploaded image finishes decoding, flag the scene dirty so the
    // next frame picks it up (otherwise the dirty-flag loop skips the paint).
    assets.onImageLoaded = () => this.scheduleDirty();
    // #24 — honour the user's reduced-motion preference. Re-reads on change
    // so toggling OS-level settings during a session takes effect.
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = mq.matches;
      mq.addEventListener?.('change', (e) => {
        this.reducedMotion = e.matches;
        this.scheduleDirty();
      });
    } catch {
      this.reducedMotion = false;
    }
  }

  start(): void {
    const tick = () => {
      this.stepAnimations();
      const s = store.getState();
      if (
        s.dirty ||
        this.wallDraft.drawing ||
        this.aoePreview ||
        this.tokenDrag ||
        this.fogBrushPreview ||
        this.hasLerping(s) ||
        this.hasAnimatedTokens(s)
      ) {
        this.drawFrame();
        store.getState().clearDirty();
      }
      // Reset the dirty-schedule gate once per frame so the next animation
      // step / asset-load callback can re-arm a repaint.
      this.dirtyScheduled = false;
      this.updateFpsCounter();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private stepAnimations(): void {
    const s = store.getState();
    let moved = false;
    for (const tok of s.tokens) {
      let pos = this.renderPos.get(tok.id);
      if (!pos) {
        pos = { rx: tok.wx, ry: tok.wy, pulse: Math.random() * Math.PI * 2 };
        this.renderPos.set(tok.id, pos);
      }
      const rx = pos.rx + (tok.wx - pos.rx) * 0.22;
      const ry = pos.ry + (tok.wy - pos.ry) * 0.22;
      if (Math.abs(rx - pos.rx) > 0.01 || Math.abs(ry - pos.ry) > 0.01) moved = true;
      pos.rx = rx;
      pos.ry = ry;
      pos.pulse += 0.04;
    }
    // One markDirty per frame max — scheduleDirty is a no-op after the first
    // hit until the next `tick` resets it. Avoids a flood of store writes
    // when several tokens lerp simultaneously or several subsystems signal
    // dirty in the same frame (e.g. resize + asset-load + animation step).
    if (moved) this.scheduleDirty();
  }

  /**
   * Coalesced dirty-flag setter.
   *
   * Zustand's `markDirty` is cheap per call, but several callers (animation
   * step, asset decode, resize, media-query change) can all fire in the same
   * frame, each triggering a subscriber dispatch. Funnel them through this
   * helper: mark the store dirty once, and only again after the next
   * `drawFrame` has cleared it.
   */
  private dirtyScheduled = false;
  private scheduleDirty(): void {
    if (this.dirtyScheduled) return;
    this.dirtyScheduled = true;
    store.getState().markDirty();
  }

  /** Drop the static walls cache. Next draw rebuilds from scratch. */
  private invalidateStaticLayer(): void {
    this.staticWallsCanvas = null;
    this.staticWallsRef = null;
  }

  /** Drop the fog composite buffer (e.g. on resize — size changes). */
  private invalidateFogLayer(): void {
    this.fogCanvas = null;
  }

  /**
   * Build (or reuse) the world-space canvas that holds every committed
   * wall. Rebuilds only when `walls` is a new array reference — the store
   * replaces, never mutates, so reference equality tracks revisions.
   */
  private ensureStaticWalls(walls: readonly Wall[]): HTMLCanvasElement {
    if (this.staticWallsCanvas && this.staticWallsRef === walls) {
      return this.staticWallsCanvas;
    }
    const cvs = this.staticWallsCanvas ?? document.createElement('canvas');
    cvs.width = MAP_W;
    cvs.height = MAP_H;
    const c = cvs.getContext('2d')!;
    c.clearRect(0, 0, MAP_W, MAP_H);
    // World-space stroke widths. At zoom 1 this yields the same ~3 px the
    // per-frame code used; at higher zooms the line naturally thickens,
    // which matches the behaviour readers expect from a baked map asset.
    c.strokeStyle = 'rgba(220,55,55,.65)';
    c.fillStyle = 'rgba(220,55,55,.85)';
    c.lineCap = 'round';
    c.lineWidth = 3;
    for (const seg of walls) {
      c.beginPath();
      c.moveTo(seg.x1, seg.y1);
      c.lineTo(seg.x2, seg.y2);
      c.stroke();
      c.beginPath();
      c.arc(seg.x1, seg.y1, 4, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(seg.x2, seg.y2, 4, 0, Math.PI * 2);
      c.fill();
    }
    this.staticWallsCanvas = cvs;
    this.staticWallsRef = walls;
    return cvs;
  }

  /**
   * Return (creating on demand) a DPR-sized offscreen canvas for fog
   * compositing. Resetting `fogCanvas` on resize keeps it in sync with
   * the main canvas's backing store.
   */
  private ensureFogCanvas(W: number, H: number): HTMLCanvasElement {
    const targetW = Math.max(1, Math.round(W * devicePixelRatio));
    const targetH = Math.max(1, Math.round(H * devicePixelRatio));
    if (this.fogCanvas && this.fogCanvas.width === targetW && this.fogCanvas.height === targetH) {
      return this.fogCanvas;
    }
    const cvs = document.createElement('canvas');
    cvs.width = targetW;
    cvs.height = targetH;
    this.fogCanvas = cvs;
    return cvs;
  }

  private hasLerping(s: State): boolean {
    for (const tok of s.tokens) {
      const pos = this.renderPos.get(tok.id);
      if (!pos) continue;
      if (Math.abs(pos.rx - tok.wx) > 0.5 || Math.abs(pos.ry - tok.wy) > 0.5) return true;
    }
    return false;
  }

  /**
   * True when any on-screen token carries an `animation` descriptor.
   * Animated assets tick independently of store mutations, so we must keep
   * repainting while they're active even if `dirty` is clear.
   */
  private hasAnimatedTokens(s: State): boolean {
    for (const tok of s.tokens) {
      if (tok.animation) return true;
    }
    return false;
  }

  private getRenderPos(id: number, fallbackX: number, fallbackY: number): { rx: number; ry: number } {
    const p = this.renderPos.get(id);
    if (!p) return { rx: fallbackX, ry: fallbackY };
    return { rx: p.rx, ry: p.ry };
  }

  resize(): void {
    this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * devicePixelRatio;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    // The fog canvas is sized to the viewport, so it must be rebuilt. The
    // static walls canvas is world-space (MAP_W × MAP_H) and survives.
    this.invalidateFogLayer();
    this.invalidateBgCache();
    this.scheduleDirty();
  }

  private drawFrame(): void {
    const ctx = this.ctx;
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;

    const s = store.getState();

    // Static-layer composite (map + grid + walls + AoE). Rebuilds only when
    // one of its inputs changes — for frames that only lerp tokens or tick
    // an animation the whole composite blits in a single drawImage.
    const bg = this.ensureBgComposite(s, W, H);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);

    // Dynamic layers — these depend on per-frame state (lerp positions,
    // selected token, animation time) so they're never cached.
    this.drawTokens(s, W, H);
    this.drawOverlay(s, W, H);
    this.drawManualFog(s, W, H);
    this.drawVision(s, W, H);
  }

  /** Drop the bg cache. Call whenever the static layer's inputs might change. */
  private invalidateBgCache(): void {
    this.bgCanvas = null;
    this.bgLast = null;
  }

  /**
   * Live-edit preview signature — the wallDraft end-point and AoE preview
   * origin/size change continuously as the cursor moves, and the composite
   * must re-render to reflect them. Concatenated into a small string so the
   * equality check in `ensureBgComposite` is one compare instead of four.
   */
  private bgPreviewSig(): { wallDraftSig: string; aoePreviewSig: string } {
    const wd = this.wallDraft;
    const wallDraftSig = wd.drawing && wd.current
      ? `${wd.current.x.toFixed(1)},${wd.current.y.toFixed(1)}`
      : '';
    const ap = this.aoePreview;
    const aoePreviewSig = ap
      ? `${ap.id}:${ap.originX.toFixed(1)},${ap.originY.toFixed(1)}:${ap.sizeFt}:${ap.angle.toFixed(3)}`
      : '';
    return { wallDraftSig, aoePreviewSig };
  }

  /**
   * Build (or return the cached) background composite canvas. The canvas is
   * sized to the main canvas's DPR-backed buffer so a direct `drawImage` at
   * CSS dimensions produces a pixel-accurate blit.
   */
  private ensureBgComposite(s: State, W: number, H: number): HTMLCanvasElement {
    const dpr = devicePixelRatio;
    const { wallDraftSig, aoePreviewSig } = this.bgPreviewSig();
    const last = this.bgLast;
    const hit =
      this.bgCanvas !== null &&
      last !== null &&
      last.walls === s.walls &&
      last.aoeTemplates === s.aoeTemplates &&
      last.layers === s.layers &&
      last.mapImage === s.mapImage &&
      last.W === W &&
      last.H === H &&
      last.dpr === dpr &&
      last.camX === camera.x &&
      last.camY === camera.y &&
      last.camZ === camera.zoom &&
      last.wallDraftSig === wallDraftSig &&
      last.aoePreviewSig === aoePreviewSig;
    if (hit) {
      this.bgCacheHits++;
      return this.bgCanvas!;
    }
    this.bgCacheMisses++;
    const targetW = Math.max(1, Math.round(W * devicePixelRatio));
    const targetH = Math.max(1, Math.round(H * devicePixelRatio));
    const cvs = this.bgCanvas && this.bgCanvas.width === targetW && this.bgCanvas.height === targetH
      ? this.bgCanvas
      : document.createElement('canvas');
    cvs.width = targetW;
    cvs.height = targetH;
    const bctx = cvs.getContext('2d')!;
    bctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    bctx.clearRect(0, 0, W, H);
    bctx.fillStyle = '#050302';
    bctx.fillRect(0, 0, W, H);

    // Swap `this.ctx` for the bg context so the existing layer helpers draw
    // into the offscreen buffer. Restore after — the rest of drawFrame
    // expects `this.ctx` to point at the main canvas.
    const prevCtx = this.ctx;
    (this as unknown as { ctx: CanvasRenderingContext2D }).ctx = bctx;
    try {
      this.drawMap(s, W, H);
      this.drawGrid(s, W, H);
      this.drawAoe(s, W, H);
      this.drawWalls(s, W, H);
    } finally {
      (this as unknown as { ctx: CanvasRenderingContext2D }).ctx = prevCtx;
    }

    this.bgCanvas = cvs;
    this.bgLast = {
      walls: s.walls,
      aoeTemplates: s.aoeTemplates,
      layers: s.layers,
      mapImage: s.mapImage,
      W,
      H,
      dpr,
      camX: camera.x,
      camY: camera.y,
      camZ: camera.zoom,
      wallDraftSig,
      aoePreviewSig
    };
    return cvs;
  }

  /** Cache-hit-rate introspection for perf logging / tests. */
  bgCacheStats(): { hits: number; misses: number } {
    return { hits: this.bgCacheHits, misses: this.bgCacheMisses };
  }

  private drawMap(s: State, W: number, H: number): void {
    if (!s.layers.map) return;
    // Prefer the uploaded image when present; fall back to the procedural
    // texture (§3 image-map support — review §3).
    if (s.mapImage) {
      const uploaded = assets.getImage(s.mapImage);
      if (uploaded) {
        camera.applyTransform(this.ctx, W, H);
        this.ctx.drawImage(uploaded, 0, 0, MAP_W, MAP_H);
        camera.restoreTransform(this.ctx);
        return;
      }
      // Image still decoding — fall through to procedural so the user sees
      // *something* while the data URL decodes.
    }
    const img = assets.get('__map__');
    if (!img) return;
    camera.applyTransform(this.ctx, W, H);
    this.ctx.drawImage(img, 0, 0, MAP_W, MAP_H);
    camera.restoreTransform(this.ctx);
  }

  private drawGrid(s: State, W: number, H: number): void {
    if (!s.layers.grid) return;
    const ctx = this.ctx;
    camera.applyTransform(ctx, W, H);
    ctx.strokeStyle = 'rgba(201,152,58,0.12)';
    ctx.lineWidth = 1 / camera.zoom;
    const sx = Math.floor((camera.x - W / (2 * camera.zoom)) / GRID_SIZE) * GRID_SIZE;
    const sy = Math.floor((camera.y - H / (2 * camera.zoom)) / GRID_SIZE) * GRID_SIZE;
    const ex = camera.x + W / (2 * camera.zoom) + GRID_SIZE;
    const ey = camera.y + H / (2 * camera.zoom) + GRID_SIZE;
    ctx.beginPath();
    for (let x = sx; x <= ex; x += GRID_SIZE) {
      ctx.moveTo(x, sy);
      ctx.lineTo(x, ey);
    }
    for (let y = sy; y <= ey; y += GRID_SIZE) {
      ctx.moveTo(sx, y);
      ctx.lineTo(ex, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(201,152,58,0.05)';
    ctx.lineWidth = 2 / camera.zoom;
    ctx.beginPath();
    const major = GRID_SIZE * 5;
    for (let x = Math.floor(sx / major) * major; x <= ex; x += major) {
      ctx.moveTo(x, sy);
      ctx.lineTo(x, ey);
    }
    for (let y = Math.floor(sy / major) * major; y <= ey; y += major) {
      ctx.moveTo(sx, y);
      ctx.lineTo(ex, y);
    }
    ctx.stroke();
    camera.restoreTransform(ctx);
  }

  private drawWalls(s: State, W: number, H: number): void {
    const ctx = this.ctx;
    camera.applyTransform(ctx, W, H);
    // Committed walls come from a world-space cache (ensureStaticWalls) and
    // blit as a single drawImage — replaces a per-wall stroke + arc loop
    // that dominated the frame on 500-wall maps.
    ctx.drawImage(this.ensureStaticWalls(s.walls), 0, 0);
    // Draft wall (in-flight wall tool) stays per-frame: it's the one thing
    // about this layer that actually changes while it matters.
    if (this.wallDraft.drawing && this.wallDraft.start && this.wallDraft.current) {
      ctx.strokeStyle = 'rgba(255,90,90,.45)';
      ctx.lineWidth = 2 / camera.zoom;
      ctx.setLineDash([8 / camera.zoom, 4 / camera.zoom]);
      ctx.beginPath();
      ctx.moveTo(this.wallDraft.start.x, this.wallDraft.start.y);
      ctx.lineTo(this.wallDraft.current.x, this.wallDraft.current.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    camera.restoreTransform(ctx);
  }

  private drawAoe(s: State, W: number, H: number): void {
    const ctx = this.ctx;
    camera.applyTransform(ctx, W, H);
    for (const tpl of s.aoeTemplates) this.paintTemplate(tpl, false);
    if (this.aoePreview) this.paintTemplate(this.aoePreview, true);
    camera.restoreTransform(ctx);
  }

  private paintTemplate(tpl: AoETemplate, preview: boolean): void {
    const ctx = this.ctx;
    const path = templatePath(tpl);
    ctx.save();
    ctx.fillStyle = preview ? 'rgba(200,98,42,0.14)' : 'rgba(200,98,42,0.22)';
    ctx.strokeStyle = 'rgba(200,98,42,0.9)';
    ctx.lineWidth = 2 / camera.zoom;
    ctx.setLineDash(preview ? [6 / camera.zoom, 4 / camera.zoom] : []);
    ctx.fill(path);
    ctx.stroke(path);
    ctx.setLineDash([]);
    // label
    ctx.fillStyle = 'rgba(245,237,214,0.85)';
    ctx.font = `500 ${12 / camera.zoom}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${tpl.sizeFt}ft ${tpl.shape}`, tpl.originX, tpl.originY);
    ctx.restore();
  }

  private drawTokens(s: State, W: number, H: number): void {
    if (!s.layers.tokens) return;
    const ctx = this.ctx;
    const size = GRID_SIZE * 0.85;
    const half = size / 2;
    // Scale factor between the baked sprite (core + shadow pad) and the
    // on-map core size. Multiplying by this gives the drawImage target size.
    const spriteCore = Math.round(GRID_SIZE * 0.85);
    const spriteFull = AssetManager.spriteDrawSize(spriteCore);
    const spriteScale = size / spriteCore;
    const drawFull = spriteFull * spriteScale;
    const drawHalf = drawFull / 2;
    camera.applyTransform(ctx, W, H);
    const now = performance.now();
    for (const tok of s.tokens) {
      const { rx, ry } = this.getRenderPos(tok.id, tok.wx, tok.wy);
      // Custom token art (§3 graphics). Sprite has no baked shadow — user art
      // comes in arbitrary shapes — so we keep a lightweight shadow here
      // only when art is present. Procedural sprites carry their own halo.
      //
      // Fallback chain (Phase B): `Token.image` → `CharacterSheet.portrait` →
      // procedural letter circle. If the primary URL hasn't decoded yet, a
      // loaded sheet portrait wins so the token doesn't flicker to procedural
      // while the preferred art is still decoding.
      //
      // Animated tokens (Phase B [M]): when `tok.animation` is set, resolve
      // the primary URL as an Asset (video / sprite sheet) and blit via
      // `drawAsset`. Sheet-portrait fallback still wins the first paint while
      // the animated source decodes so the token doesn't flash procedural.
      const sheet = tok.sheetId ? s.sheets[tok.sheetId] : undefined;
      let custom: DecodedImage | null = null;
      let animatedAsset: Asset | null = null;
      if (tok.animation && tok.image) {
        animatedAsset = assets.getAsset(tok.image, tok.animation);
      }
      if (!animatedAsset) {
        // Either no animation, or the animated asset hasn't loaded yet —
        // either way, resolve the static fallback chain.
        custom = assets.resolveFirstReady(tok.image, sheet?.portrait);
      }
      if (animatedAsset) {
        // Circular clip keeps arbitrary aspect ratios inside the cell.
        ctx.save();
        ctx.beginPath();
        ctx.arc(rx, ry, half, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        assets.drawAsset(ctx, animatedAsset, rx - half, ry - half, size, size, now);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(rx, ry, half, 0, Math.PI * 2);
        ctx.strokeStyle = tok.type === 'enemy' ? '#8b2020' : tok.type === 'npc' ? '#c9983a' : '#5a8a9f';
        ctx.lineWidth = 2 / camera.zoom;
        ctx.stroke();
      } else if (custom) {
        // Circular clip so non-circular portraits don't overflow the cell.
        ctx.save();
        ctx.beginPath();
        ctx.arc(rx, ry, half, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(custom, rx - half, ry - half, size, size);
        ctx.restore();
        // Type-coded ring so enemies vs. allies stay distinguishable.
        ctx.beginPath();
        ctx.arc(rx, ry, half, 0, Math.PI * 2);
        ctx.strokeStyle = tok.type === 'enemy' ? '#8b2020' : tok.type === 'npc' ? '#c9983a' : '#5a8a9f';
        ctx.lineWidth = 2 / camera.zoom;
        ctx.stroke();
      } else {
        // Shadow is baked into the sprite (see assets.ts:SPRITE_SHADOW_PAD).
        // No per-draw shadowBlur — that filter is the single slowest 2D op
        // and was running once per token per frame.
        //
        // Phase B [M]: sprite is a rect inside a shared atlas canvas, not a
        // standalone element — 9-arg drawImage picks the slot out.
        const slot = assets.generateTokenSprite({
          color: tok.color,
          initial: tok.initial,
          type: tok.type,
          size: spriteCore
        });
        ctx.drawImage(
          slot.source,
          slot.sx, slot.sy, slot.sw, slot.sh,
          rx - drawHalf, ry - drawHalf, drawFull, drawFull
        );
      }
      if (tok.dead) {
        ctx.strokeStyle = 'rgba(180,60,60,.85)';
        ctx.lineWidth = 2 / camera.zoom;
        ctx.beginPath();
        ctx.moveTo(rx - half, ry - half);
        ctx.lineTo(rx + half, ry + half);
        ctx.moveTo(rx + half, ry - half);
        ctx.lineTo(rx - half, ry + half);
        ctx.stroke();
      }
    }
    camera.restoreTransform(ctx);
  }

  private drawOverlay(s: State, W: number, H: number): void {
    if (!s.layers.overlay) return;
    const ctx = this.ctx;
    const size = GRID_SIZE * 0.85;
    const half = size / 2;

    // Highlight tokens within any committed template.
    const affectedIds = new Set<number>();
    for (const tpl of s.aoeTemplates) {
      for (const tok of s.tokens) if (tokenInside(tok, tpl)) affectedIds.add(tok.id);
    }
    if (this.aoePreview) {
      for (const tok of s.tokens) if (tokenInside(tok, this.aoePreview)) affectedIds.add(tok.id);
    }

    for (const tok of s.tokens) {
      const { rx, ry } = this.getRenderPos(tok.id, tok.wx, tok.wy);
      const { sx, sy } = camera.worldToScreen(rx, ry, W, H);
      const ss = size * camera.zoom;

      // Initiative pulse (static ring when prefers-reduced-motion, #24).
      if (s.initiative.order.length && s.initiative.order[s.initiative.current]?.id === tok.id) {
        ctx.strokeStyle = 'rgba(201,152,58,0.7)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx, sy, (half + 9) * camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Selection ring. The animated dash sweep is disabled for users
      // who prefer reduced motion (#24) — we still draw the ring, just
      // without the rotating dash offset.
      if (tok.id === s.selectedTokenId) {
        ctx.strokeStyle = 'rgba(200,98,42,.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.lineDashOffset = this.reducedMotion ? 0 : -Date.now() / 80;
        ctx.beginPath();
        ctx.arc(sx, sy, (half + 6) * camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Affected-by-AoE halo.
      if (affectedIds.has(tok.id)) {
        ctx.strokeStyle = 'rgba(255,150,80,.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, (half + 3) * camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
      }

      // HP bar — hidden for enemies in player mode.
      if (camera.zoom > 0.44) {
        const bw = ss * 0.8;
        const bh = Math.max(2.5, camera.zoom * 4);
        const bx = sx - bw / 2;
        const by = sy + half * camera.zoom + 4;
        if (canSeeTokenHp(tok)) {
          const pct = Math.max(0, Math.min(1, tok.hp / tok.maxHp));
          ctx.fillStyle = 'rgba(0,0,0,.5)';
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 2);
          ctx.fill();
          ctx.fillStyle = pct > 0.6 ? '#4a8a3a' : pct > 0.3 ? '#c9983a' : '#8b2020';
          ctx.beginPath();
          ctx.roundRect(bx, by, bw * pct, bh, 2);
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(140,32,32,.45)';
          ctx.beginPath();
          ctx.roundRect(bx, by, bw, bh, 2);
          ctx.fill();
        }
      }

      // Name label.
      if (camera.zoom > 0.58) {
        const fs = Math.max(8, Math.min(11, camera.zoom * 10));
        ctx.font = `400 ${fs}px 'Crimson Pro',serif`;
        ctx.textAlign = 'center';
        const ny = sy - half * camera.zoom - 6;
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillText(tok.name, sx + 1, ny + 1);
        ctx.fillStyle = '#f5edd6';
        ctx.fillText(tok.name, sx, ny);
      }

      // Condition icons ringing the token.
      this.drawConditionIcons(tok, sx, sy, half * camera.zoom);
    }

    // Drag trail (§2 #5) — live path + distance while a token is being dragged.
    if (this.tokenDrag) {
      const { from, to, path } = this.tokenDrag;
      const fromScreen = camera.worldToScreen(from.wx, from.wy, W, H);
      const toScreen = camera.worldToScreen(to.wx, to.wy, W, H);

      // Highlighted cells traversed.
      const cellPx = GRID_SIZE * camera.zoom;
      ctx.fillStyle = 'rgba(200,98,42,0.14)';
      ctx.strokeStyle = 'rgba(200,98,42,0.45)';
      ctx.lineWidth = 1;
      for (const cell of path) {
        const c = camera.worldToScreen(cell.wx, cell.wy, W, H);
        ctx.fillRect(c.sx - cellPx / 2, c.sy - cellPx / 2, cellPx, cellPx);
        ctx.strokeRect(c.sx - cellPx / 2, c.sy - cellPx / 2, cellPx, cellPx);
      }

      // #15 — destination-cell highlight. Tinted to match the distance-pill
      // border so players see exactly where their token will snap on release.
      {
        const destFill = 'rgba(200,98,42,0.28)';
        const destStroke = 'rgba(200,98,42,0.9)';
        ctx.fillStyle = destFill;
        ctx.strokeStyle = destStroke;
        ctx.lineWidth = 1.5;
        ctx.fillRect(toScreen.sx - cellPx / 2, toScreen.sy - cellPx / 2, cellPx, cellPx);
        ctx.strokeRect(toScreen.sx - cellPx / 2, toScreen.sy - cellPx / 2, cellPx, cellPx);
      }

      // Dashed trail origin → current.
      ctx.strokeStyle = 'rgba(245,237,214,.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(fromScreen.sx, fromScreen.sy);
      ctx.lineTo(toScreen.sx, toScreen.sy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Origin marker.
      ctx.fillStyle = 'rgba(245,237,214,.8)';
      ctx.beginPath();
      ctx.arc(fromScreen.sx, fromScreen.sy, 4, 0, Math.PI * 2);
      ctx.fill();

      // Distance chip (chessboard / 5-5-5 rule, matching the measure tool).
      const ft = distanceFt(from.wx, from.wy, to.wx, to.wy);
      const label = `${ft} ft`;
      ctx.font = `600 12px 'JetBrains Mono', monospace`;
      const pad = 6;
      const metrics = ctx.measureText(label);
      const lx = toScreen.sx + 12;
      const ly = toScreen.sy - 22;
      ctx.fillStyle = 'rgba(15,12,9,0.88)';
      ctx.strokeStyle = 'rgba(200,98,42,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lx - pad, ly - 14, metrics.width + pad * 2, 20, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f5edd6';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(label, lx, ly - 4);
      ctx.textBaseline = 'alphabetic';
    }

    // Measure ruler.
    if (this.measureStart && this.measureEnd) {
      const a = camera.worldToScreen(this.measureStart.wx, this.measureStart.wy, W, H);
      const b = camera.worldToScreen(this.measureEnd.wx, this.measureEnd.wy, W, H);
      ctx.strokeStyle = 'rgba(200,98,42,.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
      ctx.setLineDash([]);
      [a, b].forEach((p) => {
        ctx.fillStyle = 'rgba(200,98,42,.9)';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      const dx = this.measureEnd.wx - this.measureStart.wx;
      const dy = this.measureEnd.wy - this.measureStart.wy;
      const ft = Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / GRID_SIZE) * FEET_PER_CELL;
      const el = document.getElementById('measure-display');
      if (el) el.textContent = `${ft} ft`;
    }
  }

  /**
   * Cache of conditionId → icon URL, derived from the loaded asset packs.
   *
   * Assets tagged with `'condition'` AND a conditionId tag (e.g.
   * `'blinded'`) are registered here the moment a pack lands in
   * `assetPacks`. The lookup is rebuilt via `assetPacks.onChange` so
   * adding or removing a pack does the right thing without a page
   * reload. Keeping the cache in the renderer (rather than on the
   * pack index) keeps the manifest module unaware of glyphs, tints,
   * and draw-order concerns — all renderer business.
   */
  private conditionIconCache: Map<string, string> | null = null;
  /** `null` until the first call subscribes; set to the unsubscribe fn. */
  private conditionIconUnsub: (() => void) | null = null;

  private getConditionIconUrl(conditionId: string): string | null {
    if (!this.conditionIconCache) {
      this.conditionIconCache = this.buildConditionIconCache();
      this.conditionIconUnsub = assetPacks.onChange(() => {
        this.conditionIconCache = this.buildConditionIconCache();
        store.getState().markDirty();
      });
    }
    return this.conditionIconCache.get(conditionId) ?? null;
  }

  private buildConditionIconCache(): Map<string, string> {
    const m = new Map<string, string>();
    for (const pack of assetPacks.list()) {
      for (const asset of pack.assets) {
        if (!asset.tags.includes('condition')) continue;
        // The conditionId is the second tag — see default-pack.json.
        // Any known condition id that appears in tags wins.
        for (const tag of asset.tags) {
          if (CONDITIONS_BY_ID.has(tag)) {
            // First-writer-wins so an earlier pack can be overridden
            // only by explicit removal, not by pack ordering churn.
            if (!m.has(tag)) m.set(tag, asset.url);
            break;
          }
        }
      }
    }
    return m;
  }

  private drawConditionIcons(tok: Token, sx: number, sy: number, radius: number): void {
    const s = store.getState();
    if (!tok.sheetId) return;
    const sheet = s.sheets[tok.sheetId];
    if (!sheet || !sheet.conditions.length) return;
    const ctx = this.ctx;
    const count = sheet.conditions.length;
    const iconR = Math.max(6, 7 * camera.zoom);
    const offset = radius + iconR + 3;
    ctx.font = `600 ${Math.max(8, 10 * camera.zoom)}px 'Cinzel', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < count; i++) {
      const angle = (-Math.PI / 2) + (i / Math.max(1, count)) * Math.PI * 2;
      const cx = sx + Math.cos(angle) * offset;
      const cy = sy + Math.sin(angle) * offset;
      const inst = sheet.conditions[i]!;
      const def = CONDITIONS_BY_ID.get(inst.id);
      // Chip background + ring, regardless of whether we draw a glyph or icon.
      ctx.fillStyle = 'rgba(20,18,14,0.92)';
      ctx.strokeStyle = def?.tint ?? '#c9983a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, iconR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Prefer a pack icon when one is available and decoded; otherwise
      // fall back to the single-character glyph so conditions always
      // render something — even before the starter pack lands.
      const iconUrl = this.getConditionIconUrl(inst.id);
      const decoded = iconUrl ? assets.getImage(iconUrl) : null;
      if (decoded) {
        // Fit the icon inside the chip with a small inset. Tint is applied
        // via a temporary canvas + `source-in` composite so monochrome
        // SVGs pick up the condition's color.
        const side = iconR * 1.7;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, iconR - 1, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(decoded, cx - side / 2, cy - side / 2, side, side);
        // Tint overlay — draw the ring color at low alpha through the
        // clipped circle so the icon reads in the condition's palette
        // without losing shape detail.
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = def?.tint ?? '#f5edd6';
        ctx.globalAlpha = 0.55;
        ctx.fillRect(cx - iconR, cy - iconR, iconR * 2, iconR * 2);
        ctx.restore();
      } else {
        ctx.fillStyle = def?.tint ?? '#f5edd6';
        ctx.fillText(def?.glyph ?? '?', cx, cy + 0.5);
      }
    }
  }

  /**
   * Manual fog-of-war (review §2 #7). When enabled, every cell not in the
   * `manualFog` set is obscured. The GM sees a translucent version (so they
   * can still prep); players see a fully opaque overlay.
   */
  private drawManualFog(s: State, W: number, H: number): void {
    if (!s.manualFogEnabled) {
      // Still show the brush preview when tool is active (even if fog isn't yet enabled).
      if (this.fogBrushPreview) this.paintBrushPreview(W, H);
      return;
    }
    const ctx = this.ctx;
    const revealed = new Set(s.manualFog);
    const alpha = s.role === 'gm' ? 0.55 : 0.98;

    camera.applyTransform(ctx, W, H);
    ctx.fillStyle = `rgba(10,8,6,${alpha})`;

    // Paint every off-map cell block in one path for the player view.
    for (let cy = 0; cy < MAP_CELLS_Y; cy++) {
      for (let cx = 0; cx < MAP_CELLS_X; cx++) {
        if (revealed.has(`${cx},${cy}`)) continue;
        ctx.fillRect(cx * GRID_SIZE, cy * GRID_SIZE, GRID_SIZE, GRID_SIZE);
      }
    }

    // Subtle grid hint so the GM can tell the cell boundaries through fog.
    if (s.role === 'gm') {
      ctx.strokeStyle = 'rgba(201,152,58,0.12)';
      ctx.lineWidth = 1 / camera.zoom;
      for (let cy = 0; cy < MAP_CELLS_Y; cy++) {
        for (let cx = 0; cx < MAP_CELLS_X; cx++) {
          if (revealed.has(`${cx},${cy}`)) continue;
          ctx.strokeRect(cx * GRID_SIZE, cy * GRID_SIZE, GRID_SIZE, GRID_SIZE);
        }
      }
    }

    camera.restoreTransform(ctx);

    if (this.fogBrushPreview) this.paintBrushPreview(W, H);
  }

  private paintBrushPreview(W: number, H: number): void {
    if (!this.fogBrushPreview) return;
    const ctx = this.ctx;
    const { a, b, mode } = this.fogBrushPreview;
    camera.applyTransform(ctx, W, H);
    const x = Math.min(a.wx, b.wx);
    const y = Math.min(a.wy, b.wy);
    const w = Math.abs(a.wx - b.wx);
    const h = Math.abs(a.wy - b.wy);
    ctx.fillStyle = mode === 'reveal'
      ? 'rgba(90,190,110,0.22)'
      : 'rgba(220,55,55,0.22)';
    ctx.strokeStyle = mode === 'reveal'
      ? 'rgba(90,190,110,0.85)'
      : 'rgba(220,55,55,0.85)';
    ctx.lineWidth = 2 / camera.zoom;
    ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    camera.restoreTransform(ctx);
  }

  private drawVision(s: State, W: number, H: number): void {
    if (!s.fogEnabled || !s.layers.fog) return;
    const ctx = this.ctx;
    // Viewer selection:
    //   - GM may "see through" the explicitly-selected token (any), else
    //     falls back to the first PC for a sensible debug view.
    //   - Player may only see through tokens they own. The selected token
    //     is honored only when it belongs to them; otherwise the renderer
    //     prefers their owned PC, then any token they own. This stops a
    //     player from peeking through another character's eyes.
    const isGm = s.role === 'gm';
    let viewer: Token | undefined;
    if (s.selectedTokenId !== null) {
      const sel = s.tokens.find((t) => t.id === s.selectedTokenId);
      if (sel && (isGm || sel.ownerId === s.currentUserId)) viewer = sel;
    }
    if (!viewer) {
      if (isGm) {
        viewer = s.tokens.find((t) => t.type === 'pc');
      } else {
        viewer = s.tokens.find((t) => t.type === 'pc' && t.ownerId === s.currentUserId)
              ?? s.tokens.find((t) => t.ownerId === s.currentUserId);
      }
    }
    if (!viewer) {
      // Nothing to see through — blackout the main canvas directly.
      ctx.fillStyle = 'rgba(0,0,0,.85)';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const { rx, ry } = this.getRenderPos(viewer.id, viewer.wx, viewer.wy);
    const visionPx = ftToPx(60);
    const { points } = this.visibility.get(s.walls, rx, ry, visionPx);

    // Build the whole fog composite on its own canvas. The main context
    // never sees destination-out / source-atop, so future additive layers
    // (coloured lights, weather) can share the main canvas without the
    // GPU being forced to treat the surface as a single atomic layer.
    const fog = this.ensureFogCanvas(W, H);
    const fctx = fog.getContext('2d')!;
    // Match the main canvas's DPR transform so line widths / extents line up.
    fctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, W, H);
    fctx.fillStyle = 'rgba(0,0,0,.88)';
    fctx.fillRect(0, 0, W, H);

    if (points.length >= 2) {
      // Punch the visibility polygon out of the fog buffer.
      fctx.globalCompositeOperation = 'destination-out';
      fctx.save();
      fctx.translate(W / 2, H / 2);
      fctx.scale(camera.zoom, camera.zoom);
      fctx.translate(-camera.x, -camera.y);
      fctx.fillStyle = 'rgba(0,0,0,1)';
      fctx.beginPath();
      fctx.moveTo(points[0]!.x, points[0]!.y);
      for (let i = 1; i < points.length; i++) fctx.lineTo(points[i]!.x, points[i]!.y);
      fctx.closePath();
      fctx.fill();
      fctx.restore();
      // Soft circular falloff at the vision-radius edge. Confined to the fog
      // canvas with source-atop so we don't tint anything underneath.
      const { sx: vsx, sy: vsy } = camera.worldToScreen(rx, ry, W, H);
      const vr = visionPx * camera.zoom;
      const fg = fctx.createRadialGradient(vsx, vsy, vr * 0.7, vsx, vsy, vr);
      fg.addColorStop(0, 'rgba(0,0,0,0)');
      fg.addColorStop(1, 'rgba(0,0,0,.88)');
      fctx.globalCompositeOperation = 'source-atop';
      fctx.fillStyle = fg;
      fctx.fillRect(0, 0, W, H);
      fctx.globalCompositeOperation = 'source-over';
    }

    // Straight blit — no composite gymnastics reach the main canvas.
    ctx.drawImage(fog, 0, 0, W, H);
  }

  private updateFpsCounter(): void {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime > 500) {
      this.fps = Math.round((this.frameCount / (now - this.lastFpsTime)) * 1000);
      this.frameCount = 0;
      this.lastFpsTime = now;
      const fpsEl = document.getElementById('stat-fps');
      if (fpsEl) fpsEl.textContent = String(this.fps);
      const zEl = document.getElementById('zoom-label');
      if (zEl) zEl.textContent = `${Math.round(camera.zoom * 100)}%`;
    }
  }
}
