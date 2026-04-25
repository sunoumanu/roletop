import { store, type State } from '../state/store';
import { camera } from '../engine/camera';
import { MAP_H, MAP_W } from '../engine/grid';
import { escapeHtml } from '../utils/escape';
import { canSeeTokenHp } from '../features/roles';
import { execute, cmdClearWalls, undo as undoLast } from '../state/history';
import { rollInitiative, nextTurn, resetWithUndo, addTokenToInitiative, delayTurn } from '../features/initiative';
import { isGM } from '../features/roles';
import { AOE_DEFAULT_SIZES } from '../engine/aoe';
import { MAP_CELLS_X, MAP_CELLS_Y } from '../engine/grid';
import { toast } from './toast';
import { contrastingText } from '../utils/color';

/**
 * Left sidebar — tokens, layers, stats, initiative, AoE config, zoom.
 */
export function renderSidebarLeft(mount: HTMLElement): void {
  mount.innerHTML = `
    <div class="sb-hdr">
      <div class="sb-title" id="sb-scene-title">SCENE</div>
      <button class="sm-btn" data-action="clear-walls" data-gm-only>Clear Walls</button>
    </div>
    <div class="sb-sec" id="token-sec" role="region" aria-label="Tokens">
      <div class="sb-lbl">Tokens</div>
      <div class="tok-list" id="token-list" role="list"></div>
    </div>
    <div class="sb-sec" role="region" aria-label="Layers">
      <div class="sb-lbl">Layers</div>
      <div id="layers-host"></div>
    </div>
    <div class="sb-sec" id="aoe-host" role="region" aria-label="AoE template configuration"></div>
    <div class="sb-sec" id="fog-host" role="region" aria-label="Manual fog configuration"></div>
    <div class="sb-sec" role="region" aria-label="Scene stats">
      <div class="stats-grid">
        <div class="stat-box"><div class="stat-val" id="stat-tokens">0</div><div class="stat-lbl">TOKENS</div></div>
        <div class="stat-box"><div class="stat-val" id="stat-fps">60</div><div class="stat-lbl">FPS</div></div>
        <div class="stat-box"><div class="stat-val" id="stat-turn">—</div><div class="stat-lbl">ROUND</div></div>
        <div class="stat-box"><div class="stat-val" id="stat-role">GM</div><div class="stat-lbl">VIEW</div></div>
      </div>
    </div>
    <div id="init-panel" role="region" aria-labelledby="sb-init-title">
      <div class="sb-hdr" style="border-top:1px solid var(--border)">
        <div class="sb-title" id="sb-init-title">INITIATIVE</div>
        <button class="sm-btn primary" data-action="roll-init">Roll All</button>
      </div>
      <div id="init-list" aria-live="polite" aria-label="Initiative order"></div>
      <div id="init-add-row" class="init-add-row" data-gm-only></div>
      <div class="init-controls">
        <button class="sm-btn primary" data-action="next-turn" style="flex:1">Next Turn ›</button>
        <button class="sm-btn" data-action="delay-turn" title="Delay current turn (acts last)">Delay</button>
        <button class="sm-btn" data-action="reset-init">Reset</button>
      </div>
    </div>
    <div class="sb-footer">
      <div class="zoom-ctrl" role="group" aria-label="Zoom controls">
        <button class="z-btn" data-action="zoom-out" aria-label="Zoom out">−</button>
        <span class="z-val" id="zoom-label">100%</span>
        <button class="z-btn" data-action="zoom-in" aria-label="Zoom in">+</button>
        <button class="z-btn" data-action="fit" style="width:auto;padding:0 5px" aria-label="Fit map to view">FIT</button>
      </div>
    </div>
  `;

  mount.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!el) return;
    const action = el.getAttribute('data-action');
    const s = store.getState();
    switch (action) {
      case 'clear-walls': {
        const prev = [...s.walls];
        if (!prev.length) return;
        execute(cmdClearWalls(prev));
        toast(`Cleared ${prev.length} wall${prev.length === 1 ? '' : 's'} — Undo`, 'warn', () => {
          undoLast();
          toast(`Restored ${prev.length} wall${prev.length === 1 ? '' : 's'}`, 'ok');
        });
        break;
      }
      case 'roll-init': rollInitiative(); break;
      case 'next-turn': nextTurn(); break;
      case 'delay-turn': delayTurn(); break;
      case 'reset-init':
        resetWithUndo((restore, count) => {
          toast(`Initiative cleared (${count}) — Undo`, 'warn', () => {
            restore();
            toast('Initiative restored', 'ok');
          });
        });
        break;
      case 'init-remove': {
        const idAttr = el.getAttribute('data-init-id');
        if (!idAttr) break;
        const id = Number(idAttr);
        const removed = s.initiative.order.find((e) => e.id === id);
        if (!removed) break;
        const prev = { order: [...s.initiative.order], current: s.initiative.current, round: s.initiative.round };
        s.removeFromInitiative(id);
        toast(`${removed.name} removed from initiative — Undo`, 'warn', () => {
          store.getState().setInitiative(prev);
          toast(`${removed.name} restored`, 'ok');
        });
        break;
      }
      case 'zoom-out': camera.zoom = Math.max(camera.minZoom, camera.zoom - 0.25); s.markDirty(); break;
      case 'zoom-in':  camera.zoom = Math.min(camera.maxZoom, camera.zoom + 0.25); s.markDirty(); break;
      case 'fit': {
        const board = document.getElementById('board') as HTMLCanvasElement | null;
        if (board) camera.fit(board.clientWidth, board.clientHeight, MAP_W, MAP_H);
        s.markDirty();
        break;
      }
    }
  });

  renderAll(mount);
  store.subscribe((s, prev) => {
    if (s.tokens !== prev.tokens || s.selectedTokenId !== prev.selectedTokenId || s.role !== prev.role) renderTokens(mount, s);
    if (s.layers !== prev.layers) renderLayers(mount, s);
    if (s.initiative !== prev.initiative) renderInitiative(mount, s);
    if (s.currentTool !== prev.currentTool || s.aoeShape !== prev.aoeShape || s.aoeSize !== prev.aoeSize) renderAoeConfig(mount, s);
    if (
      s.currentTool !== prev.currentTool ||
      s.fogBrushMode !== prev.fogBrushMode ||
      s.manualFogEnabled !== prev.manualFogEnabled ||
      s.manualFog !== prev.manualFog
    ) renderFogConfig(mount, s);
    if (s.role !== prev.role) {
      refreshGmOnly(mount);
      const el = document.getElementById('stat-role');
      if (el) el.textContent = s.role === 'gm' ? 'GM' : 'PLR';
    }
  });
  refreshGmOnly(mount);
}

