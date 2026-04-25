import type { Wall } from '../state/schemas';
import { MAP_H, MAP_W } from './grid';

/**
 * Wall raycasting + visibility polygon.
 *
 * Ported from phase-5 with these improvements:
 *   - Pure functions taking walls as an argument (no global segments).
 *   - Cached visibility keyed by `(walls reference, quantized viewer, vr)`.
 *     The store replaces the walls array on every mutation (spread, not
 *     splice), so referential-equality is a cheap stand-in for a revision
 *     counter — when walls changes, the cache clears automatically.
 *     Viewer coordinates quantize to integer pixels so sub-pixel lerp
 *     wiggles share a cache slot and stationary frames are O(1).
 *   - Ray count is capped and angles are de-duplicated, so a 500-wall scene
 *     no longer sorts thousands of near-identical angles every frame.
 *   - Endpoints beyond ~1.5× vision radius are skipped — their shadows can't
 *     shape the visible polygon, and the radial fill samples catch any
 *     long wall that passes through the vision circle.
 *   - Separate `draft` state from the committed walls so renderer can show
 *     in-flight draw without mutating the committed list.
 */

export interface Point {
  x: number;
  y: number;
}

export interface VisibilityResult {
  points: Array<Point & { dist: number }>;
  rayCount: number;
}

function raySegmentIntersect(
  ox: number, oy: number, dx: number, dy: number,
  x1: number, y1: number, x2: number, y2: number
): number | null {
  const wx = x2 - x1;
  const wy = y2 - y1;
  const d = dx * wy - dy * wx;
  if (Math.abs(d) < 1e-10) return null;
  const t = ((x1 - ox) * wy - (y1 - oy) * wx) / d;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / d;
  return t >= 0 && u >= 0 && u <= 1 ? t : null;
}

export function castRay(
  walls: readonly Wall[],
  ox: number, oy: number, angle: number, max: number
): Point & { dist: number } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let n = max;
  for (const s of walls) {
    const t = raySegmentIntersect(ox, oy, dx, dy, s.x1, s.y1, s.x2, s.y2);
    if (t !== null && t < n) n = t;
  }
  return { x: ox + dx * n, y: oy + dy * n, dist: n };
}

// ── Visibility cache ─────────────────────────────────────────────────────

/**
 * Maximum number of rays we ever cast in a single frame. With 250+ wall
 * endpoints the renderer was sorting 1500+ angles/frame; the polygon has
 * diminishing returns after ~720 samples (≈0.5° resolution).
 */
const MAX_RAYS = 720;
/** Radial safety samples — fill in polygon when few walls are nearby. */
const RADIAL_SAMPLES = 32;
/**
 * Angles closer than this (radians) are considered duplicates and one is
 * dropped. ~5e-6 rad = roughly 0.0003°, well below any visible resolution
 * even at extreme zoom, so collapsing them is lossless in practice.
 */
const ANGLE_EPS = 5e-6;
/** Most recent wall array the cache reflects. Cache invalidates on change. */
let _cacheWalls: readonly Wall[] | null = null;
/** Map<quantized-viewer-key, result>. LRU-ish — we drop the oldest key once full. */
const _cacheMap = new Map<string, VisibilityResult>();
const _CACHE_MAX_ENTRIES = 16;

/** Clear the visibility cache. Useful for tests and hot-reload. */
export function clearVisibilityCache(): void {
  _cacheWalls = null;
  _cacheMap.clear();
}

/**
 * Look up a cached visibility polygon without computing. Returns null when
 * the walls reference differs from the one the cache reflects, or when the
 * quantized viewer key isn't stored yet. Used by the worker-backed
 * VisibilityProvider to short-circuit before touching the worker.
 */
export function peekVisibilityCache(
  walls: readonly Wall[],
  ox: number,
  oy: number,
  vr: number
): VisibilityResult | null {
  if (walls !== _cacheWalls) return null;
  const key = Math.round(ox) + ':' + Math.round(oy) + ':' + Math.round(vr);
  return _cacheMap.get(key) ?? null;
}

