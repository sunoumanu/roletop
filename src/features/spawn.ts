import { store } from '../state/store';
import { execute, cmdAddToken } from '../state/history';
import { GRID_SIZE } from '../engine/grid';
import type { Token } from '../state/schemas';
import { defaultSheet } from './sheet';
import { toast } from '../ui/toast';
import { addTokenToInitiative } from './initiative';

export interface TokenTemplate {
  name: string;
  type: Token['type'];
  color: string;
  hp: number;
  maxHp: number;
  initial: string;
  ownerId?: string;
  /**
   * Optional starter-pack asset URL. When set, the seeded token renders with
   * shipped SVG art instead of the procedural colored-letter circle. Paths
   * are root-relative to Vite's `public/` folder (served at `/`), so the
   * same URLs work in dev and production builds. Absent = fall through to
   * the letter-circle, matching tokens created before the starter pack
   * existed.
   */
  image?: string;
}

export const TOKEN_TEMPLATES: readonly TokenTemplate[] = [
  { name: 'Aldric',  type: 'pc',    color: '#2a6a9a', hp: 38, maxHp: 38, initial: 'A', ownerId: 'p1', image: '/assets/tokens/fighter.svg'  },
  { name: 'Mira',    type: 'pc',    color: '#8a5a2a', hp: 28, maxHp: 32, initial: 'M', ownerId: 'p2', image: '/assets/tokens/rogue.svg'    },
  { name: 'Vayne',   type: 'pc',    color: '#4a8a5a', hp: 24, maxHp: 24, initial: 'V', ownerId: 'p3', image: '/assets/tokens/ranger.svg'   },
  { name: 'Goblin',  type: 'enemy', color: '#5a3a1a', hp: 8,  maxHp: 10, initial: 'G',                image: '/assets/tokens/goblin.svg'   },
  { name: 'Skeleton',type: 'enemy', color: '#4a4040', hp: 14, maxHp: 20, initial: 'S',                image: '/assets/tokens/skeleton.svg' },
  { name: 'Innkeep', type: 'npc',   color: '#8a7a2a', hp: 12, maxHp: 12, initial: 'I',                image: '/assets/tokens/guard.svg'    }
];

function buildToken(tpl: TokenTemplate, gx: number, gy: number): Token {
  const s = store.getState();
  const sheet = defaultSheet(tpl.name);
  sheet.hp = tpl.hp;
  sheet.maxHp = tpl.maxHp;
  s.addSheet(sheet);
  return {
    id: s.nextTokenId,
    name: tpl.name,
    type: tpl.type,
    color: tpl.color,
    initial: tpl.initial,
    wx: gx * GRID_SIZE + GRID_SIZE / 2,
    wy: gy * GRID_SIZE + GRID_SIZE / 2,
    hp: tpl.hp,
    maxHp: tpl.maxHp,
    ownerId: tpl.ownerId ?? 'dm',
    sheetId: sheet.id,
    dead: false,
    ...(tpl.image ? { image: tpl.image } : {})
  };
}

export function spawnRandomToken(): void {
  const tpl = TOKEN_TEMPLATES[Math.floor(Math.random() * TOKEN_TEMPLATES.length)]!;
  const n = store.getState().tokens.length;
  const token = buildToken(tpl, (n % 10) + 2, Math.floor(n / 10) + 1);
  execute(cmdAddToken(token));
  // #19 — if combat is already underway, offer to roll the spawn into the
  // initiative order. A one-tap toast beats hunting through the context
  // menu when reinforcements arrive.
  const s = store.getState();
  if (s.initiative.order.length > 0) {
    toast(`${token.name} spawned — add to initiative?`, 'warn', () => {
      addTokenToInitiative(token.id);
    });
  }
}

export function seedDemoParty(): void {
  const positions: Array<[TokenTemplate, number, number]> = [
    [TOKEN_TEMPLATES[0]!, 4, 4],
    [TOKEN_TEMPLATES[1]!, 5, 5],
    [TOKEN_TEMPLATES[2]!, 3, 5],
    [TOKEN_TEMPLATES[3]!, 10, 4],
    [TOKEN_TEMPLATES[4]!, 11, 5],
    [TOKEN_TEMPLATES[5]!, 7, 8]
  ];
  for (const [tpl, gx, gy] of positions) {
    store.getState().addToken(buildToken(tpl, gx, gy));
  }
}