function renderAll(mount: HTMLElement): void {
  const s = store.getState();
  renderTokens(mount, s);
  renderLayers(mount, s);
  renderInitiative(mount, s);
  renderAoeConfig(mount, s);
  renderFogConfig(mount, s);
}

function renderTokens(mount: HTMLElement, s: State): void {
  const host = mount.querySelector<HTMLElement>('#token-list')!;
  if (s.tokens.length === 0) {
    const gm = isGM();
    host.innerHTML = gm
      ? `<div class="empty-hint">No tokens yet. Use <kbd>+ Token</kbd>, drag an image onto the canvas, or load a saved scene.</div>`
      : `<div class="empty-hint">No tokens on the scene yet — waiting on the GM.</div>`;
    const count = mount.querySelector('#stat-tokens');
    if (count) count.textContent = '0';
    return;
  }
  host.innerHTML = s.tokens.map((tok) => {
    const seeHp = canSeeTokenHp(tok);
    const pct = Math.max(0, Math.min(1, tok.hp / tok.maxHp));
    const hc = pct > 0.6 ? '#4a8a3a' : pct > 0.3 ? '#c9983a' : '#8b2020';
    const selected = tok.id === s.selectedTokenId;
    const hpText = seeHp ? `${tok.hp}/${tok.maxHp} hit points` : 'hit points hidden';
    const fg = contrastingText(tok.color);
    return `
      <div class="tok-entry${selected ? ' sel' : ''}" data-token-id="${tok.id}" role="listitem"
           tabindex="0" aria-selected="${selected}"
           aria-label="${escapeHtml(tok.name)}, ${escapeHtml(tok.type)}, ${hpText}">
        <div class="tok-av" style="background:${escapeHtml(tok.color)};color:${fg}" aria-hidden="true">${escapeHtml(tok.initial)}</div>
        <div class="tok-info">
          <div class="tok-nm">${escapeHtml(tok.name)}</div>
          <div class="tok-sb">${escapeHtml(tok.type.toUpperCase())} · ${seeHp ? `${tok.hp}/${tok.maxHp}` : '?? / ??'}</div>
          <div class="hp-bar" aria-hidden="true"><div class="hp-fill" style="width:${pct * 100}%;background:${seeHp ? hc : 'rgba(139,32,32,.6)'}"></div></div>
        </div>
      </div>
    `;
  }).join('');
  host.onclick = (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-token-id]');
    if (!el) return;
    const id = Number(el.getAttribute('data-token-id'));
    store.getState().selectToken(id === s.selectedTokenId ? null : id);
  };
  host.ondblclick = (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-token-id]');
    if (!el) return;
    const id = Number(el.getAttribute('data-token-id'));
    const tok = store.getState().tokens.find((t) => t.id === id);
    if (tok) store.getState().setOpenSheet(tok.sheetId ?? null);
  };
  host.onkeydown = (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-token-id]');
    if (!el) return;
    const id = Number(el.getAttribute('data-token-id'));
    const st = store.getState();
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      st.selectToken(id === st.selectedTokenId ? null : id);
    } else if (e.key === 'o' || e.key === 'O') {
      const tok = st.tokens.find((t) => t.id === id);
      if (tok) st.setOpenSheet(tok.sheetId ?? null);
    }
  };
  const count = mount.querySelector('#stat-tokens');
  if (count) count.textContent = String(s.tokens.length);
}

