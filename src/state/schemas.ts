import { z } from 'zod';

/**
 * Zod schemas for every persisted / networked object shape.
 *
 * Pass everything that crosses a trust boundary (localStorage, imported JSON,
 * eventually network messages) through `Scene.parse(...)` — malformed data
 * throws rather than silently corrupting state.
 */

export const AbilityScoresSchema = z.object({
  str: z.number().int().min(1).max(30).default(10),
  dex: z.number().int().min(1).max(30).default(10),
  con: z.number().int().min(1).max(30).default(10),
  int: z.number().int().min(1).max(30).default(10),
  wis: z.number().int().min(1).max(30).default(10),
  cha: z.number().int().min(1).max(30).default(10)
});
export type AbilityScores = z.infer<typeof AbilityScoresSchema>;

export const SavesSchema = z.object({
  str: z.boolean().default(false),
  dex: z.boolean().default(false),
  con: z.boolean().default(false),
  int: z.boolean().default(false),
  wis: z.boolean().default(false),
  cha: z.boolean().default(false)
});

export const ConditionInstanceSchema = z.object({
  id: z.string(),             // condition catalog key (e.g. 'poisoned')
  rounds: z.number().int().min(0).default(0), // 0 = indefinite
  appliedAt: z.number().int() // epoch ms
});
export type ConditionInstance = z.infer<typeof ConditionInstanceSchema>;

export const CharacterSheetSchema = z.object({
  id: z.string(),
  name: z.string().max(80),
  level: z.number().int().min(1).max(20).default(1),
  classLabel: z.string().max(40).default(''),
  ac: z.number().int().min(1).max(30).default(10),
  speed: z.number().int().min(0).max(120).default(30),
  hp: z.number().int().min(0).default(10),
  maxHp: z.number().int().min(1).default(10),
  tempHp: z.number().int().min(0).default(0),
  deathSaves: z.object({ successes: z.number().int().min(0).max(3).default(0), failures: z.number().int().min(0).max(3).default(0) }).default({ successes: 0, failures: 0 }),
  abilities: AbilityScoresSchema.default({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
  saves: SavesSchema.default({ str: false, dex: false, con: false, int: false, wis: false, cha: false }),
  proficiency: z.number().int().min(2).max(6).default(2),
  passivePerception: z.number().int().default(10),
  notes: z.string().max(2000).default(''),
  conditions: z.array(ConditionInstanceSchema).default([]),
  /**
   * Sheet-level portrait art (Phase B). Used as the second step in the
   * token-art fallback chain: `Token.image` → `CharacterSheet.portrait` →
   * procedural letter circle. Data URL or http(s) URL; same format as
   * `Token.image`.
   */
  portrait: z.string().optional()
});
export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;

export const TokenTypeSchema = z.enum(['pc', 'npc', 'enemy']);
export type TokenType = z.infer<typeof TokenTypeSchema>;

export const TokenSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(40),
  type: TokenTypeSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  initial: z.string().min(1).max(2),
  wx: z.number(),
  wy: z.number(),
  /** HP is mirrored from the linked sheet for fast render; sheet remains the source of truth. */
  hp: z.number().int().default(10),
  maxHp: z.number().int().default(10),
  ownerId: z.string().default('dm'),   // 'dm' or player id
  sheetId: z.string().optional(),      // points into sheets map
  dead: z.boolean().default(false),
  /**
   * Custom token art (§3 graphics). Data-URL (or http/https URL) for the
   * rendered portrait. When absent, the renderer falls back to the procedural
   * colored-letter circle from AssetManager.
   */
  image: z.string().optional(),
  /**
   * Optional animation descriptor (Phase B [M]). When present, `image` is
   * interpreted as an animated source rather than a static bitmap:
   *   - `kind: 'video'` — WebM/MP4 with transparent alpha. The renderer
   *     plays it muted + looping and blits the current video frame.
   *   - `kind: 'sprite'` — spritesheet stored at `image`. `cols`/`rows` lay
   *     out the frames row-major; `fps` sets playback speed.
   * Absent = static image (the default, backwards compatible).
   */
  animation: z
    .union([
      z.object({ kind: z.literal('video') }),
      z.object({
        kind: z.literal('sprite'),
        cols: z.number().int().min(1).max(64),
        rows: z.number().int().min(1).max(64),
        fps: z.number().min(0.1).max(60).default(8)
      })
    ])
    .optional()
});
export type Token = z.infer<typeof TokenSchema>;
export type TokenAnimation = NonNullable<Token['animation']>;

