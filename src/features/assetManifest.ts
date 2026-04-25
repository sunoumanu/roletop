import { z } from 'zod';

/**
 * Stock asset pack manifests.
 *
 * Phase B [S] — GMs should be able to paste a JSON manifest URL (Forgotten
 * Adventures, 2-Minute Tabletop, or any ad-hoc pack distributor) and have
 * the contents show up in the asset library without copying files into the
 * scene. Individual assets stay remote; we only hold metadata.
 *
 * We normalise the common manifest shapes into one `AssetPack` type so the
 * library UI doesn't care which distributor produced the pack. The schema
 * is deliberately permissive — fields we don't recognise are dropped, and
 * an `assets[].url` that is relative to the manifest gets joined to the
 * manifest's `baseUrl` (or the URL the manifest was fetched from).
 */

/**
 * Kind of a single entry in the pack. Keeps the render path simple: a
 * `token` entry drops onto the board as a token; a `map` replaces the
 * background; a `tile` becomes a placed sticker; anything else is `other`.
 */
export const AssetKindSchema = z.enum(['token', 'map', 'tile', 'portrait', 'audio', 'other']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/**
 * A single asset inside a pack. Most distributors include at least a name
 * and a URL; everything else is best-effort. An entry without a usable URL
 * is dropped during normalisation rather than surfaced as a broken item.
 */
export const AssetEntrySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  url: z.string().min(1),
  kind: AssetKindSchema.default('other'),
  tags: z.array(z.string()).default([]),
  thumbnail: z.string().optional()
});
export type AssetEntry = z.infer<typeof AssetEntrySchema>;

/**
 * The top-level manifest schema. Accepts the two common wire formats:
 *   1. `{ name, assets: [...] }` — the native shape.
 *   2. `{ name, items: [...] }` — some 2MTT-derived packs.
 * Normalisation below collapses both into `assets`.
 */
export const AssetManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  attribution: z.string().optional(),
  baseUrl: z.string().optional(),
  assets: z.array(AssetEntrySchema).optional(),
  items: z.array(AssetEntrySchema).optional()
}).transform((m) => ({
  name: m.name,
  version: m.version,
  attribution: m.attribution,
  baseUrl: m.baseUrl,
  assets: m.assets ?? m.items ?? []
}));
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

/** A pack after URL-resolution. URLs in `assets` are guaranteed absolute. */
export interface AssetPack {
  readonly name: string;
  readonly version: string | null;
  readonly attribution: string | null;
  readonly source: string;
  readonly assets: readonly AssetEntry[];
}

/**
 * Resolve `assetUrl` against the pack's `baseUrl`, falling back to the
 * manifest URL itself. Absolute URLs (including data: URLs) pass through
 * untouched; anything else is treated as a path relative to the base.
 *
 * Malformed URLs are caught and returned as-is rather than thrown — we want
 * to surface a broken asset link in the library UI, not abort the whole
 * pack import over one bad row.
 */
export function resolveAssetUrl(assetUrl: string, baseUrl: string): string {
  if (/^(https?:|data:|blob:)/i.test(assetUrl)) return assetUrl;
  try {
    return new URL(assetUrl, baseUrl).toString();
  } catch {
    return assetUrl;
  }
}

/**
 * Normalise a parsed manifest into an `AssetPack`. Splits out URL resolution
 * so the parser stays pure (and unit-testable without a fake `URL` context).
 */
export function normaliseManifest(m: AssetManifest, source: string): AssetPack {
  const base = m.baseUrl ?? source;
  const assets = m.assets
    .map((a) => ({ ...a, url: resolveAssetUrl(a.url, base) }))
    // Drop rows that ended up with an empty URL after resolution.
    .filter((a) => a.url.length > 0);
  return {
    name: m.name,
    version: m.version ?? null,
    attribution: m.attribution ?? null,
    source,
    assets
  };
}

/**
 * Parse JSON text into an `AssetPack`. Separated from `fetchManifest` so the
 * parser can be unit-tested against fixture strings without a network.
 * Throws `Error` with a user-readable message on invalid input.
 */
export function parseManifest(json: string, source: string): AssetPack {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`Manifest is not valid JSON: ${(e as Error).message}`);
  }
  const result = AssetManifestSchema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue?.path?.join('.') || '<root>';
    throw new Error(`Manifest validation failed at ${path}: ${firstIssue?.message ?? 'unknown'}`);
  }
  return normaliseManifest(result.data, source);
}

/**
 * Fetch a manifest URL and return a parsed `AssetPack`. Uses `mode: 'cors'`
 * so the browser enforces CORS headers; a pack host that doesn't emit
 * `Access-Control-Allow-Origin` will fail here rather than silently returning
 * a partial response.
 *
 * The fetch is `credentials: 'omit'` — asset hosts shouldn't see the user's
 * cookies, and it keeps preflight lighter for public packs.
 */
export async function fetchManifest(url: string): Promise<AssetPack> {
  let res: Response;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  } catch (e) {
    throw new Error(`Network error fetching manifest: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`Manifest fetch failed: HTTP ${res.status}`);
  const body = await res.text();
  return parseManifest(body, url);
}

/**
 * In-memory pack index. Keyed by pack name — importing a pack with the same
 * name replaces the previous one (intentional: GMs iterate on pack contents
 * and don't want stale rows hanging around). UI consumers subscribe to
 * `onChange` to refresh their list.
 */
class AssetPackIndex {
  private readonly packs = new Map<string, AssetPack>();
  private readonly listeners = new Set<() => void>();

  add(pack: AssetPack): void {
    this.packs.set(pack.name, pack);
    this.emit();
  }

  remove(name: string): boolean {
    const ok = this.packs.delete(name);
    if (ok) this.emit();
    return ok;
  }

  get(name: string): AssetPack | null {
    return this.packs.get(name) ?? null;
  }

  list(): AssetPack[] {
    // Stable ordering by name so UI lists don't flicker.
    return [...this.packs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Full-text search across loaded packs. Matches on asset name, tags, and
   * kind — case-insensitive. Empty query returns everything.
   */
  search(query: string): Array<{ pack: string; asset: AssetEntry }> {
    const q = query.trim().toLowerCase();
    const out: Array<{ pack: string; asset: AssetEntry }> = [];
    for (const pack of this.packs.values()) {
      for (const asset of pack.assets) {
        if (!q || this.matches(asset, q)) out.push({ pack: pack.name, asset });
      }
    }
    return out;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  clear(): void {
    this.packs.clear();
    this.emit();
  }

  private matches(a: AssetEntry, q: string): boolean {
    if (a.name.toLowerCase().includes(q)) return true;
    if (a.kind.toLowerCase().includes(q)) return true;
    for (const t of a.tags) if (t.toLowerCase().includes(q)) return true;
    return false;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Shared index singleton. */
export const assetPacks = new AssetPackIndex();

/**
 * High-level entry point: fetch a manifest URL and register it with the
 * shared index. Returns the parsed pack for callers that want to display
 * a success toast with e.g. the asset count.
 */
export async function importManifestUrl(url: string): Promise<AssetPack> {
  const pack = await fetchManifest(url);
  assetPacks.add(pack);
  return pack;
}
