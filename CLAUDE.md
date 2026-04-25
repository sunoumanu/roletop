# CLAUDE.md

Guidance for Claude (and humans) working in this repo. Keep it short, keep it accurate, update it when conventions change.

## Project

**roletop** — a browser-based D&D-style Virtual Tabletop. Canvas board, tokens, walls, fog of war, vision, initiative, chat, macros, character sheets, AoE templates, asset library.

## Stack

| Layer        | Choice                                  | Notes |
| ------------ | --------------------------------------- | ----- |
| Build / dev  | Vite 5                                  | `vite.config.ts` — port 5173, ES2022, sourcemaps on |
| Language     | TypeScript 5.5, `strict: true`          | `moduleResolution: bundler`, `noImplicitAny`, `noImplicitReturns`, `noFallthroughCasesInSwitch` |
| State        | Zustand (vanilla store, not React)      | `src/state/store.ts` is the single source of truth |
| Validation   | Zod 3                                   | `src/state/schemas.ts` — every persisted/imported shape is parsed before use |
| Tests        | Vitest 2                                | Co-located `*.test.ts` next to the unit under test |
| UI           | Plain DOM + tagged-template HTML        | No React. `html`` ` and `htmlRaw`` ` from `src/utils/escape.ts` auto-escape interpolations |
| Rendering    | HTML5 Canvas 2D (dirty-flagged)         | `src/render/renderer.ts`. Pixi migration is explicitly out of scope this phase |
| Fonts        | Google Fonts: Cinzel, Crimson Pro, JetBrains Mono | Loaded from `index.html` |
| Lint/format  | (none configured)                       | Use TS strictness as the bar; match surrounding style |

No React, no Tailwind, no CSS-in-JS. Styles live in `src/style.css`. If you reach for a new dependency, justify it — the project deliberately runs lean.

## Commands

Run from `vtt-phase6/`:

```bash
npm install
npm run dev         # http://localhost:5173 — hot reload
npm run build       # tsc -b && vite build → dist/
npm run typecheck   # tsc --noEmit  (fast, no emit)
npm run test        # vitest run
```

`npm run typecheck` is the cheapest signal that an edit didn't break the world. Run it after any non-trivial change.

## Directory map (`vtt-phase6/src/`)

```
main.ts                 boot order: scaffold → overlays → panels → login → hydrate → renderer → hotkeys → autosave
style.css               all styles
utils/
  escape.ts             escapeHtml(), html``, htmlRaw`` — THE XSS shield
  events.ts             tiny event emitter
  color.ts              color helpers
state/
  schemas.ts            Zod: Token, Scene, Sheet, Condition, AoE, ChatMsg, Wall…
  store.ts              Zustand vanilla store + command methods
  history.ts            undo/redo command stack (MAX_HISTORY = 100)
  persistence.ts        localStorage autosave + export/import JSON (Zod-validated)
engine/                 pure logic, framework-free, easy to unit-test
  dice.ts               dice parser (kh/kl/r</mi, crit/fumble) + tests
  walls.ts              raycaster + visibility polygon + tests
  visibility.ts         visibility per token + worker variant
  visibility.worker.ts
  camera.ts             pan/zoom math
  grid.ts               snap(), distanceFt(), MAP_W/MAP_H
  conditions.ts         15 SRD conditions
  aoe.ts                sphere/cone/line/cube template math
render/
  renderer.ts           dirty-flagged canvas renderer
  assets.ts             procedural map + token sprite cache
features/
  auth.ts               BroadcastChannel single-GM enforcement + sessionStorage identity
  chat.ts               chat + whisper + roll log (XSS-safe)
  initiative.ts         tracker, uses real DEX mod from sheet
  macros.ts             macro list + runner; DEFAULT_MACROS seed
  sheet.ts              character sheets linked to tokens
  roles.ts              GM vs Player view rules (isGM, canEditWalls, …)
  rtc.ts                stub, hidden behind VITE_ENABLE_RTC_DEMO
  spawn.ts              seedDemoParty()
  assetManifest.ts      shared asset pack registry
  assetUpload.ts        upload pipeline
  thumbnail.ts          thumbnail generation
ui/
  toolbar.ts            left vertical 38px tool rail
  sidebarLeft.ts        scene/tokens/layers
  sidebarRight.ts       chat/macros/assets (tabbed)
  sbIconRail.ts         right vertical icon strip (tabs into sidebarRight)
  sceneNav.ts           bottom-left scene pill
  playersList.ts        bottom-right roster
  loginScreen.ts        awaitLogin() — blocks boot until identity chosen
  sheetModal.ts         character-sheet dialog
  contextMenu.ts        right-click menu
  hotkeys.ts            global keyboard handlers
  hotkeyOverlay.ts      "?" cheat sheet
  inputHandlers.ts      pointer/wheel on the canvas
  rollPopup.ts          dice roll popover
  hud.ts                top-right HUD
  toast.ts              toast notifications + Undo affordance
  assetLibrary.ts       library tab + DataTransfer payloads
  welcome.ts            first-run flow
  focusTrap.ts          modal a11y helper
```