function renderLayers(mount: HTMLElement, s: State): void {
  const host = mount.querySelector<HTMLElement>('#layers-host')!;
  const rows: Array<[keyof State['layers'], string, string]> = [
    ['overlay', 'Overlay', '#c8622a'],
    ['fog',     'Vision',  '#8b2020'],
    ['tokens',  'Tokens',  '#7F77DD'],
    ['grid',    'Grid',    '#1D9E75'],
    ['map',     'Map',     '#378ADD']
  ];
  host.innerHTML = rows.map(([k, name, color]) => `
    <div class="lyr-row" data-layer="${k}">
      <div class="lyr-dot" style="background:${color}"></div>
      <span class="lyr-nm">${name}</span>
      <div class="lyr-tog${s.layers[k] ? ' on' : ''}"></div>
    </div>
  `).join('');
  host.onclick = (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-layer]');
    if (!el) return;
    store.getState().toggleLayer(el.getAttribute('data-layer') as keyof State['layers']);
  };
}

function renderInitiative(mount: HTMLElement, s: State): void {
  const host = mount.querySelector<HTMLElement>('#init-list')!;
  const gm = isGM();
  if (!s.initiative.order.length) {
    host.innerHTML = `<div class="empty-hint">Roll initiative to begin combat (press <kbd>I</kbd> or click <strong>Roll All</strong>).</div>`;
  } else {
    host.innerHTML = s.initiative.order.map((e, i) => {
      const active = i === s.initiative.current;
      const fg = contrastingText(e.color);
      const maxHp = Math.max(1, e.maxHp);
      const hpPct = e.hp / maxHp;
      const hpClass = e.hp === 0 ? 'ie-hp zero' : hpPct < 0.5 ? 'ie-hp low' : 'ie-hp';
      return `
        <div class="init-entry${active ? ' active' : ''}" data-init-id="${e.id}">
          ${gm
            ? `<input class="ie-num ie-edit" type="number" step="1" value="${e.roll}" data-init-roll="${e.id}" aria-label="${escapeHtml(e.name)} roll" />`
            : `<span class="ie-num">${e.roll}</span>`}
          <div class="ie-av" style="background:${escapeHtml(e.color)};color:${fg}" aria-hidden="true">${escapeHtml(e.name.charAt(0))}</div>
          <span class="ie-name">${escapeHtml(e.name)}</span>
          <span class="${hpClass}" title="${e.hp} of ${e.maxHp} hit points">${e.hp}/${e.maxHp}</span>
          ${active ? '<span class="ie-active-arrow" aria-label="Current turn">▶</span>' : ''}
          ${gm ? `<button class="ie-rm" data-action="init-remove" data-init-id="${e.id}" title="Remove from initiative" aria-label="Remove ${escapeHtml(e.name)} from initiative">✕</button>` : ''}
        </div>
      `;
    }).join('');
    if (gm) {
      // Commit edits on blur / Enter — re-sort happens in the store action.
      host.querySelectorAll<HTMLInputElement>('[data-init-roll]').forEach((input) => {
        const commit = () => {
          const id = Number(input.getAttribute('data-init-roll'));
          const v = Number(input.value);
          if (!Number.isFinite(v)) return;
          store.getState().setInitiativeRoll(id, v | 0);
        };
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        });
      });
    }
  }
  // Render the "add mid-combat" chooser once the order exists.
  const addRow = mount.querySelector<HTMLElement>('#init-add-row');
  if (addRow) {
    if (!gm || !s.initiative.order.length) {
      addRow.innerHTML = '';
    } else {
      const inInit = new Set(s.initiative.order.map((e) => e.id));
      const candidates = s.tokens.filter((t) => !inInit.has(t.id));
      if (candidates.length === 0) {
        addRow.innerHTML = '';
      } else {
        addRow.innerHTML = `
          <label>Add to init</label>
          <select id="init-add-sel" aria-label="Add token to initiative">
            <option value="">—</option>
            ${candidates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
          </select>
        `;
        const sel = addRow.querySelector<HTMLSelectElement>('#init-add-sel');
        sel?.addEventListener('change', () => {
          const id = Number(sel.value);
          if (!Number.isFinite(id) || id === 0) return;
          addTokenToInitiative(id);
          sel.value = '';
        });
      }
    }
  }
  const ib = document.getElementById('ib-name');
  if (ib) ib.textContent = s.initiative.order[s.initiative.current]?.name ?? '—';
  const stat = document.getElementById('stat-turn');
  if (stat) stat.textContent = s.initiative.order.length ? String(s.initiative.round) : '—';

  // #18 — dynamic titles on Next Turn / Delay so keyboard-first / hover users
  // don't have to re-scan the tracker to see who acts next.
  const nextBtn = mount.querySelector<HTMLButtonElement>('[data-action="next-turn"]');
  const delayBtn = mount.querySelector<HTMLButtonElement>('[data-action="delay-turn"]');
  if (nextBtn || delayBtn) {
    const order = s.initiative.order;
    if (!order.length) {
      nextBtn?.setAttribute('title', 'No initiative yet — press Roll All');
      delayBtn?.setAttribute('title', 'No initiative yet');
    } else {
      const curIdx = Math.max(0, Math.min(order.length - 1, s.initiative.current));
      const current = order[curIdx]!;
      const nextIdx = (curIdx + 1) % order.length;
      const next = order[nextIdx]!;
      if (nextBtn) {
        nextBtn.title = `Advance to ${next.name} (roll ${next.roll})`;
      }
      if (delayBtn) {
        const afterIdx = curIdx === order.length - 1 ? 0 : curIdx + 1;
        const after = order[afterIdx]!;
        delayBtn.title = `Delay — ${current.name} acts after ${after.name}`;
      }
    }
  }
}

