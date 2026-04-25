let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let undoEl: HTMLButtonElement | null = null;
let progressEl: HTMLElement | null = null;
let pausedAt: number | null = null;
let remainingMs = 0;
let currentKind: ToastKind = 'ok';

export function installToastRoot(parent: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.id = 'toast';
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');
  const txt = document.createElement('span');
  txt.id = 'toast-text';
  const btn = document.createElement('button');
  btn.id = 'toast-undo';
  btn.type = 'button';
  btn.textContent = 'Undo';
  btn.hidden = true;
  // #17 — dismiss-timer affordance. A thin animated progress strip along
  // the bottom of the toast runs the full duration; hover pauses it so
  // users can finish reading (particularly for Undo variants).
  const progress = document.createElement('div');
  progress.id = 'toast-progress';
  wrap.appendChild(txt);
  wrap.appendChild(btn);
  wrap.appendChild(progress);
  parent.appendChild(wrap);
  toastEl = wrap;
  undoEl = btn;
  progressEl = progress;

  // Pause on hover/focus so the strip and dismissal timer both freeze.
  const pause = () => {
    if (!toastEl || !toastEl.classList.contains('show') || pausedAt !== null) return;
    pausedAt = Date.now();
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (progressEl) progressEl.style.animationPlayState = 'paused';
  };
  const resume = () => {
    if (pausedAt === null || !toastEl?.classList.contains('show')) return;
    const elapsedWhilePaused = Date.now() - pausedAt;
    pausedAt = null;
    const left = Math.max(250, remainingMs - 0); // remainingMs is the budget at pause time
    void elapsedWhilePaused;
    if (progressEl) progressEl.style.animationPlayState = 'running';
    toastTimer = setTimeout(hide, left);
  };
  wrap.addEventListener('mouseenter', pause);
  wrap.addEventListener('focusin', pause);
  wrap.addEventListener('mouseleave', resume);
  wrap.addEventListener('focusout', resume);
}

export type ToastKind = 'ok' | 'warn' | 'err' | 'info';

export function toast(message: string, kind: ToastKind = 'ok', undo?: () => void): void {
  if (!toastEl) return;
  const text = toastEl.querySelector('#toast-text')!;
  text.textContent = message;
  toastEl.className = `show ${kind}`;
  currentKind = kind;
  if (undoEl) {
    undoEl.hidden = !undo;
    undoEl.onclick = undo ? () => { undo(); hide(); } : null;
  }
  const duration = undo ? 5000 : 2800;
  remainingMs = duration;
  pausedAt = null;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, duration);
  // Reset the CSS animation by toggling it. Setting `animation` to 'none'
  // then re-reading offsetWidth forces a restart so a back-to-back toast
  // shows a fresh progress sweep rather than jumping mid-stride.
  if (progressEl) {
    progressEl.style.animation = 'none';
    // Trigger reflow (suppress unused-expression warning).
    void progressEl.offsetWidth;
    progressEl.style.animation = `toast-progress ${duration}ms linear forwards`;
    progressEl.style.animationPlayState = 'running';
  }
}

function hide(): void {
  if (toastEl) toastEl.className = '';
  if (undoEl) undoEl.hidden = true;
  if (progressEl) progressEl.style.animation = 'none';
  pausedAt = null;
  remainingMs = 0;
  // Keep the kind var around so re-show with same kind doesn't flash.
  void currentKind;
}
