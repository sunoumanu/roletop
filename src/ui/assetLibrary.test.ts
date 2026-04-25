import { describe, it, expect } from 'vitest';
import {
  assetEntryToDragPayload,
  readAssetFromDataTransfer,
  DRAG_MIME
} from './assetLibrary';
import type { AssetEntry } from '../features/assetManifest';

/**
 * Pure helpers around the DataTransfer wire format. The DOM-heavy panel
 * (install / render / drag events) is covered by Playwright — here we just
 * pin the payload shape so a careless rename doesn't break the drop target
 * on the canvas side without a compile error.
 */
describe('assetLibrary / payload helpers', () => {
  const sample: AssetEntry = {
    id: 'x',
    name: 'Goblin',
    url: 'https://example.com/goblin.png',
    kind: 'token',
    tags: ['enemy', 'humanoid']
  };

  it('assetEntryToDragPayload keeps name, url, kind and drops tags/thumbnail', () => {
    expect(assetEntryToDragPayload(sample)).toEqual({
      name: 'Goblin',
      url: 'https://example.com/goblin.png',
      kind: 'token'
    });
  });

  it('readAssetFromDataTransfer returns null on empty / missing payload', () => {
    expect(readAssetFromDataTransfer(null)).toBeNull();
    const dt = makeFakeDataTransfer({ 'text/plain': 'hi' });
    expect(readAssetFromDataTransfer(dt)).toBeNull();
  });

  it('readAssetFromDataTransfer round-trips a valid payload', () => {
    const payload = assetEntryToDragPayload(sample);
    const dt = makeFakeDataTransfer({ [DRAG_MIME]: JSON.stringify(payload) });
    expect(readAssetFromDataTransfer(dt)).toEqual(payload);
  });

  it('readAssetFromDataTransfer rejects a JSON-valid but shape-invalid payload', () => {
    const dt = makeFakeDataTransfer({ [DRAG_MIME]: JSON.stringify({ name: 'no url' }) });
    expect(readAssetFromDataTransfer(dt)).toBeNull();
  });

  it('readAssetFromDataTransfer swallows malformed JSON without throwing', () => {
    const dt = makeFakeDataTransfer({ [DRAG_MIME]: 'not json' });
    expect(readAssetFromDataTransfer(dt)).toBeNull();
  });
});

/**
 * Tiny DataTransfer shim. Spec's full interface is huge; we only need
 * `getData` for the assertions here.
 */
function makeFakeDataTransfer(entries: Record<string, string>): DataTransfer {
  return {
    getData: (key: string): string => entries[key] ?? ''
  } as unknown as DataTransfer;
}
