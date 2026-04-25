/**
 * Lightweight focus management for modal dialogs.
 *
 * Review §2 #13 — a11y pass. A modal should:
 *  1. Auto-focus a sensible control when opened
 *  2. Trap Tab/Shift+Tab so focus cycles inside the dialog
 *  3. Restore focus to the opener element when closed
 *
 * We keep this free of framework dependencies and accept a plain HTMLElement
 * as the modal container. Callers attach/detach the trap around show/hide.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export interface FocusTrap {
  /** Release the keydown listener + restore focus to the element that was focused before `trap` ran. */
  release(): void;
}

/**
 * Attach a focus trap to `container`. Returns a handle whose `release()`
 * removes the listener and restores focus to whatever was focused when this
 * was first called. Call `trap()` after the modal is visible.
 *
 * @param container  The modal's root element (will scope focus queries).
 * @param autoFocus  Optional override for which element to focus initially.
 *                   Defaults to the first focusable descendant.
 */
export function trap(container: HTMLElement, autoFocus?: HTMLElement | null): FocusTrap {
  const previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;

  const initial = autoFocus ?? firstFocusable(container);
  // Defer focus to next frame so CSS transitions (visibility/opacity) don't
  // swallow the focus ring on first paint.
  queueMicrotask(() => initial?.focus());

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
    if (focusables.length === 0) { e.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        last.focus();
        e.preventDefault();
      }
    } else {
      if (active === last) {
        first.focus();
        e.preventDefault();
      }
    }
  };

  container.addEventListener('keydown', onKeyDown);

  return {
    release() {
      container.removeEventListener('keydown', onKeyDown);
      // Restore focus to the opener if it's still in the DOM and focusable.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    }
  };
}

function firstFocusable(container: HTMLElement): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
  // Prefer a name/text input over the close button when both exist.
  const preferred = candidates.find((el) =>
    el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'submit'].includes((el as HTMLInputElement).type)
  );
  return preferred ?? candidates[0] ?? null;
}