function renderAoeConfig(mount: HTMLElement, s: State): void {
  const host = mount.querySelector<HTMLElement>('#aoe-host')!;
  const active = s.currentTool === 'aoe';
  host.style.display = active ? '' : 'none';
  if (!active) { host.innerHTML = ''; return; }
  const shapes: Array<[State['aoeShape'], string]> = [
    ['sphere', 'Sphere'], ['cone', 'Cone'], ['line', 'Line'], ['cube', 'Cube']
  ];
  host.innerHTML = `
    <div class="sb-lbl">AoE Template</div>
    <div class="aoe-shape-row">
      ${shapes.map(([k, label]) => `
        <button class="sm-btn${s.aoeShape === k ? ' primary' : ''}" data-aoe-shape="${k}">${label}</button>
      `).join('')}
    </div>
    <label class="aoe-size">
      <span>Size</span>
      <input type="number" min="5" max="120" step="5" value="${s.aoeSize}" id="aoe-size-in" />
      <span>ft</span>
    </label>
    <div class="aoe-hint">Click the map to place.</div>
  `;
  host.onclick = (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-aoe-shape]');
    if (!el) return;
    const shape = el.getAttribute('data-aoe-shape') as State['aoeShape'];
    store.getState().setAoeShape(shape);
    store.getState().setAoeSize(AOE_DEFAULT_SIZES[shape]);
  };
  const sizeIn = host.querySelector<HTMLInputElement>('#aoe-size-in');
  if (sizeIn) sizeIn.oninput = () => {
    const v = Math.max(5, Math.min(120, Number(sizeIn.value) || 0));
    store.getState().setAoeSize(v);
  };
}

