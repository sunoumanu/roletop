/**
 * Color helpers — luminance-based contrast picking.
 *
 * Used to keep text legible on top of user/config-defined background colors
 * (token avatars, condition chips — review §3 #13 and §3 #25). Avoids a full
 * WCAG contrast ratio computation; the relative-luminance threshold is close
 * enough for the kinds of palette we permit in this app.
 */

/** Parse "#rrggbb" / "#rgb" / "rgb(…)" into [r,g,b] in the 0–255 range. */
function parseRgb(input: string): [number, number, number] | null {
  if (!input) return null;
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6) return null;
    const n = parseInt(hex, 16);
    if (Number.isNaN(n)) return null;
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** Relative luminance per WCAG. Input may be any color string we can parse. */
export function relativeLuminance(color: string): number {
  const rgb = parseRgb(color);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Pick a legible foreground color (`dark` or `light`) for overlaying on
 * `bg`. Uses luminance threshold tuned for the parchment/ink palette.
 */
export function contrastingText(
  bg: string,
  light = '#f5edd6',
  dark = '#1a1208'
): string {
  return relativeLuminance(bg) > 0.55 ? dark : light;
}
