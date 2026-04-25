# VTT — Phase 6

A Vite + TypeScript rewrite of the phase-5 single-file prototype, addressing items **#2–#9** of `vtt-review.md`:

| # | Review item                                   | Where it lives                                                 |
| - | --------------------------------------------- | -------------------------------------------------------------- |
| 2 | Escape user input in chat (fix XSS)           | `src/utils/escape.ts`, used by every renderer                  |
| 3 | Role concept (GM vs Player)                   | `src/state/store.ts` (`role`), `src/features/roles.ts`         |
| 4 | Character sheets                              | `src/features/sheet.ts`, `src/ui/sheetModal.ts`                |
| 5 | Conditions & status effect icons              | `src/engine/conditions.ts`, rendered in `src/render/renderer.ts` |
| 6 | AoE templates (sphere/cone/line/cube)         | `src/engine/aoe.ts`, `src/ui/toolbar.ts`, drawn in renderer    |
| 7 | Undo/redo + soft-delete                       | `src/state/history.ts`, commands throughout                    |
| 8 | Persist + export/import JSON                  | `src/state/persistence.ts` (+ localStorage autosave)           |
| 9 | Remove/replace fake WebRTC                    | `src/features/rtc.ts` — hidden by default, gated flag + DEMO tag |

Items **#1 (Vite+TS split)** and **#10 (PixiJS migration)** from the review summary are respectively *being done by this project itself* and *explicitly out of scope* for this phase (the canvas renderer stays for now, but is dirty-flagged).

## Commands

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc + vite build → dist/
npm run typecheck  # tsc --noEmit
npm run test       # vitest — dice engine unit tests
```

## Architecture

```
src/
  main.ts                bootstraps everything
  style.css              all styles (ported from phase-5, with a11y tweaks)
  utils/
    escape.ts            escapeHtml() — THE fix for the chat XSS
    events.ts            tiny event emitter
  state/
    schemas.ts           Zod schemas — Token, Scene, Sheet, Condition, AoE, ChatMsg
    store.ts             Zustand vanilla store — single source of truth
    history.ts           undo/redo command stack
    persistence.ts       localStorage autosave + export/import JSON
  engine/
    dice.ts              dice parser (pure, unit-tested)
    dice.test.ts         vitest tests — kh/kl/r</mi, crit/fumble, malformed input
    walls.ts             raycaster + visibility polygon
    camera.ts            pan/zoom math
    grid.ts              snap(), distance() — abstracted for hex later
    conditions.ts        D&D 5e condition catalog + helpers
    aoe.ts               template math for sphere/cone/line/cube
  render/
    renderer.ts          canvas renderer, dirty-flag gated
    assets.ts            procedural map + token sprite cache
  features/
    chat.ts              chat + whisper + roll log (XSS-safe)
    initiative.ts        initiative tracker — uses real DEX mod from sheet
    macros.ts            macro list + runner
    sheet.ts             character sheets linked to tokens
    roles.ts             GM vs Player view rules
    rtc.ts               RTC stub (disabled by default; flag-gated)
  ui/
    toolbar.ts
    sidebarLeft.ts
    sidebarRight.ts
    contextMenu.ts
    hotkeys.ts
    toast.ts
    hud.ts
    hotkeyOverlay.ts
    sheetModal.ts
```

## Notes on the review items

### #2 XSS fix
Every user-authored string passes through `escapeHtml()` before reaching `innerHTML`. Player messages containing `<img src=x onerror=...>` render as literal text. There is a `dice.test.ts` and `escape.test.ts` pair so the fix can't regress silently.

### #3 Roles
A top-of-app `role` selector switches between `'gm'` and `'player'`. In player mode: the walls tool, fog toggle, token-spawn button, and monster HP are hidden. A player can move tokens they own; the GM can move any.

### #4 Character sheets
Every token carries a `sheetId`. A sheet has AC, speed, ability scores, saves, proficiency bonus, skills, conditions, notes. Attack/save rolls pull modifiers from the linked sheet, replacing the hardcoded `1d20+5` from phase 5.

### #5 Conditions
15 SRD conditions from `conditions.ts`; applied via context menu or hotkey; rendered as small glyphs ringing the token; durations count down on initiative.next().

### #6 AoE templates
Four shapes: sphere, cone, line, cube. Click the template tool, click on the map, configure size in the side panel. Hovered tokens are visually highlighted as "affected."

### #7 Undo/redo
Every state mutation goes through a `Command` with `do()` / `undo()`. `Ctrl+Z` undoes, `Ctrl+Shift+Z` redoes. Token/wall deletion is soft — an "Undo" toast appears for 5 s.

### #8 Persistence
The store writes a debounced snapshot to `localStorage` on every mutation. The toolbar has **Export** (downloads `scene.json`) and **Import** (loads a file, validates via Zod, replaces state).

### #9 RTC
The RTC panel from phase 5 was cosmetic. It is now hidden behind `VITE_ENABLE_RTC_DEMO`, and when enabled is prominently labeled `DEMO — NOT A REAL CALL`. The production plan (Jitsi / LiveKit / PeerJS integration) lives in `features/rtc.ts` as a TODO block.