function renderFogConfig(mount: HTMLElement, s: State): void {
  const host = mount.querySelector<HTMLElement>('#fog-host');
  if (!host) return;
  const active = s.currentTool === 'fogbrush' && s.role === 'gm';
  host.style.display = active ? '' : 'none';
  if (!active) { host.innerHTML = ''; return; }

  host.innerHTML = `
    <div class="sb-lbl">Manual Fog</div>
    <div class="fog-mode-row">
      <button class="sm-btn${s.fogBrushMode === 'reveal' ? ' primary' : ''}" data-fog-mode="reveal">Reveal</button>
      <button class="sm-btn${s.fogBrushMode === 'hide' ? ' primary' : ''}" data-fog-mode="hide">Hide</button>
    </div>
    <label class="fog-toggle">
      <input type="checkbox" data-fog-enable ${s.manualFogEnabled ? 'checked' : ''} />
      <span>Fog overlay enabled</span>
    </label>
    <div class="fog-stats">${s.manualFog.length} cell${s.manualFog.length === 1 ? '' : 's'} revealed</div>
    <div class="fog-actions">
      <button class="sm-btn" data-fog-action="reveal-all">Reveal all</button>
      <button class="sm-btn" data-fog-action="hide-all">Hide all</button>
    </div>
    <div class="aoe-hint">Drag on the map to paint a rectangle.</div>
  `;
  host.onclick = (e) => {
    const modeEl = (e.target as HTMLElement).closest<HTMLElement>('[data-fog-mode]');
    if (modeEl) {
      const mode = modeEl.getAttribute('data-fog-mode') as 'reveal' | 'hide';
      store.getState().setFogBrushMode(mode);
      return;
    }
    const actEl = (e.target as HTMLElement).closest<HTMLElement>('[data-fog-action]');
    if (actEl) {
      const act = actEl.getAttribute('data-fog-action');
      const st = store.getState();
      if (act === 'reveal-all') {
        const cells: string[] = [];
        for (let cy = 0; cy < MAP_CELLS_Y; cy++) {
          for (let cx = 0; cx < MAP_CELLS_X; cx++) {
            cells.push(`${cx},${cy}`);
          }
        }
        const before = [...st.manualFog];
        st.replaceManualFog(cells);
        if (!st.manualFogEnabled) st.setManualFogEnabled(true);
        toast('All cells revealed — Undo', 'warn', () => {
          store.getState().replaceManualFog(before);
          toast('Fog restored', 'ok');
        });
      } else if (act === 'hide-all') {
        const before = [...st.manualFog];
        st.clearManualFog();
        if (!st.manualFogEnabled) st.setManualFogEnabled(true);
        toast('All cells hidden — Undo', 'warn', () => {
          store.getState().replaceManualFog(before);
          toast('Fog restored', 'ok');
        });
      }
    }
  };
  const toggleEl = host.querySelector<HTMLInputElement>('[data-fog-enable]');
  if (toggleEl) toggleEl.onchange = () => store.getState().setManualFogEnabled(toggleEl.checked);
}

function refreshGmOnly(mount: HTMLElement): void {
  const isGm = store.getState().role === 'gm';
  for (const el of mount.querySelectorAll<HTMLElement>('[data-gm-only]')) {
    el.style.display = isGm ? '' : 'none';
  }
}