Layout note: Foundry-style 5-column grid `tool-rail | sidebar-left | board | sidebar-right | icon-rail`. No top toolbar. Bottom-left scene-nav and bottom-right players-list overlay the canvas.

## Conventions to follow

**XSS safety is non-negotiable.** Every user-authored string going into `innerHTML` MUST pass through `escapeHtml()` or one of the `html`/`htmlRaw` tagged templates from `src/utils/escape.ts`. Phase 5's chat shipped with `${m.body}` interpolation — we are not doing that again. If you write `innerHTML = ` with a raw template literal containing user data, that's a regression.

**Trust boundaries are Zod boundaries.** Anything crossing a trust boundary — `localStorage`, imported scene JSON, future network messages — must be parsed via the relevant schema in `state/schemas.ts`. Don't `JSON.parse` and cast.

**State changes go through the store.** Subsystems read from `store.getState()` and subscribe to slices. They do not reach into each other and do not mutate sibling subsystems' state directly. Anything user-undoable goes through `history.execute(cmd)` with `do()`/`undo()`. Transient UI state (camera, dragging, currentTool, dirty flag) does not need a command.

**Respect role gating.** Any GM-only affordance must check `roles.ts` helpers (`isGM`, `canEditWalls`, etc.). Don't hardcode role checks; extend `roles.ts` if a new gate is needed. Player view must not leak GM data (monster HP, hidden tokens, fog state under fog).

**Pure engine, side-effect UI.** Code in `src/engine/` should be pure and unit-testable — no DOM, no store import. UI code in `src/ui/` owns DOM and store subscriptions. Don't blur the line.

**Dirty-flag the renderer.** State mutations that change what's drawn should call `store.getState().markDirty()`. The render loop is gated on this — never call `requestAnimationFrame` directly to force a paint.

**Co-locate tests.** A `foo.ts` gets a `foo.test.ts` next to it. Engine modules and pure helpers are the prime test targets — UI tests in this repo focus on payload helpers (e.g. `assetLibrary.test.ts`), not full DOM interactions.

**Comments earn their keep.** When a non-obvious decision is encoded (a workaround, an ordering constraint, a deliberate-looking-redundant call like the `fogEnabled` re-apply in `main.ts`), leave a comment explaining why. The codebase already does this — match the style.

## Verification — sandbox caveat

The user develops on macOS (arm64 Darwin). `node_modules` is installed there. **The Linux sandbox available to Claude cannot run vitest** — `@rollup/rollup-linux-arm64-gnu` is missing and the npm registry is blocked, so `npm test` fails with "Cannot find module …". `node_modules` is also read-only here.

What works in the sandbox:

- `cd vtt-phase6 && npx tsc --noEmit` — typecheck. Use this as the default verification step.
- Reading the diff carefully and reasoning about pure functions.

What needs the user's Mac:

- `npm test` — the user runs it themselves.
- `npm run build` — Vite needs the same Rollup native binding.
- Anything that touches a real DOM / canvas.

When making non-trivial changes, the expected verification rhythm is: edit → `npx tsc --noEmit` → describe-the-diff → ask the user to run `npm test` if test coverage is relevant.

## Boot order (don't reorder casually)

`main.ts` sequences:

1. Build DOM scaffold.
2. Install overlays that anything else might call into (`toast`, `rollPopup`, `contextMenu`, `sheetModal`, `hotkeyOverlay`).
3. Render panels (toolbar, sidebars, scene nav, players list, HUD).
4. Seed players + default macros.
5. **`await awaitLogin(document.body)`** — blocks until the user picks an identity. The login overlay masks the canvas so input can't leak through.
6. `hydrateOrSeed()` — load saved scene from localStorage or seed the demo party + walls.
7. Re-apply player vision-on if hydration stomped it (saved scenes carry the GM's `fogEnabled`).
8. Start renderer + input handlers.
9. Recenter camera on the player's owned token, if any.
10. `installHotkeys()`, `initAutosave()`, `installWelcomeFlow()`, fire-and-forget `loadDefaultPack()`.

Auth (`features/auth.ts`) enforces single-GM uniqueness across tabs via `BroadcastChannel('roletop-vtt-auth-v1')` with `gm-claim`/`gm-here`/`gm-released` and a 3 s heartbeat. SessionStorage key `roletop.auth.v1` keeps the tab's identity sticky. Sign-out is the bottom button on the tool rail and reloads the page.

## Things to avoid

- New dependencies without a clear reason.
- React, Tailwind, or any other framework that competes with the existing UI layer.
- Inline event handlers (`onclick="..."` in HTML strings) — wire up listeners after `innerHTML` assignment. 
- Reaching into another subsystem's DOM by string ID. Cross-subsystem communication goes through the store or a small event emitter.
- Persisting transient UI state (camera, current tool, dragging). Keep `Scene` clean.

## When in doubt

Read `vtt-review.md` for the original motivation behind a structural choice. Read `README.md` for the per-review-item map of what lives where. If a planned change doesn't fit cleanly into either the engine/render/state/ui split or the role gating, ask before sprawling.