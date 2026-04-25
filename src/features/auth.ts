/**
 * Authentication / session identity.
 *
 * The VTT has no backend, so "login" here is a thin local-session concept:
 *
 *   - The user picks a role + identity once (persisted in sessionStorage so
 *     a refresh doesn't bounce them back to the picker).
 *   - GM uniqueness is enforced *across tabs of the same browser* via a
 *     BroadcastChannel. When a tab tries to claim the GM seat it broadcasts
 *     `gm-claim` and waits ~250ms for any existing GM tab to reply with
 *     `gm-here`. The active GM also emits a periodic `gm-here` heartbeat so
 *     a brand-new tab opening cold still sees the seat as taken.
 *   - On `beforeunload` the GM tab broadcasts `gm-released` so other tabs
 *     can promote without waiting for a stale heartbeat.
 *
 * This is best-effort — a different browser or device can still claim GM
 * because there's no shared server. That's fine for the prototype; the
 * shape of the API is the same one a real backend would adopt.
 */

export interface AuthIdentity {
  role: 'gm' | 'player';
  /** Matches a `ChatPlayer.id` in `store.players`. */
  playerId: string;
  name: string;
}

const SS_KEY = 'roletop.auth.v1';
const CH_NAME = 'roletop-vtt-auth-v1';
const HEARTBEAT_MS = 3000;
const CLAIM_WAIT_MS = 250;

type AuthMsg =
  | { type: 'gm-claim' }
  | { type: 'gm-here'; name: string }
  | { type: 'gm-released' }
  | { type: 'player-join'; id: string; name: string }
  | { type: 'player-leave'; id: string };

let channel: BroadcastChannel | null = null;
let current: AuthIdentity | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  channel = new BroadcastChannel(CH_NAME);
  channel.addEventListener('message', onMessage);
  return channel;
}

function post(msg: AuthMsg): void {
  const ch = getChannel();
  if (!ch) return;
  try { ch.postMessage(msg); } catch { /* noop */ }
}

function onMessage(e: MessageEvent): void {
  const msg = e.data as AuthMsg | undefined;
  if (!msg || typeof msg !== 'object') return;
  // We only need to respond to claim pings when *we* are the active GM.
  if (msg.type === 'gm-claim' && current?.role === 'gm') {
    post({ type: 'gm-here', name: current.name });
  }
}

/** Read a previously-saved identity from sessionStorage, if any. */
export function loadSavedIdentity(): AuthIdentity | null {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthIdentity>;
    if (
      (parsed.role === 'gm' || parsed.role === 'player') &&
      typeof parsed.playerId === 'string' && parsed.playerId.length > 0 &&
      typeof parsed.name === 'string' && parsed.name.length > 0
    ) {
      return { role: parsed.role, playerId: parsed.playerId, name: parsed.name };
    }
    return null;
  } catch {
    return null;
  }
}

/** Currently-logged-in identity. */
export function getCurrent(): AuthIdentity | null {
  return current;
}

/**
 * Probe other tabs for an active GM. Resolves `true` if the seat looks free
 * (no `gm-here` reply within the wait window), `false` if a GM is already
 * present.
 */
export async function isGmAvailable(timeoutMs = CLAIM_WAIT_MS): Promise<boolean> {
  const ch = getChannel();
  if (!ch) return true; // No BroadcastChannel — best-effort, assume free.
  return new Promise<boolean>((resolve) => {
    let done = false;
    const handler = (e: MessageEvent) => {
      const msg = e.data as AuthMsg | undefined;
      if (msg?.type !== 'gm-here') return;
      if (done) return;
      done = true;
      ch.removeEventListener('message', handler);
      resolve(false);
    };
    ch.addEventListener('message', handler);
    post({ type: 'gm-claim' });
    setTimeout(() => {
      if (done) return;
      done = true;
      ch.removeEventListener('message', handler);
      resolve(true);
    }, timeoutMs);
  });
}

export type LoginResult = { ok: true } | { ok: false; reason: string };

/**
 * Claim a session as the given identity.
 *
 * For GM logins we re-check `isGmAvailable` to avoid a races where two tabs
 * try to claim simultaneously. (It's still racey within the wait window but
 * that's good enough for a local prototype — first writer wins.)
 */
export async function login(identity: AuthIdentity): Promise<LoginResult> {
  if (identity.role === 'gm') {
    const free = await isGmAvailable();
    if (!free) {
      return { ok: false, reason: 'A Game Master is already signed in to this session.' };
    }
  }
  current = identity;
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(identity));
  } catch { /* sessionStorage may be disabled */ }
  // Make sure the channel + listener are wired before we announce.
  getChannel();
  if (identity.role === 'gm') {
    startHeartbeat();
    post({ type: 'gm-here', name: identity.name });
  } else {
    post({ type: 'player-join', id: identity.playerId, name: identity.name });
  }
  return { ok: true };
}

/** Release the seat, broadcast departure, clear sessionStorage. */
export function logout(): void {
  if (!current) return;
  if (current.role === 'gm') {
    post({ type: 'gm-released' });
    stopHeartbeat();
  } else {
    post({ type: 'player-leave', id: current.playerId });
  }
  current = null;
  try { sessionStorage.removeItem(SS_KEY); } catch { /* noop */ }
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (current?.role !== 'gm') return;
    post({ type: 'gm-here', name: current.name });
  }, HEARTBEAT_MS);
  window.addEventListener('beforeunload', onBeforeUnload);
}

function stopHeartbeat(): void {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  window.removeEventListener('beforeunload', onBeforeUnload);
}

function onBeforeUnload(): void {
  if (current?.role === 'gm') {
    // Best-effort — `beforeunload` runs synchronously and the channel
    // post is async-ish but tabs typically receive it.
    try { post({ type: 'gm-released' }); } catch { /* noop */ }
  }
}
