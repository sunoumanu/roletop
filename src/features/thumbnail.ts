/**
 * Client-side thumbnailing.
 *
 * Phase B [M] — a dropped 4K map is ~30–60 MB in memory and is usually
 * not the scene the GM wants to *render* — just one they want to *see* in
 * the asset library. We generate a ~512px thumbnail from the data URL (or
 * remote URL) and hand that to library widgets; the full-resolution image
 * only loads when the scene activates.
 *
 * Implementation notes:
 *   - `OffscreenCanvas` + `createImageBitmap` runs the resize off-thread
 *     where available (Chromium, Firefox, Safari 17+). Falls back to a
 *     main-thread `HTMLCanvasElement` + `HTMLImageElement` path.
 *   - Output is a PNG data URL so it round-trips through scene JSON the
 *     same way the existing asset pipeline does (see `assetUpload.ts`).
 *   - Results are cached by source URL for the life of the tab so a
 *     library scroll doesn't re-thumbnail the same asset.
 *   - We never upscale — a source smaller than the target is returned
 *     as-is (avoids wasting memory on a blurry re-encode).
 */

/** Max edge length of the thumbnail. */
export const THUMBNAIL_MAX = 512;

/** True when we have the full OffscreenCanvas + createImageBitmap pipeline. */
const HAS_OFFSCREEN: boolean =
  typeof OffscreenCanvas !== 'undefined' &&
  typeof createImageBitmap === 'function';

const cache = new Map<string, string>();

/**
 * Public entry point. Returns a PNG data URL of at most `THUMBNAIL_MAX`
 * pixels on the longer edge, preserving aspect ratio. Falls back to
 * returning the source URL when the source is already smaller or when
 * thumbnailing is unsupported — callers can safely `<img src={...}>`
 * the return value unconditionally.
 */
export async function thumbnail(sourceUrl: string, max = THUMBNAIL_MAX): Promise<string> {
  const cacheKey = `${sourceUrl}::${max}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  try {
    const out = HAS_OFFSCREEN
      ? await thumbnailOffscreen(sourceUrl, max)
      : await thumbnailMainThread(sourceUrl, max);
    cache.set(cacheKey, out);
    return out;
  } catch {
    // Thumbnailing is a progressive enhancement — never fail the upload
    // because we couldn't shrink the asset for preview.
    return sourceUrl;
  }
}

/** Drop a cached entry. Call when a source URL is about to be revoked. */
export function invalidateThumbnail(sourceUrl: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${sourceUrl}::`)) cache.delete(k);
  }
}

/** Reset the full cache. Used by tests. */
export function clearThumbnailCache(): void {
  cache.clear();
}

async function thumbnailOffscreen(sourceUrl: string, max: number): Promise<string> {
  const blob = await fetchBlob(sourceUrl);
  const bmp = await createImageBitmap(blob);
  try {
    const { w, h } = fitWithin(bmp.width, bmp.height, max);
    if (w === bmp.width && h === bmp.height) {
      // No downscale needed — return the source untouched (avoid a re-encode
      // that'd cost memory and introduce subtle artefacts).
      return sourceUrl;
    }
    const canvas = new OffscreenCanvas(w, h);
    const c = canvas.getContext('2d')!;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(bmp, 0, 0, w, h);
    const out = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToDataUrl(out);
  } finally {
    bmp.close();
  }
}

async function thumbnailMainThread(sourceUrl: string, max: number): Promise<string> {
  const img = await loadImage(sourceUrl);
  const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, max);
  if (w === img.naturalWidth && h === img.naturalHeight) return sourceUrl;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

/** Compute the largest w×h that fits within `max` on each edge while
 *  preserving aspect ratio. Never upscales. Exported for unit tests. */
export function fitWithin(srcW: number, srcH: number, max: number): { w: number; h: number } {
  if (srcW <= max && srcH <= max) return { w: srcW, h: srcH };
  const scale = Math.min(max / srcW, max / srcH);
  return {
    w: Math.max(1, Math.round(srcW * scale)),
    h: Math.max(1, Math.round(srcH * scale))
  };
}

async function fetchBlob(url: string): Promise<Blob> {
  // data: URLs go via fetch too — it's spec-compliant and simpler than
  // hand-rolling base64 decoding for every browser. Browsers fast-path it.
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`thumbnail fetch: HTTP ${res.status}`);
  return await res.blob();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
    r.onerror = () => reject(new Error('blob read failed'));
    r.readAsDataURL(blob);
  });
}
