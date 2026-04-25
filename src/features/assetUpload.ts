import { store } from '../state/store';
import { toast } from '../ui/toast';
import { isGM } from './roles';

/**
 * Asset upload helpers (§3 image-map + custom token art).
 *
 * Images are stored as data-URLs on the scene so they round-trip cleanly via
 * export/import without an external asset server. This caps practical asset
 * size — a 3 MB image becomes ~4 MB base64 which bloats the scene JSON but
 * stays usable for phase-6 prototyping. A real deployment would swap these
 * helpers for server upload + URL persistence.
 */

/** Hard cap to keep localStorage + scene JSON from blowing past 5MB limits. */
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB raw file

/** Whitelist matches the `accept` attribute on the file picker. */
const ALLOWED = /^image\/(png|jpeg|webp|gif)$/;

/**
 * Read a user-chosen file into a base64 data-URL suitable for storing on the
 * scene. Returns null and toasts on validation failure so callers can short-
 * circuit cleanly.
 */
export async function readAsDataUrl(file: File): Promise<string | null> {
  if (!ALLOWED.test(file.type)) {
    toast(`Unsupported file type: ${file.type || 'unknown'}`, 'err');
    return null;
  }
  if (file.size > MAX_BYTES) {
    toast(`File too large (${Math.round(file.size / 1024 / 1024)} MB; max 4 MB)`, 'err');
    return null;
  }
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => {
      toast('Failed to read file', 'err');
      resolve(null);
    };
    reader.readAsDataURL(file);
  });
}

/** Load an image file as the battle-map background. GM only. */
export async function loadMapImage(file: File): Promise<void> {
  if (!isGM()) { toast('Only the GM can set the map', 'warn'); return; }
  // #10 — large images take a beat to decode; show a loading toast so the
  // silence between "I clicked upload" and "the map appears" doesn't read
  // as a freeze.
  const sizeMb = (file.size / 1024 / 1024).toFixed(1);
  toast(`Loading map (${sizeMb} MB)…`, 'info');
  document.documentElement.setAttribute('data-map-loading', 'true');
  try {
    const url = await readAsDataUrl(file);
    if (!url) return;
    store.getState().setMapImage(url);
    toast(`Map loaded: ${file.name}`, 'ok');
  } finally {
    document.documentElement.removeAttribute('data-map-loading');
  }
}

/** Attach an image as a token's portrait. GM only. */
export async function loadTokenImage(tokenId: number, file: File): Promise<void> {
  if (!isGM()) { toast('Only the GM can set token art', 'warn'); return; }
  const url = await readAsDataUrl(file);
  if (!url) return;
  store.getState().updateToken(tokenId, { image: url });
  toast('Token art updated', 'ok');
}

/** Open a hidden file picker and resolve with the first selected file. */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // Some browsers ignore click() until the input is in the DOM.
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
    // Clean up after a tick so the onchange has run.
    setTimeout(() => input.remove(), 0);
  });
}
