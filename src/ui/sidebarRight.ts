import { store, type State } from '../state/store';
import { renderChatInto, send as sendChat } from '../features/chat';
import { RTC_DEMO_ENABLED, rtcStatusLabel, demoParticipants } from '../features/rtc';
import { escapeHtml } from '../utils/escape';
import { run as runMacro } from '../features/macros';
import { toast } from './toast';
import { renderAssetLibraryInto } from './assetLibrary';
import type { Macro } from '../state/schemas';

/**
 * Right sidebar — tabbed panel hosting Chat, Macros and the Asset Library.
 *
 * Previously each of these was a stacked section and the asset library floated
 * on top of the board. That worked but felt noisy: three simultaneous scroll
 * regions, a floating panel that overlapped the map, and an extra toggle
 * button above the toolbar. We now dock everything under a single tab bar so
 * only one panel shows at a time, and the board isn't covered by chrome.
 *
 * The optional RTC demo panel (`VITE_ENABLE_RTC_DEMO=1`) still renders above
 * the tabs as a small fixed banner — it's rare, gated, and stays out of the
 * way when not enabled.
 */

type SidebarTab = 'chat' | 'macros' | 'assets';

const TABS: Array<{ id: SidebarTab; label: string }> = [
  { id: 'chat',   label: 'Chat' },
  { id: 'macros', label: 'Macros' },
  { id: 'assets', label: 'Assets' }
];

