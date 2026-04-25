/**
 * D&D 5e condition catalog (review item #5).
 *
 * Each condition has a short label, a single-character glyph rendered on-token,
 * and a tint used for the icon ring. This catalog is intentionally flat — the
 * actual rule mechanics (advantage/disadvantage, incapacitation, etc.) are not
 * modelled here; we just track the presence + duration.
 */
export interface ConditionDef {
  id: string;
  label: string;
  glyph: string;
  tint: string;
  summary: string;
}

export const CONDITIONS: readonly ConditionDef[] = [
  { id: 'blinded',       label: 'Blinded',       glyph: '◎', tint: '#5a5a5a', summary: "Can't see; attacks have disadvantage, attacks against have advantage." },
  { id: 'charmed',       label: 'Charmed',       glyph: '♥', tint: '#c97abf', summary: "Can't attack charmer; charmer has advantage on social checks." },
  { id: 'deafened',      label: 'Deafened',      glyph: '◒', tint: '#6a7a9a', summary: "Can't hear; fails hearing-based checks." },
  { id: 'frightened',    label: 'Frightened',    glyph: '!', tint: '#7a6020', summary: 'Disadvantage while source is visible; cannot approach source.' },
  { id: 'grappled',      label: 'Grappled',      glyph: '⊗', tint: '#906020', summary: 'Speed 0; ends if grappler is incapacitated.' },
  { id: 'incapacitated', label: 'Incapacitated', glyph: 'z', tint: '#909090', summary: "Can't take actions or reactions." },
  { id: 'invisible',     label: 'Invisible',     glyph: '○', tint: '#8ac9d6', summary: 'Heavily obscured for hiding; attacks have advantage, attacks against have disadvantage.' },
  { id: 'paralyzed',     label: 'Paralyzed',     glyph: '✕', tint: '#a03030', summary: 'Incapacitated + no saves Str/Dex; auto-crit within 5 ft.' },
  { id: 'petrified',     label: 'Petrified',     glyph: '▣', tint: '#707078', summary: 'Turned to stone; resistant to most damage.' },
  { id: 'poisoned',      label: 'Poisoned',      glyph: '☠', tint: '#4aa054', summary: 'Disadvantage on attacks and ability checks.' },
  { id: 'prone',         label: 'Prone',         glyph: '↯', tint: '#808040', summary: 'Crawl; disadvantage on attacks; melee attacks against have advantage.' },
  { id: 'restrained',    label: 'Restrained',    glyph: '⛓', tint: '#806040', summary: 'Speed 0; disadvantage on attacks and Dex saves.' },
  { id: 'stunned',       label: 'Stunned',       glyph: '★', tint: '#c9983a', summary: 'Incapacitated + auto-fail Str/Dex saves.' },
  { id: 'unconscious',   label: 'Unconscious',   glyph: 'Z', tint: '#404060', summary: 'Incapacitated + prone + auto-fail Str/Dex saves.' },
  { id: 'bless',         label: 'Bless',         glyph: '+', tint: '#d0b34a', summary: '+1d4 on attacks and saving throws.' },
  { id: 'concentration', label: 'Concentrating', glyph: '◉', tint: '#7F77DD', summary: 'Maintaining a spell with concentration.' }
];

export const CONDITIONS_BY_ID = new Map(CONDITIONS.map((c) => [c.id, c]));

export function getCondition(id: string): ConditionDef | undefined {
  return CONDITIONS_BY_ID.get(id);
}

/**
 * Advance all conditions on a sheet by one turn.
 * Returns the ids of conditions whose duration reached zero (to be removed).
 */
export function tickRound(current: Array<{ id: string; rounds: number; appliedAt: number }>):
  { remaining: Array<{ id: string; rounds: number; appliedAt: number }>; expired: string[] } {
  const expired: string[] = [];
  const remaining: typeof current = [];
  for (const c of current) {
    if (c.rounds <= 0) {
      remaining.push(c); // 0 = indefinite
      continue;
    }
    const next = c.rounds - 1;
    if (next <= 0) expired.push(c.id);
    else remaining.push({ ...c, rounds: next });
  }
  return { remaining, expired };
}
