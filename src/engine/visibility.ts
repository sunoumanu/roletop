import type { Wall } from '../state/schemas';
import {
  computeVisibility,
  peekVisibilityCache,
  primeVisibilityCache,
  type VisibilityResult
} from './walls';
import type { ComputeRequest, ComputeResponse } from './visibility.worker';

/**
 * Worker-backed visibility provider.
 *
 * Phase A #8 — `computeVisibility` used to block the main thread on every
 * frame. On a scene with hundreds of walls this added ~4-8 ms per frame of
 * script time during token drag or wall edits, which was enough to drop
 * frames visibly.
 *
 * Strategy:
 *   1. Fast path — peek the main-thread sync cache. If we already have a
 *      result for this (walls, quantized viewer), return it instantly.
 *      (This hit rate dominates during stationary frames.)
 *   2. Small scene — if the wall count is below {@link WORKER_WALL_THRESHOLD},
 *      the raycaster's work is dwarfed by postMessage / structured-clone
 *      overhead. Run sync.
 *   3. Large scene — post a request to the worker. Return a stale result
 *      (from the sync cache) so the frame renders immediately. When the
 *      worker replies we seed the sync cache via {@link primeVisibilityCache}
 *      and fire `onResult` so the renderer schedules a repaint.
 *   4. First-frame fallback — if no stale result is available (brand new
 *      walls reference, first visit), run sync this frame to avoid a blank
 *      polygon. Subsequent frames hit the cache or fall through to (3).
 *
 * Workers aren't available in jsdom / SSR, so the constructor tolerates
 * failure and collapses to pure sync.
 */

/** Wall count below which sync compute beats postMessage overhead. */
export const WORKER_WALL_THRESHOLD = 40;

export interface VisibilityProviderOptions {
  /** Called when a fresh worker result lands. Renderer wires this to
   *  scheduleDirty so the next frame picks up the sharper polygon. */
  onResult?: () => void;
  /** Override the worker threshold (tests / perf probes). */
  threshold?: number;
  /** Skip the worker entirely — used when Web Workers are unavailable. */
  forceSync?: boolean;
}

export class VisibilityProvider {
  private worker: Worker | null = null;
  /** Monotonically increasing request id. Stale responses are ignored. */
  private seq = 0;
  /** Highest seq we've accepted a response for — drops out-of-order replies. */
  private lastAcceptedSeq = -1;
  /** Set of seqs we've already asked about. Used to detect in-flight-ness. */
  private pending = new Map<number, { walls: readonly Wall[]; ox: number; oy: number; vr: number }>();
  private readonly threshold: number;
  private readonly onResult: (() => void) | null;

  constructor(opts: VisibilityProviderOptions = {}) {
    this.threshold = opts.threshold ?? WORKER_WALL_THRESHOLD;
    this.onResult = opts.onResult ?? null;
    if (opts.forceSync) return;
    try {
      this.worker = new Worker(new URL('./visibility.worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (ev: MessageEvent<ComputeResponse>) => this.handleMessage(ev));
      // If the worker errors we silently collapse to sync — better a frame of
      // main-thread work than a black fog polygon.
      this.worker.addEventListener('error', () => this.teardownWorker());
    } catch {
      this.worker = null;
    }
  }

  /**
   * Main entry point. Always returns a usable result for the current frame —
   * maybe slightly stale during bursts of movement, never empty.
   */
  get(walls: readonly Wall[], ox: number, oy: number, vr: number): VisibilityResult {
    // 1. Sync cache hit — the common case for stationary viewers.
    const cached = peekVisibilityCache(walls, ox, oy, vr);
    if (cached) return cached;

    // 2. Small scenes: sync is cheaper than a round-trip.
    if (!this.worker || walls.length < this.threshold) {
      return computeVisibility(walls, ox, oy, vr);
    }

    // 3. Dispatch to the worker. The walls array is structured-cloneable
    //    (plain {x1,y1,x2,y2} objects from schemas.ts).
    const seq = ++this.seq;
    this.pending.set(seq, { walls, ox, oy, vr });
    const req: ComputeRequest = {
      kind: 'compute',
      seq,
      walls: walls as Wall[],
      ox,
      oy,
      vr
    };
    this.worker.postMessage(req);

    // 4. Return stale-or-sync. We prefer any cached entry for these walls
    //    (even at a different viewer quantization — better than blocking)
    //    before falling back to sync on the very first frame.
    const stale = this.findAnyCachedFor(walls, ox, oy, vr);
    if (stale) return stale;
    return computeVisibility(walls, ox, oy, vr);
  }

  /** Drop the worker, e.g. on scene teardown. */
  dispose(): void {
    this.teardownWorker();
    this.pending.clear();
  }

  private handleMessage(ev: MessageEvent<ComputeResponse>): void {
    const msg = ev.data;
    if (!msg || msg.kind !== 'result') return;
    const req = this.pending.get(msg.seq);
    this.pending.delete(msg.seq);
    if (!req) return;
    // Drop out-of-order replies — the viewer may have moved by now, and a
    // newer request's result is already baked into the cache.
    if (msg.seq <= this.lastAcceptedSeq) return;
    this.lastAcceptedSeq = msg.seq;
    // Seed the main-thread sync cache so subsequent frames at this viewer
    // position are instant.
    primeVisibilityCache(req.walls, req.ox, req.oy, req.vr, msg.result);
    this.onResult?.();
  }

  /**
   * Look for any cached result tied to the current walls reference. We try
   * the exact (ox,oy,vr) first (already covered by peek, but cheap enough to
   * retry), then give up — returning null here lets `get` fall through to a
   * sync compute. We intentionally don't scan the whole cache for near-hits:
   * the risk of serving a wildly-wrong polygon outweighs the savings.
   */
  private findAnyCachedFor(
    walls: readonly Wall[],
    ox: number,
    oy: number,
    vr: number
  ): VisibilityResult | null {
    return peekVisibilityCache(walls, ox, oy, vr);
  }

  private teardownWorker(): void {
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* already gone */ }
    }
    this.worker = null;
  }
}