export function renderSidebarRight(mount: HTMLElement): void {
  mount.innerHTML = `
    ${RTC_DEMO_ENABLED ? rtcSection() : ''}
    <div class="sb-tabs" role="tablist" aria-label="Right sidebar">
      ${TABS.map((t, i) => `
        <button class="sb-tab${i === 0 ? ' active' : ''}"
                role="tab" aria-selected="${i === 0 ? 'true' : 'false'}"
                data-sb-tab="${t.id}" id="sb-tab-${t.id}"
                aria-controls="sb-panel-${t.id}">${escapeHtml(t.label)}</button>
      `).join('')}
    </div>

    <section class="sb-panel" id="sb-panel-chat" role="tabpanel" aria-labelledby="sb-tab-chat">
      <div id="chat-panel" role="region" aria-labelledby="sb-chat-title">
        <div class="sb-hdr">
          <div class="sb-title" id="sb-chat-title">CHAT &amp; ROLL LOG</div>
          <button class="sm-btn" data-action="clear-chat">Clear</button>
        </div>
        <div id="chat-msgs" role="log" aria-live="polite" aria-label="Chat and roll messages"></div>
        <div id="chat-input-wrap">
          <div id="chat-identity-row">
            <label for="speaking-as" class="chat-identity-lbl">As</label>
            <select id="speaking-as" aria-label="Speaking as" data-action="speaking-as"></select>
          </div>
          <div id="chat-row">
            <textarea id="chat-in" rows="1" aria-label="Chat input"
              placeholder="Message, or /r  /w  /m  ·  Enter to send"></textarea>
            <button id="chat-send-btn" data-action="send" aria-label="Send">↑</button>
          </div>
          <details class="chat-hint-details">
            <summary>Slash commands</summary>
            <div class="chat-hint">
              <div><code>/r 2d20+5</code> roll dice</div>
              <div><code>/w name msg</code> whisper</div>
              <div><code>/m name</code> run macro</div>
              <div><code>/as Aldric hi</code> speak as</div>
            </div>
          </details>
        </div>
      </div>
    </section>

    <section class="sb-panel" id="sb-panel-macros" role="tabpanel" aria-labelledby="sb-tab-macros" hidden>
      <div id="macro-panel" role="region" aria-labelledby="sb-macro-title">
        <div class="sb-hdr">
          <div class="sb-title" id="sb-macro-title">MACROS</div>
          <button class="sm-btn primary" data-action="new-macro">+ New</button>
        </div>
        <div id="macro-list" role="list"></div>
        <div class="macro-edit-row" id="macro-editor" hidden>
          <input class="macro-in" id="macro-key-in" placeholder="Key" />
          <input class="macro-in" id="macro-name-in" placeholder="Name" />
          <input class="macro-in" id="macro-cmd-in" placeholder="/r 1d20+5" />
          <button class="sm-btn primary" data-action="save-macro">✓</button>
        </div>
      </div>
    </section>

    <section class="sb-panel" id="sb-panel-assets" role="tabpanel" aria-labelledby="sb-tab-assets" hidden>
      <div id="asset-library-host"></div>
    </section>
  `;

  // ── Tabs ────────────────────────────────────────────────────
  const tabs   = Array.from(mount.querySelectorAll<HTMLButtonElement>('[data-sb-tab]'));
  const panels = Array.from(mount.querySelectorAll<HTMLElement>('.sb-panel'));
  let currentTab: SidebarTab = 'chat';
  function activate(tabId: SidebarTab): void {
    currentTab = tabId;
    for (const t of tabs) {
      const active = t.getAttribute('data-sb-tab') === tabId;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    }
    for (const p of panels) {
      p.hidden = p.id !== `sb-panel-${tabId}`;
    }
  }
  mount.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sb-tab]');
    if (!tab) return;
    const id = tab.getAttribute('data-sb-tab') as SidebarTab | null;
    if (id) activate(id);
  });

  // Expose a handle so the right icon rail (Foundry-style vertical tabs) can
  // drive the active sidebar panel.
  (window as unknown as {
    sidebarRight?: { activate: (id: SidebarTab) => void; current: () => SidebarTab };
  }).sidebarRight = {
    activate,
    current: () => currentTab
  };

  // Lazy-mount the asset library exactly once — it subscribes to the pack
  // index itself, so after first render it keeps itself up to date.
  const assetHost = mount.querySelector<HTMLElement>('#asset-library-host')!;
  renderAssetLibraryInto(assetHost);

  // Expose a minimal handle so hotkeys / toolbar can flip to the assets tab.
  (window as unknown as { assetLibrary?: { toggle: () => void; show: () => void } }).assetLibrary = {
    toggle: () => {
      const panel = mount.querySelector<HTMLElement>('#sb-panel-assets');
      const current = panel && !panel.hidden;
      activate(current ? 'chat' : 'assets');
    },
    show: () => activate('assets')
  };

  // ── Chat & macros wiring (unchanged behaviour) ──────────────
  mount.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (action === 'speaking-as') {
      return;
    }
    switch (action) {
      case 'clear-chat': {
        const prev = store.getState().chat;
        if (!prev.length) return;
        store.getState().clearChat();
        toast(`Cleared ${prev.length} message${prev.length === 1 ? '' : 's'} — Undo`, 'warn', () => {
          store.getState().replace({ chat: prev });
          toast('Chat restored', 'ok');
        });
        break;
      }
      case 'send': doSend(mount); break;
      case 'new-macro': showEditor(mount); break;
      case 'save-macro': saveMacro(mount); break;
    }
  });

  const input = mount.querySelector<HTMLTextAreaElement>('#chat-in');
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend(mount);
    } else if (e.key === 'Escape') {
      // #20 — Esc returns focus to the board so the hotkey set comes alive
      // again without forcing the player to mouse away.
      e.preventDefault();
      (document.getElementById('board') as HTMLElement | null)?.focus();
      input.blur();
    }
  });

  // #20 — global Enter-to-focus chat when the user isn't already typing and
  // no modal is up. Skip if any input/overlay is active (hotkey overlay,
  // sheet modal, context menu) so we don't hijack ordinary typing.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (target?.isContentEditable) return;
    const overlay = document.getElementById('hotkey-overlay');
    if (overlay && !overlay.hidden) return;
    const sheet = document.getElementById('sheet-modal');
    if (sheet && !sheet.hidden) return;
    const ctx = document.getElementById('ctx-menu');
    if (ctx && ctx.classList.contains('visible')) return;
    // Auto-jump to the Chat tab so the Enter-shortcut can't silently drop
    // focus into a hidden textarea on another tab.
    activate('chat');
    const chatIn = document.getElementById('chat-in') as HTMLTextAreaElement | null;
    if (!chatIn) return;
    e.preventDefault();
    chatIn.focus();
  });

  const speaker = mount.querySelector<HTMLSelectElement>('#speaking-as');
  speaker?.addEventListener('change', () => {
    const v = speaker.value;
    store.getState().setSpeakingAs(v === 'self' ? null : v);
  });

  renderChat(mount);
  renderMacros(mount);
  renderSpeakingAs(mount);
  store.subscribe((s, prev) => {
    if (s.chat !== prev.chat || s.role !== prev.role || s.currentUserId !== prev.currentUserId) {
      renderChat(mount);
    }
    if (s.macros !== prev.macros) renderMacros(mount);
    if (
      s.role !== prev.role ||
      s.currentUserId !== prev.currentUserId ||
      s.tokens !== prev.tokens ||
      s.players !== prev.players ||
      s.speakingAs !== prev.speakingAs
    ) {
      renderSpeakingAs(mount);
    }
  });
}