export const WallSchema = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number()
});
export type Wall = z.infer<typeof WallSchema>;

export const AoEShapeSchema = z.enum(['sphere', 'cone', 'line', 'cube']);
export type AoEShape = z.infer<typeof AoEShapeSchema>;

export const AoETemplateSchema = z.object({
  id: z.string(),
  shape: AoEShapeSchema,
  originX: z.number(),
  originY: z.number(),
  /** For sphere/cube: radius in ft. For cone/line: length in ft. */
  sizeFt: z.number().min(5).max(120),
  /** For cone/line: direction in radians. */
  angle: z.number().default(0),
  color: z.string().default('#c8622a')
});
export type AoETemplate = z.infer<typeof AoETemplateSchema>;

export const ChatPlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  role: z.enum(['gm', 'player'])
});
export type ChatPlayer = z.infer<typeof ChatPlayerSchema>;

export const ChatMsgSchema = z.object({
  id: z.number().int(),
  time: z.number().int(), // epoch ms
  type: z.enum(['chat', 'whisper', 'roll', 'system', 'div', 'macro-log']),
  author: z.string().optional(),
  color: z.string().optional(),
  body: z.string().optional(),
  self: z.boolean().optional(),
  // roll fields
  expr: z.string().optional(),
  result: z.number().optional(),
  breakdown: z.array(z.unknown()).optional(),
  bonus: z.number().optional(),
  isCrit: z.boolean().optional(),
  isFumble: z.boolean().optional(),
  // whisper target
  whisperTo: z.string().optional(),
  // visibility: if present, only these user-ids see this message
  visibility: z.array(z.string()).optional()
});
export type ChatMsg = z.infer<typeof ChatMsgSchema>;

export const MacroSchema = z.object({
  key: z.string().max(4),
  name: z.string().min(1).max(40),
  cmd: z.string().min(1).max(200),
  type: z.enum(['roll', 'action'])
});
export type Macro = z.infer<typeof MacroSchema>;

export const InitiativeEntrySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  color: z.string(),
  roll: z.number().int(),
  hp: z.number().int(),
  maxHp: z.number().int()
});
export type InitiativeEntry = z.infer<typeof InitiativeEntrySchema>;

export const RoleSchema = z.enum(['gm', 'player']);
export type Role = z.infer<typeof RoleSchema>;

export const SceneSchema = z.object({
  version: z.literal(6),
  // role + currentUserId are *identity* and live on the login screen, not in
  // scene data. Kept optional here so older saves that still embed them parse
  // cleanly; `applyScene` strips them before they reach the store.
  role: RoleSchema.optional(),
  currentUserId: z.string().optional(),
  tokens: z.array(TokenSchema),
  walls: z.array(WallSchema),
  sheets: z.record(CharacterSheetSchema),
  aoeTemplates: z.array(AoETemplateSchema),
  chat: z.array(ChatMsgSchema),
  macros: z.array(MacroSchema),
  players: z.array(ChatPlayerSchema),
  initiative: z.object({
    order: z.array(InitiativeEntrySchema),
    current: z.number().int(),
    round: z.number().int()
  }),
  layers: z.object({
    map: z.boolean(),
    grid: z.boolean(),
    tokens: z.boolean(),
    overlay: z.boolean(),
    fog: z.boolean()
  }),
  fogEnabled: z.boolean(),
  /** Manual fog-of-war (review §2 #7). Stored as "cx,cy" cell-id strings. */
  manualFog: z.array(z.string()).default([]),
  manualFogEnabled: z.boolean().default(false),
  /**
   * Optional uploaded battle-map image (§3 image-map support). Data-URL or
   * absolute URL. When absent, renderer draws the procedural stone texture.
   */
  mapImage: z.string().nullable().default(null)
});
export type Scene = z.infer<typeof SceneSchema>;