/**
 * Insert a pre-computed result into the cache. The VisibilityProvider uses
 * this to funnel worker results back into the sync cache so that any later
 * `computeVisibility` call with the same (walls, viewer) is instant.
 *
 * If `walls` is a different reference from the one currently reflected, the
 * cache is reset (identical behaviour to a miss inside `computeVisibility`).
 */
export function primeVisibilityCache(
  walls: readonly Wall[],
  ox: number,
  oy: number,
  vr: number,
  result: VisibilityResult
): void {
  if (walls !== _cacheWalls) {
    _cacheWalls = walls;
    _cacheMap.clear();
  }
  const key = Math.round(ox) + ':' + Math.round(oy) + ':' + Math.round(vr);
  _cacheMap.set(key, result);
  if (_cacheMap.size > _CACHE_MAX_ENTRIES) {
    const oldest = _cacheMap.keys().next().value as string | undefined;
    if (oldest !== undefined) _cacheMap.delete(oldest);
  }
}

export function computeVisibility(
  walls: readonly Wall[],
  ox: number,
  oy: number,
  vr: number
): VisibilityResult {
  // Viewer position quantized to whole pixels: sub-pixel lerp wobble during
  // token animation then lands on the same cache key as the rest position.
  const qx = Math.round(ox);
  const qy = Math.round(oy);
  const qr = Math.round(vr);
  if (walls !== _cacheWalls) {
    _cacheWalls = walls;
    _cacheMap.clear();
  }
  const key = qx + ':' + qy + ':' + qr;
  const hit = _cacheMap.get(key);
  if (hit) return hit;

  const res = computeVisibilityImpl(walls, ox, oy, vr);
  _cacheMap.set(key, res);
  if (_cacheMap.size > _CACHE_MAX_ENTRIES) {
    // Map iteration is insertion-ordered, so the first key is the oldest.
    const oldest = _cacheMap.keys().next().value as string | undefined;
    if (oldest !== undefined) _cacheMap.delete(oldest);
  }
  return res;
}

function computeVisibilityImpl(
  walls: readonly Wall[],
  ox: number,
  oy: number,
  vr: number
): VisibilityResult {
  // Square the distance threshold once; compare against squared distances
  // below so we never need a sqrt in the hot loop.
  const cutoff = (vr * 1.5) * (vr * 1.5);
  // Three candidate angles per endpoint — one exactly at the corner and two
  // epsilon-offset either side so cast rays just miss the wall and reach the
  // region beyond. This is what makes the visibility polygon wrap corners.
  const raw: number[] = [];
  for (const s of walls) {
    const dx1 = s.x1 - ox;
    const dy1 = s.y1 - oy;
    const dx2 = s.x2 - ox;
    const dy2 = s.y2 - oy;
    const d1 = dx1 * dx1 + dy1 * dy1;
    const d2 = dx2 * dx2 + dy2 * dy2;
    // Skip walls whose nearest endpoint is well outside the vision circle.
    // A long wall passing through the circle with both endpoints outside
    // still gets covered by the radial samples below — we only lose the
    // sharp shadow edge on its endpoints, which we couldn't see anyway.
    if (Math.min(d1, d2) > cutoff) continue;
    const a1 = Math.atan2(dy1, dx1);
    raw.push(a1 - 1e-5, a1, a1 + 1e-5);
    const a2 = Math.atan2(dy2, dx2);
    raw.push(a2 - 1e-5, a2, a2 + 1e-5);
  }
  // Radial fill so even a map with no walls still produces a full circle of
  // rays. Anchored at -π so the sort below lines up with the angle sweep.
  for (let i = 0; i < RADIAL_SAMPLES; i++) {
    raw.push((i / RADIAL_SAMPLES) * Math.PI * 2 - Math.PI);
  }
  // Normalize every angle to (-π, π] before sorting so the epsilon-dedup
  // downstream sees adjacent values adjacently. Without this step a pair
  // of near-duplicates that straddle the ±π seam would both survive.
  for (let i = 0; i < raw.length; i++) {
    let a = raw[i]!;
    if (a <= -Math.PI) a += Math.PI * 2;
    else if (a > Math.PI) a -= Math.PI * 2;
    raw[i] = a;
  }
  raw.sort((a, b) => a - b);
  // Dedup: when two angles lie within ANGLE_EPS, one ray would land at the
  // same polygon point, so keep the first and drop the rest.
  const uniq: number[] = [];
  let last = -Infinity;
  for (const a of raw) {
    if (a - last > ANGLE_EPS) {
      uniq.push(a);
      last = a;
    }
  }
  // Density cap: uniformly decimate when wall endpoints dominate. Keeps the
  // cost O(MAX_RAYS · walls) in the worst case instead of O(walls² log walls).
  let final: number[];
  if (uniq.length <= MAX_RAYS) {
    final = uniq;
  } else {
    final = new Array<number>(MAX_RAYS);
    const step = uniq.length / MAX_RAYS;
    for (let i = 0; i < MAX_RAYS; i++) final[i] = uniq[Math.floor(i * step)]!;
  }
  const points = new Array<Point & { dist: number }>(final.length);
  for (let i = 0; i < final.length; i++) {
    points[i] = castRay(walls, ox, oy, final[i]!, vr);
  }
  return { points, rayCount: final.length };
}