function renderSpeakingAs(mount: HTMLElement): void {
  const sel = mount.querySelector<HTMLSelectElement>('#speaking-as');
  if (!sel) return;
  const s = store.getState();
  const isGm = s.role === 'gm';
  const currentValue = s.speakingAs ?? 'self';

  const selfPlayer = s.players.find((p) => p.id === s.currentUserId);
  const opts: Array<{ value: string; label: string }> = [
    { value: 'self', label: selfPlayer ? `${selfPlayer.name} (you)` : 'You' }
  ];

  if (isGm) {
    // GMs can speak as any PC…
    for (const p of s.players) {
      if (p.id === s.currentUserId) continue;
      opts.push({ value: p.id, label: `${p.name} (${p.role === 'gm' ? 'GM' : 'player'})` });
    }
    // …and as any non-PC token they own.
    for (const tok of s.tokens) {
      if (tok.type === 'pc') continue;
      opts.push({ value: `token:${tok.id}`, label: `${tok.name} (${tok.type})` });
    }
  }

  sel.innerHTML = opts
    .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
    .join('');
  sel.value = opts.some((o) => o.value === currentValue) ? currentValue : 'self';
}

function doSend(mount: HTMLElement): void {
  const input = mount.querySelector<HTMLTextAreaElement>('#chat-in');
  if (!input) return;
  sendChat(input.value);
  input.value = '';
}

function renderChat(mount: HTMLElement): void {
  const host = mount.querySelector<HTMLElement>('#chat-msgs');
  if (host) renderChatInto(host);
}

function renderMacros(mount: HTMLElement): void {
  const s = store.getState();
  const host = mount.querySelector<HTMLElement>('#macro-list');
  if (!host) return;
  host.innerHTML = s.macros.map((m: Macro) => `
    <div class="macro-entry" data-key="${escapeHtml(m.key)}" role="listitem"
         aria-label="${escapeHtml(m.name)} bound to ${escapeHtml(m.key)}, ${escapeHtml(m.type)} macro">
      <span class="macro-key">${escapeHtml(m.key)}</span>
      <span class="macro-name">${escapeHtml(m.name)}</span>
      <span class="macro-type">${escapeHtml(m.type)}</span>
      <button class="macro-run" data-run="${escapeHtml(m.key)}" aria-label="Run ${escapeHtml(m.name)}">▶</button>
    </div>
  `).join('');
  host.onclick = (e) => {
    const runBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-run]');
    if (runBtn) {
      e.stopPropagation();
      const key = runBtn.getAttribute('data-run')!;
      const m = store.getState().macros.find((x) => x.key === key);
      if (m) runMacro(m);
      return;
    }
    const entry = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
    if (entry) {
      const key = entry.getAttribute('data-key')!;
      const m = store.getState().macros.find((x) => x.key === key);
      if (m) runMacro(m);
    }
  };
}

function showEditor(mount: HTMLElement): void {
  const editor = mount.querySelector<HTMLElement>('#macro-editor');
  if (editor) editor.hidden = false;
  const name = mount.querySelector<HTMLInputElement>('#macro-name-in');
  name?.focus();
}

function saveMacro(mount: HTMLElement): void {
  const key = (mount.querySelector<HTMLInputElement>('#macro-key-in')!.value || 'F9').trim();
  const name = mount.querySelector<HTMLInputElement>('#macro-name-in')!.value.trim();
  const cmd  = mount.querySelector<HTMLInputElement>('#macro-cmd-in')!.value.trim();
  if (!name || !cmd) {
    toast('Name and command required', 'err');
    return;
  }
  store.getState().addMacro({
    key,
    name,
    cmd,
    type: cmd.startsWith('/r') ? 'roll' : 'action'
  });
  const editor = mount.querySelector<HTMLElement>('#macro-editor');
  if (editor) editor.hidden = true;
  mount.querySelectorAll<HTMLInputElement>('.macro-in').forEach((inp) => (inp.value = ''));
  toast(`Macro saved: ${key} → ${name}`, 'ok');
}

function rtcSection(): string {
  const participants = [
    { id: 'self', name: 'You', color: '#c8622a', muted: false, speaking: true, camOn: false },
    ...demoParticipants
  ];
  return `
    <div class="sb-hdr">
      <div class="sb-title">VOICE &amp; VIDEO</div>
      <span id="rtc-status">${escapeHtml(rtcStatusLabel())}</span>
    </div>
    <div id="rtc-bar">
      ${participants.map((p) => `
        <div class="rtc-tile${p.speaking ? ' speaking' : ''}${p.muted ? ' muted' : ''}" title="${escapeHtml(p.name)}">
          <div class="rtc-avatar" style="color:${escapeHtml(p.color)}">${escapeHtml(p.name.charAt(0))}</div>
          <div class="rtc-name">${escapeHtml(p.name)}</div>
          <div class="rtc-mic">${p.muted ? '🔇' : '🎤'}</div>
        </div>
      `).join('')}
    </div>
    <div class="rtc-notice">This panel is a visual stub. No audio or video is transmitted.</div>
  `;
}

// ── Exported for store state typing. ──
export type _State = State;
