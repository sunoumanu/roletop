/**
 * Minimal strongly-typed event emitter.
 * Used for UI → engine cross-cutting notifications that don't naturally
 * fit the state store (e.g., "show toast", "play roll popup").
 */
export type Handler<T> = (payload: T) => void;

export class Emitter<T> {
  private readonly handlers = new Set<Handler<T>>();
  on(h: Handler<T>): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  emit(payload: T): void {
    for (const h of this.handlers) h(payload);
  }
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number
): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
