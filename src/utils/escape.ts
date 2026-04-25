/**
 * HTML-escape an arbitrary string so it is safe to interpolate into innerHTML.
 *
 * Fix for review item #2: the phase-5 chat rendered `${m.body}` directly; pasting
 * `<img src=x onerror=alert(1)>` into chat fired a script. Everything rendered via
 * innerHTML in this project passes through here first.
 */
const ENTITY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;'
};

export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[&<>"'`]/g, (ch) => ENTITY_MAP[ch] ?? ch);
}

/** Tag-function shorthand — `html\`<div>${userInput}</div>\`` auto-escapes interpolations. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += escapeHtml(values[i]) + (strings[i + 1] ?? '');
  }
  return out;
}

/**
 * Lightweight "raw" marker so a template can interpolate already-safe markup
 * (e.g., a sub-component's own `html``` result) without double-escaping.
 */
export class Raw {
  constructor(public readonly value: string) {}
}
export function raw(s: string): Raw {
  return new Raw(s);
}
function isRaw(v: unknown): v is Raw {
  return v instanceof Raw;
}

/** Same as `html` but honors Raw interpolations. */
export function htmlRaw(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out += (isRaw(v) ? v.value : escapeHtml(v)) + (strings[i + 1] ?? '');
  }
  return out;
}
