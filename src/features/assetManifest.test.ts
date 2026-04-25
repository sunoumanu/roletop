import { describe, it, expect, beforeEach } from 'vitest';
import {
  assetPacks,
  normaliseManifest,
  parseManifest,
  resolveAssetUrl,
  AssetManifestSchema
} from './assetManifest';

/**
 * Tests intentionally avoid network — everything here goes through
 * `parseManifest` with fixture strings. The fetch path is a thin wrapper
 * and would just be re-testing the browser's `fetch` implementation.
 */
describe('assetManifest / parseManifest', () => {
  it('parses a minimal manifest and normalises URLs', () => {
    const json = JSON.stringify({
      name: 'Pack A',
      assets: [
        { name: 'Goblin', url: 'tokens/goblin.png', kind: 'token' },
        { name: 'Bandit', url: 'https://cdn.example/bandit.png', kind: 'token' }
      ]
    });
    const pack = parseManifest(json, 'https://cdn.example/packs/a.json');
    expect(pack.name).toBe('Pack A');
    expect(pack.assets).toHaveLength(2);
    expect(pack.assets[0]!.url).toBe('https://cdn.example/packs/tokens/goblin.png');
    // Absolute URL passes through untouched.
    expect(pack.assets[1]!.url).toBe('https://cdn.example/bandit.png');
  });

  it('accepts `items` as an alias for `assets`', () => {
    const json = JSON.stringify({
      name: 'Pack B',
      items: [{ name: 'Map', url: 'https://x.test/m.png', kind: 'map' }]
    });
    const pack = parseManifest(json, 'https://x.test/m.json');
    expect(pack.assets).toHaveLength(1);
    expect(pack.assets[0]!.kind).toBe('map');
  });

  it('uses `baseUrl` when present in preference to the source', () => {
    const json = JSON.stringify({
      name: 'Pack C',
      baseUrl: 'https://assets.example/packs/c/',
      assets: [{ name: 'Tile', url: 'tile1.png', kind: 'tile' }]
    });
    const pack = parseManifest(json, 'https://meta.example/c.json');
    expect(pack.assets[0]!.url).toBe('https://assets.example/packs/c/tile1.png');
  });

  it('rejects invalid JSON with a readable message', () => {
    expect(() => parseManifest('{not json', 'https://x.test/m.json'))
      .toThrow(/Manifest is not valid JSON/);
  });

  it('rejects a manifest without a name', () => {
    const json = JSON.stringify({ assets: [] });
    expect(() => parseManifest(json, 'https://x.test/m.json'))
      .toThrow(/Manifest validation failed/);
  });

  it('defaults missing kind to "other" and tags to []', () => {
    const json = JSON.stringify({
      name: 'Pack D',
      assets: [{ name: 'Thing', url: 'https://x.test/t.png' }]
    });
    const pack = parseManifest(json, 'https://x.test/m.json');
    expect(pack.assets[0]!.kind).toBe('other');
    expect(pack.assets[0]!.tags).toEqual([]);
  });
});

describe('assetManifest / resolveAssetUrl', () => {
  it('passes absolute URLs through', () => {
    expect(resolveAssetUrl('https://cdn.test/x.png', 'https://base.test/m.json'))
      .toBe('https://cdn.test/x.png');
  });

  it('passes data: URLs through', () => {
    const data = 'data:image/png;base64,AAA';
    expect(resolveAssetUrl(data, 'https://base.test/m.json')).toBe(data);
  });

  it('joins relative URLs against the base', () => {
    expect(resolveAssetUrl('goblin.png', 'https://cdn.test/packs/a.json'))
      .toBe('https://cdn.test/packs/goblin.png');
  });

  it('returns malformed URLs untouched', () => {
    expect(resolveAssetUrl('relative.png', 'not-a-url'))
      .toBe('relative.png');
  });
});

describe('assetManifest / index', () => {
  beforeEach(() => assetPacks.clear());

  it('adds and lists packs sorted by name', () => {
    const mkPack = (name: string) => normaliseManifest(
      AssetManifestSchema.parse({ name, assets: [] }),
      `https://x.test/${name}.json`
    );
    assetPacks.add(mkPack('Zulu'));
    assetPacks.add(mkPack('Alpha'));
    assetPacks.add(mkPack('Mike'));
    expect(assetPacks.list().map((p) => p.name)).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  it('replaces a pack on re-add of the same name', () => {
    const v1 = normaliseManifest(
      AssetManifestSchema.parse({
        name: 'Pack',
        assets: [{ name: 'Old', url: 'https://x.test/old.png' }]
      }),
      'https://x.test/m.json'
    );
    const v2 = normaliseManifest(
      AssetManifestSchema.parse({
        name: 'Pack',
        assets: [{ name: 'New', url: 'https://x.test/new.png' }]
      }),
      'https://x.test/m.json'
    );
    assetPacks.add(v1);
    assetPacks.add(v2);
    expect(assetPacks.list()).toHaveLength(1);
    expect(assetPacks.get('Pack')?.assets[0]!.name).toBe('New');
  });

  it('search matches name, tags, and kind', () => {
    const pack = normaliseManifest(
      AssetManifestSchema.parse({
        name: 'P',
        assets: [
          { name: 'Goblin Warrior', url: 'https://x.test/g.png', kind: 'token', tags: ['humanoid'] },
          { name: 'Forest Map', url: 'https://x.test/f.png', kind: 'map', tags: ['outdoor'] }
        ]
      }),
      'https://x.test/m.json'
    );
    assetPacks.add(pack);
    expect(assetPacks.search('goblin').map((r) => r.asset.name)).toEqual(['Goblin Warrior']);
    expect(assetPacks.search('map').map((r) => r.asset.name)).toEqual(['Forest Map']);
    expect(assetPacks.search('outdoor').map((r) => r.asset.name)).toEqual(['Forest Map']);
    expect(assetPacks.search('').length).toBe(2);
  });

  it('notifies subscribers on add and remove', () => {
    let calls = 0;
    const unsub = assetPacks.onChange(() => calls++);
    const pack = normaliseManifest(
      AssetManifestSchema.parse({ name: 'Sub', assets: [] }),
      'https://x.test/m.json'
    );
    assetPacks.add(pack);
    assetPacks.remove('Sub');
    expect(calls).toBe(2);
    unsub();
    assetPacks.add(pack);
    expect(calls).toBe(2); // unsub worked
  });
});
