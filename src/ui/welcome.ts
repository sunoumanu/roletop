import { trap, type FocusTrap } from './focusTrap';

/**
 * #1 — first-run welcome flow.
 *
 * Shows a three-step dismissible overlay on the very first mount so new
 * GMs have a pointer to the toolbar, per-token actions, and the chat /
 * combat sidebars. We gate on `localStorage['vtt:phase6:welcomed']` so
 * returning users skip this entirely.
 */

const FLAG_KEY = 'vtt:phase6:welcomed';

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: "Here's your scene",
    body: 'The canvas in the middle shows a demo party and a few enemies. Pan with arrow keys, zoom with + / −, and fit the map with the <strong>FIT</strong> button in the bottom-left.'
  },
  {
    title: 'Interact with tokens',
    body: 'Right-click any token for damage, healing, conditions, and the character sheet. On a tablet, long-press works too. Press <kbd>?</kbd> any time to see every shortcut.'
  },
  {
    title: 'Toolbar and sidebars',
    body: 'The vertical toolbar on the far left controls the map (tools, grid, fog, undo). The panel next to it lists tokens and runs initiative. The right-hand panel holds chat, dice, and macros — try <code>/r 2d20kh1+5</code>.'
  }
];

export function installWelcomeFlow(parent: HTMLElement): void {
  if (hasSeenWelcome()) return;
  const wrap = document.createElement('div');
  wrap.id = 'welcome-overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'welcome-title');
  wrap.innerHTML = renderStep(0);
  parent.appendChild(wrap);

  let index = 0;
  const focus: FocusTrap = trap(wrap);

  const render = () => {
    wrap.innerHTML = renderStep(index);
    // Re-focus the next button so keyboard users can advance with Enter.
    queueMicrotask(() => wrap.querySelector<HTMLButtonElement>('[data-welcome="next"], [data-welcome="done"]')?.focus());
  };

  wrap.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-welcome]');
    if (!btn) return;
    const act = btn.getAttribute('data-welcome');
    if (act === 'skip' || act === 'done') {
      close();
      return;
    }
    if (act === 'next') {
      if (index < STEPS.length - 1) { index++; render(); }
      else close();
    }
    if (act === 'back' && index > 0) { index--; render(); }
  });

  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'ArrowRight' && index < STEPS.length - 1) { e.preventDefault(); index++; render(); }
    if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); index--; render(); }
  });

  function close(): void {
    focus.release();
    wrap.remove();
    try { localStorage.setItem(FLAG_KEY, '1'); } catch { /* private mode etc. */ }
  }
}

function renderStep(i: number): string {
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;
  const dots = STEPS.map((_, j) => `<span class="welcome-dot${j === i ? ' on' : ''}" aria-hidden="true"></span>`).join('');
  return `
    <div class="welcome-panel">
      <div class="welcome-step" aria-live="polite">Step ${i + 1} of ${STEPS.length}</div>
      <h2 id="welcome-title" class="welcome-title">${step.title}</h2>
      <div class="welcome-body">${step.body}</div>
      <div class="welcome-dots" aria-hidden="true">${dots}</div>
      <div class="welcome-actions">
        <button class="sm-btn" data-welcome="skip">Skip tour</button>
        <div style="flex:1"></div>
        ${i > 0 ? '<button class="sm-btn" data-welcome="back">Back</button>' : ''}
        ${last
          ? '<button class="sm-btn primary" data-welcome="done">Get started</button>'
          : '<button class="sm-btn primary" data-welcome="next">Next ›</button>'}
      </div>
    </div>
  `;
}

function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return true; // fail closed — don't spam a browser that can't remember the flag
  }
}
