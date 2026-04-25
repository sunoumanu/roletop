import { store } from '../state/store';
import { login, isGmAvailable, loadSavedIdentity, type AuthIdentity } from '../features/auth';
import { escapeHtml } from '../utils/escape';
import { trap as focusTrap } from './focusTrap';
import type { ChatPlayer } from '../state/schemas';

/**
 * Login screen — full-screen Foundry-style takeover.
 *
 * Renders once on boot, blocks all input behind it, and resolves the
 * promise returned by `awaitLogin` when the user successfully claims an
 * identity. After that the overlay fades out and is removed.
 *
 * On reload we try `loadSavedIdentity()` first; if a GM identity is saved
 * but the seat is now taken (e.g. another tab claimed it), we still show
 * the picker pre-flagged with an error.
 */

interface LoginUiState {
  role: 'gm' | 'player';
  playerId: string;          // selected player id (for role=player), 'dm' for gm
  name: string;
  customName: boolean;       // user typed a name not in the seeded list
  error: string | null;
  busy: boolean;
}

const COLORS = ['#5a8abf', '#bf8a5a', '#5abf8a', '#a45abf', '#bf5a73', '#5abfbf', '#bfa15a'];

/**
 * Mount the login screen and resolve the returned promise once the user
 * has logged in. The promise never rejects — errors are shown inline.
 */
export function awaitLogin(parent: HTMLElement): Promise<AuthIdentity> {
  return new Promise<AuthIdentity>((resolve) => {
    void tryRestore(parent, resolve);
  });
}

async function tryRestore(parent: HTMLElement, done: (id: AuthIdentity) => void): Promise<void> {
  const saved = loadSavedIdentity();
  if (saved) {
    if (saved.role === 'gm') {
      const free = await isGmAvailable();
      if (!free) {
        // Another tab already holds the GM seat — surface the picker with
        // an explanation and a sensible default (player).
        showLogin(parent, done, {
          role: 'player',
          playerId: pickFreshPlayerId(),
          name: saved.name,
          customName: true,
          error: 'Your previous GM session was claimed by another tab. Pick a player role to continue.',
          busy: false
        });
        return;
      }
    }
    const result = await login(saved);
    if (result.ok) { done(saved); return; }
    showLogin(parent, done, {
      role: saved.role,
      playerId: saved.playerId,
      name: saved.name,
      customName: false,
      error: result.reason,
      busy: false
    });
    return;
  }
  showLogin(parent, done, defaultUiState());
}

function defaultUiState(): LoginUiState {
  return {
    role: 'gm',
    playerId: 'dm',
    name: 'Game Master',
    customName: false,
    error: null,
    busy: false
  };
}