/**
 * Draft drawing for the walls tool (not persisted until finished).
 */
export class WallDraft {
  drawing = false;
  start: Point | null = null;
  current: Point | null = null;

  begin(wx: number, wy: number): void {
    this.drawing = true;
    this.start = { x: wx, y: wy };
    this.current = { x: wx, y: wy };
  }

  update(wx: number, wy: number): void {
    if (!this.drawing || !this.start) return;
    const dx = wx - this.start.x;
    const dy = wy - this.start.y;
    const angle = Math.atan2(dy, dx);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const useDiag = Math.abs(angle - snapped) > Math.PI / 8;
    this.current = useDiag
      ? { x: wx, y: wy }
      : { x: this.start.x + Math.cos(snapped) * dist, y: this.start.y + Math.sin(snapped) * dist };
  }

  finish(): Wall | null {
    if (!this.drawing || !this.start || !this.current) {
      this.cancel();
      return null;
    }
    const dx = this.current.x - this.start.x;
    const dy = this.current.y - this.start.y;
    const out: Wall | null =
      Math.sqrt(dx * dx + dy * dy) > 5
        ? { x1: this.start.x, y1: this.start.y, x2: this.current.x, y2: this.current.y }
        : null;
    this.cancel();
    return out;
  }

  cancel(): void {
    this.drawing = false;
    this.start = null;
    this.current = null;
  }
}

/** Prebuilt demo room for seeded scenes. */
export function demoRoom(): Wall[] {
  const cx = MAP_W / 2 - 140;
  const cy = MAP_H / 2 - 105;
  const w = 280;
  const h = 210;
  const out: Wall[] = [];
  ([
    [cx, cy, cx + w, cy],
    [cx + w, cy + 60, cx + w, cy + h],
    [cx + w, cy + h, cx, cy + h],
    [cx, cy + h, cx, cy]
  ] as const).forEach(([x1, y1, x2, y2]) => out.push({ x1, y1, x2, y2 }));
  ([
    [cx + w, cy, cx + w, cy + 55],
    [cx - 70, cy, cx - 70, cy + h / 2],
    [cx + 70, cy + h / 2 + 20, cx + 70, cy + h]
  ] as const).forEach(([x1, y1, x2, y2]) => out.push({ x1, y1, x2, y2 }));
  return out;
}