function showLogin(parent: HTMLElement, done: (id: AuthIdentity) => void, initial: LoginUiState): void {
  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'login-title');
  parent.appendChild(overlay);

  let ui: LoginUiState = { ...initial };
  render();

  // Trap focus inside the panel so Tab can't escape into the (frozen) app.
  const trapHandle = focusTrap(overlay);

  function render(): void {
    const seeded = store.getState().players;
    const gmSeed = seeded.find((p) => p.role === 'gm');
    const playerSeeds = seeded.filter((p) => p.role === 'player');

    overlay.innerHTML = `
      <div class="login-panel">
        <div class="login-corner login-corner-tl"></div>
        <div class="login-corner login-corner-tr"></div>
        <div class="login-corner login-corner-bl"></div>
        <div class="login-corner login-corner-br"></div>

        <div class="login-crest" aria-hidden="true">⚔</div>
        <h1 class="login-title" id="login-title">RoleTop</h1>
        <div class="login-subtitle">Choose your role to enter the session</div>

        <div class="login-roles" role="radiogroup" aria-label="Role">
          <button class="login-role${ui.role === 'gm' ? ' active' : ''}" data-role="gm" role="radio" aria-checked="${ui.role === 'gm'}">
            <span class="login-role-ico" aria-hidden="true">★</span>
            <span class="login-role-label">Game Master</span>
            <span class="login-role-hint">One per session</span>
          </button>
          <button class="login-role${ui.role === 'player' ? ' active' : ''}" data-role="player" role="radio" aria-checked="${ui.role === 'player'}">
            <span class="login-role-ico" aria-hidden="true">♙</span>
            <span class="login-role-label">Player</span>
            <span class="login-role-hint">Multiple welcome</span>
          </button>
        </div>

        ${ui.role === 'player' ? renderPlayerPicker(playerSeeds, ui) : renderGmPicker(gmSeed, ui)}

        <label class="login-name-row">
          <span class="login-lbl">Display name</span>
          <input class="login-name" id="login-name-in" type="text" maxlength="32" autocomplete="off" value="${escapeHtml(ui.name)}" />
        </label>

        ${ui.error ? `<div class="login-error" role="alert">${escapeHtml(ui.error)}</div>` : ''}

        <div class="login-actions">
          <button class="login-join" data-action="join" ${ui.busy ? 'disabled' : ''}>
            ${ui.busy ? 'Joining…' : 'Join Session'}
          </button>
        </div>

        <div class="login-foot">
          ${ui.role === 'gm'
            ? 'You will control the map, walls, fog, and tokens.'
            : 'You will see the map through your character’s eyes.'}
        </div>
      </div>
    `;

    // ── Wire interactions ────────────────────────────────────
    overlay.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((btn) => {
      btn.onclick = () => {
        const r = btn.getAttribute('data-role') as 'gm' | 'player';
        if (r === ui.role) return;
        if (r === 'gm') {
          ui = { ...ui, role: 'gm', playerId: 'dm', name: gmSeed?.name ?? 'Game Master', customName: false, error: null };
        } else {
          const first = playerSeeds[0];
          ui = {
            ...ui,
            role: 'player',
            playerId: first?.id ?? pickFreshPlayerId(),
            name: first?.name ?? 'Adventurer',
            customName: false,
            error: null
          };
        }
        render();
      };
    });

    overlay.querySelectorAll<HTMLButtonElement>('[data-pick-player]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-pick-player')!;
        if (id === '__new__') {
          ui = { ...ui, playerId: pickFreshPlayerId(), name: '', customName: true, error: null };
        } else {
          const p = playerSeeds.find((x) => x.id === id);
          if (!p) return;
          ui = { ...ui, playerId: p.id, name: p.name, customName: false, error: null };
        }
        render();
        const input = overlay.querySelector<HTMLInputElement>('#login-name-in');
        if (ui.customName && input) input.focus();
      };
    });

    const nameInput = overlay.querySelector<HTMLInputElement>('#login-name-in');
    if (nameInput) {
      nameInput.oninput = () => {
        ui = { ...ui, name: nameInput.value, customName: true, error: null };
      };
      nameInput.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          void doJoin();
        }
      };
    }

    const joinBtn = overlay.querySelector<HTMLButtonElement>('[data-action="join"]');
    if (joinBtn) joinBtn.onclick = () => { void doJoin(); };

    // First-time focus
    const focusTarget =
      overlay.querySelector<HTMLElement>('.login-role.active') ??
      overlay.querySelector<HTMLElement>('.login-join');
    focusTarget?.focus();
  }

  async function doJoin(): Promise<void> {
    const trimmedName = ui.name.trim();
    if (!trimmedName) {
      ui = { ...ui, error: 'Pick a name to join.' };
      render();
      return;
    }
    ui = { ...ui, busy: true, error: null };
    render();

    // For new players (custom id), make sure the players list contains them.
    const state = store.getState();
    const existing = state.players.find((p) => p.id === ui.playerId);
    if (!existing) {
      const newPlayer: ChatPlayer = {
        id: ui.playerId,
        name: trimmedName,
        color: pickColor(state.players),
        role: ui.role
      };
      store.setState({ players: [...state.players, newPlayer] });
    } else if (existing.name !== trimmedName) {
      // Player picked a seeded id but typed a different name — update it.
      const updated = state.players.map((p) =>
        p.id === ui.playerId ? { ...p, name: trimmedName } : p
      );
      store.setState({ players: updated });
    }

    const identity: AuthIdentity = {
      role: ui.role,
      playerId: ui.playerId,
      name: trimmedName
    };
    const result = await login(identity);
    if (!result.ok) {
      ui = { ...ui, busy: false, error: result.reason };
      render();
      return;
    }
    // Apply identity to store. setRole + currentUserId.
    const s = store.getState();
    s.setRole(identity.role);
    store.setState({ currentUserId: identity.playerId });

    // Players get vision/fog-of-war on by default — they should only see what
    // their character sees. The GM keeps whatever fog state was already in
    // play (so the "lights on" preview state survives across reloads).
    if (identity.role === 'player') {
      store.getState().setFog(true);
    }

    overlay.classList.add('fading');
    setTimeout(() => {
      trapHandle.release();
      overlay.remove();
      done(identity);
    }, 220);
  }
}

function renderPlayerPicker(playerSeeds: ChatPlayer[], ui: LoginUiState): string {
  return `
    <div class="login-picker" aria-label="Pick a character">
      <div class="login-lbl">Character</div>
      <div class="login-chips">
        ${playerSeeds.map((p) => `
          <button class="login-chip${!ui.customName && ui.playerId === p.id ? ' active' : ''}"
                  data-pick-player="${escapeHtml(p.id)}"
                  type="button"
                  title="${escapeHtml(p.name)}">
            <span class="login-chip-dot" style="background:${escapeHtml(p.color)}" aria-hidden="true"></span>
            <span>${escapeHtml(p.name)}</span>
          </button>
        `).join('')}
        <button class="login-chip${ui.customName ? ' active' : ''}" data-pick-player="__new__" type="button">
          <span class="login-chip-dot" style="background:transparent;border:1px dashed currentColor" aria-hidden="true">+</span>
          <span>New player</span>
        </button>
      </div>
    </div>
  `;
}

function renderGmPicker(gmSeed: ChatPlayer | undefined, ui: LoginUiState): string {
  void ui;
  return `
    <div class="login-picker" aria-label="Game Master">
      <div class="login-lbl">Identity</div>
      <div class="login-chips">
        <button class="login-chip active" data-pick-player="dm" type="button" disabled>
          <span class="login-chip-dot" style="background:${escapeHtml(gmSeed?.color ?? '#c9983a')}" aria-hidden="true">★</span>
          <span>${escapeHtml(gmSeed?.name ?? 'Game Master')}</span>
        </button>
      </div>
    </div>
  `;
}

function pickFreshPlayerId(): string {
  const existing = new Set(store.getState().players.map((p) => p.id));
  let n = existing.size + 1;
  while (existing.has(`p${n}`)) n++;
  return `p${n}`;
}

function pickColor(existing: ChatPlayer[]): string {
  const used = new Set(existing.map((p) => p.color));
  for (const c of COLORS) {
    if (!used.has(c)) return c;
  }
  return COLORS[Math.floor(Math.random() * COLORS.length)] ?? '#c9983a';
}
