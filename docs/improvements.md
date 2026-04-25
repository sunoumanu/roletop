# RoleTop VTT — Improvement Plan

Reference: [The Forge VTT](https://forge-vtt.com/) and Foundry VTT as the industry benchmark.
Dated: 2026-04-26

This document compares the current RoleTop implementation against a production-grade VTT and lists concrete improvements, grouped by area and priority.

---

## 1. Real-Time Multiplayer (Critical Gap)

**Current state:** Single-player only. No real-time sync between GM and players. Scene is shared manually via JSON export/import. RTC panel is a non-functional demo stub.

**Improvements:**
- **WebSocket state sync** — broadcast store mutations (token moves, HP changes, fog edits, chat) to all connected clients via a lightweight server. State diff events, not full snapshots.
- **Room codes / invite links** — GM generates a shareable URL; players join without creating accounts (inspired by Forge's User Manager zero-friction login).
- **Presence indicators** — show which players are online, who is currently moving a token, who is typing in chat.
- **Conflict resolution** — last-write-wins with optimistic UI for low-latency feel; server is the authority.
- **Server-side scene persistence** — store scene in a database, not only `localStorage`. Survives browser clears and allows sharing across devices.
- **Permission model** — players can only move their own tokens and view permitted sheets; GM can lock any object.

---

## 2. Dynamic Lighting & Shadows

**Current state:** Binary fog-of-war (visible/hidden). No light sources. No dim-light vs bright-light distinction. Manual rectangular fog brush only.

**Improvements:**
- **Light source tokens** — attach a light source to a token or place a standalone light (torch, lantern, magical light) with configurable bright radius and dim radius.
- **Shadow casting** — existing raycaster in `engine/walls.ts` already computes visibility polygons per-viewer; extend it to composite multiple light sources per frame.
- **Darkvision** — per-token darkvision radius that treats dim light as bright and darkness as dim, with desaturated tint.
- **Light color/intensity** — tinted lights (fire = warm orange, moonlight = cool blue) with adjustable intensity (0–1).
- **Darkness spell / magical darkness** — a zone that blocks all light including darkvision.
- **Freehand fog brush** — replace the rectangular-only fog tool with a freehand paint brush and eraser with configurable radius.
- **Soft fog edges** — feathered/gradient fog boundary instead of hard pixel cutoff.

---

## 3. Doors & Wall Types

**Current state:** Walls are simple opaque line segments with no interactivity. No door concept.

**Improvements:**
- **Door wall segments** — a wall can be marked as a door (open/closed/locked). Players can click to open unlocked doors; GM controls locked doors.
- **Secret doors** — visible to GM, hidden from players until revealed.
- **One-way walls** — blocks vision from one side only (arrow slits, one-way mirrors).
- **Terrain walls** — low walls that block movement but not vision (half-height).
- **Window walls** — transparent to vision, opaque to movement.
- **Door icons on map** — rendered door arc or double-bar symbol at the wall midpoint.
- **Wall snap to grid** — walls auto-snap endpoints to grid intersections for clean room layouts.

---

## 4. Scene & Map Management

**Current state:** Single-map scene. No multiple scenes per campaign. No scene browser. Scene switch requires full reload.

**Improvements:**
- **Campaign container** — a campaign holds multiple scenes (dungeon level 1, town square, tavern interior).
- **Scene browser panel** — thumbnail grid in the left sidebar; GM activates a scene, players are transported.
- **Scene thumbnails** — auto-generated thumbnail on save (already have `thumbnail.ts`, hook it to scene save).
- **Map layers** — separate GM-only annotation layer (notes, arrows, secret areas) that doesn't leak to players.
- **Linked portals** — a door or marker on one scene links to another scene; players click through.
- **Tile / sticker placement** — drop decorative tiles, furniture, props onto the map grid without affecting fog or walls (the schema already has `AoETemplate` groundwork; extend to tiles).
- **Map notes / pins** — clickable pins on the map with GM text or player-visible notes (Foundry's "Journal Entries on canvas").

---

## 5. Audio System

**Current state:** No audio. Asset library schema has an `audio` kind but there is no playback UI.

**Improvements:**
- **Ambient audio tracks** — GM plays a looping background track (tavern noise, dungeon drips) that streams to all players.
- **Sound effects** — one-shot sounds triggered by events (door creak, spell cast, dice roll).
- **Per-scene default audio** — a scene remembers its ambient playlist.
- **Volume controls** — master, music, SFX sliders in the sidebar; players can adjust locally.
- **Audio reactive to combat state** — auto-fade ambient when initiative starts, swap to combat music.
- **Playlist queue** — GM queues multiple tracks; auto-advance.

---

## 6. Character Sheets (Completeness)

**Current state:** Ability scores, AC, HP, saving throws, conditions, and notes are implemented. Skills, spells, equipment, and action economy are missing.

**Improvements:**
- **Skills** — 18 D&D 5e skills with proficiency/expertise toggles; passive scores auto-calculated.
- **Action economy** — track Action / Bonus Action / Reaction / Movement spent per turn; auto-reset on turn end in initiative.
- **Hit dice** — pool (e.g., 5d10), spend during short rest with roll, recover on long rest.
- **Spell slots** — per-level slots (1–9) with expend/recover buttons; expend on cast, recover on long rest.
- **Spell list** — prepared spells with damage dice, save DC, attack bonus; drag to cast and roll.
- **Inventory / equipment** — item list with weight, equipped toggle; equipped armor/shield contributes to AC automatically.
- **Features & traits** — free-text list of class features, racial traits, feats.
- **Background, alignment, languages** — flavor fields.
- **Inspiration** — toggle; clears after use.
- **Multiclass support** — multiple class entries each with their own hit die.

---

## 7. Dice & Automation

**Current state:** Dice parser is solid (kh/kl/r/mi). No automation. No damage types. No critical doubling.

**Improvements:**
- **Critical hit automation** — when a natural 20 is rolled on an attack, double the number of damage dice in the linked damage expression.
- **Damage types** — tag damage rolls with a type (fire, piercing, bludgeoning); resistances/immunities on sheets halve/negate.
- **Resistance / vulnerability** — per-token toggles (resistant to fire → halve fire damage).
- **Roll tables** — a named table with weighted entries; `/rt <name>` rolls it and posts the result to chat.
- **Query placeholders** — `?{Bonus|0}` in a macro pops a dialog asking for a value before rolling.
- **Grouped rolls** — `[[1d6]] + [[1d8]]` evaluates each separately and shows both results.
- **Inline roll results in chat** — render `[[2d6+3]]` expressions inside a chat message with the result shown inline.

---

## 8. Token Improvements

**Current state:** Tokens have name, color, HP, image, type, ownership. No rotation, no multi-select, no nameplates.

**Improvements:**
- **Nameplates** — floating label above each token showing name and HP bar; GM-configurable visibility (always / hover / none).
- **Token rotation** — right-drag or dedicated hotkey to rotate token artwork independently of facing.
- **Token size** — configurable size in grid cells (1×1, 2×2, 3×3 for Large/Huge/Gargantuan creatures).
- **Multi-select** — rubber-band select multiple tokens; move or apply actions as a group.
- **Copy / paste** — Ctrl+C / Ctrl+V to duplicate selected token(s) with new IDs.
- **Token status icons** — condition icons rendered as small overlays on the token sprite (instead of only in the sheet modal).
- **Elevation** — a numeric elevation value per token; displayed as a badge; affects AoE targeting for flying creatures.
- **Invisible state** — invisible tokens visible to GM as ghost outline; hidden from players entirely.

---

## 9. Initiative & Combat

**Current state:** Initiative order, round counter, delay, condition expiry. No reordering, no combatant-level notes.

**Improvements:**
- **Drag-to-reorder** — drag combatants in the tracker to handle ties or narrative changes.
- **Per-turn timer** — optional countdown clock per turn (e.g., 45 seconds); visual pulse when time runs low.
- **Ready action / hold turn** — mark a combatant as "readying"; they get a reaction window before their next turn.
- **Initiative modifier** — adjust an existing combatant's initiative value without re-rolling.
- **Announce turn change** — sound cue + toast with the combatant's name and portrait when turn advances.
- **Combatant notes** — per-combatant text field in the tracker (e.g., "concentrating, used reaction").
- **Rollable NPC initiative** — GM can place an NPC token without a full sheet and still roll initiative using a manual DEX modifier.

---

## 10. Compendium / Content Browser

**Current state:** No built-in content. GM manually creates every monster, item, spell.

**Improvements:**
- **Compendium browser** — searchable, filterable browser for monsters, spells, items, conditions from SRD or imported packs.
- **Drag-to-canvas from compendium** — drag a monster entry to the map to spawn a token pre-populated with its stat block.
- **Import SRD data** — bundle or lazy-load the D&D 5e SRD JSON (available under CC-BY-4.0) for 300+ monsters, 300+ spells.
- **Custom compendium entries** — GM creates homebrew monsters, items, spells and saves them to the local compendium.
- **Module system** — pluggable JSON modules install additional game systems or content packs (Pathfinder, OSE, etc.).

---

## 11. Asset Management (CDN & Marketplace)

**Current state:** Asset packs loaded via manifest URL; images stored as data URLs in localStorage. 4 MB map upload cap. No marketplace.

**Improvements:**
- **Cloud asset storage** — upload images to a server-side object store (S3/R2); serve via CDN to all players, eliminating the localStorage size bottleneck.
- **WebP auto-conversion** — convert uploaded maps and tokens to WebP on ingest for 50%+ size reduction (Forge's automatic optimization).
- **Deduplication** — hash-based de-dup prevents re-uploading the same file twice across scenes.
- **Quota display** — show used / total storage with a progress bar in the asset panel.
- **Asset tagging and folders** — organize assets into named folders; multi-select delete/move.
- **Bazaar-style marketplace** — curated list of free and paid asset packs installable in one click from a hosted manifest registry.
- **Audio asset playback** — wire the existing `audio` asset kind to a play button in the library and the ambient audio system (improvement #5).

---

## 12. Journal & Notes

**Current state:** No journal. Character sheets have a free-text notes field. No shared GM notes.

**Improvements:**
- **Journal entries** — rich-text pages (Markdown or simple WYSIWYG) organized in a tree; stored per campaign.
- **Player-share toggle** — GM can share a journal entry to specific players or all players; shared entries appear in a player-side "Notes" panel.
- **Secret text blocks** — paragraphs marked secret render as redacted to players until revealed.
- **Journal links** — `@Scene[Dungeon Level 2]`, `@Token[Goblin King]` hyperlinks inside journal text navigate to that resource.
- **Session log** — auto-generated log of combat events, dice rolls, and GM-shared notes for session recaps.

---

## 13. UI & Accessibility

**Current state:** Desktop-only layout. No theme support. No minimap. Hotkeys hardcoded.

**Improvements:**
- **Touch / mobile layout** — collapsible sidebars triggered by swipe; two-finger pinch-zoom on canvas; floating action button for common GM tools.
- **Dark / light theme toggle** — CSS custom-property skin; persist preference in localStorage.
- **Minimap overlay** — thumbnail of the full scene in a corner overlay; draggable viewport rect shows current view; click to navigate.
- **Customizable hotkeys UI** — settings panel to rebind keys; `settings.json` persists bindings.
- **Collapsible sidebar panels** — each sidebar section (tokens, initiative, chat) independently collapsible.
- **Ping tool** — GM and players can ping the map (click + hold) to draw all eyes to a point; animated ripple fades in ~2 seconds.
- **Ruler snap and bearing** — measure tool shows bearing (N/NE/E/…) and snaps to token center.
- **Fullscreen canvas mode** — hide all panels (F11 or hotkey); press again to restore.
- **High-contrast / accessibility mode** — increase UI contrast, use shape+color coding on tokens for color-blind players.

---

## 14. GM Workflow & Quality-of-Life

**Current state:** GM can draw walls, place tokens, manage initiative, chat. No encounter prep or session management tools.

**Improvements:**
- **Encounter builder** — pre-configure a group of NPCs (name, HP, initiative mod, token art); drop the encounter onto the canvas in one action.
- **Scene snapshots / save points** — named checkpoints of scene state the GM can restore without losing the full history (Forge's "automatic snapshots" feature).
- **Undo scope** — scope undo to the current GM session; players should not be able to Ctrl+Z a GM wall edit.
- **Traps / hidden objects** — invisible to players until triggered; GM places with a toggle, clicks to "spring" the trap.
- **Weather effects overlay** — animated snow, rain, or fog bank rendered as a canvas overlay layer; intensity slider.
- **Combat tracker export** — export initiative + HP summary as text/PDF for post-session review.
- **Token quick-reference tooltip** — hover a token to see HP, AC, conditions, and speed without opening the full sheet.

---

## 15. Macro & Scripting

**Current state:** Macros support `roll` (dice expression) and two action types (`initiative`, `shortrest`). No editing UI, no parameters.

**Improvements:**
- **Macro editor modal** — inline code editor (Monaco or `<textarea>` with monospace) to write and save macros.
- **Script macros** — a sandboxed JS API exposing `game.tokens`, `game.chat`, `game.roll()`, `game.applyDamage()` for automation without exposing raw store.
- **Macro parameters** — `?{Variable|default}` pops an input dialog at runtime.
- **Draggable macro hotbar** — drag macros to a horizontal hotbar at the bottom of the screen (Foundry-style); visible to players for their own macros.
- **Macro folders / categories** — organize macros into named groups.
- **Roll-table macros** — a macro type that references a roll table and posts the result.
- **Trigger macros** — auto-run a macro when a condition fires (e.g., on token death, play a sound and post a chat message).

---

## Priority Matrix

| # | Improvement | Impact | Effort | Priority |
|---|-------------|--------|--------|----------|
| 1 | Real-time multiplayer sync | Critical | High | P0 |
| 2 | Dynamic lighting & shadows | High | High | P1 |
| 3 | Doors & wall types | High | Medium | P1 |
| 7 | Dice automation (crits, resistance) | High | Low | P1 |
| 8 | Token nameplates & multi-select | High | Low | P1 |
| 5 | Audio system | Medium | Medium | P2 |
| 6 | Character sheet completeness | Medium | Medium | P2 |
| 9 | Initiative improvements | Medium | Low | P2 |
| 13 | UI / accessibility | Medium | Medium | P2 |
| 14 | GM workflow tools | Medium | Medium | P2 |
| 4 | Scene / map management | High | High | P2 |
| 10 | Compendium / content browser | High | High | P2 |
| 11 | Asset management (CDN) | Medium | High | P3 |
| 12 | Journal & notes | Medium | Medium | P3 |
| 15 | Macro scripting | Low | Medium | P3 |

---

## Notes on Architecture

- Improvements **1** (multiplayer) and **11** (cloud assets) require server infrastructure beyond the current static-file build. A minimal WebSocket relay + object-store backend is the natural next phase.
- Improvements **2** (lighting) and **3** (doors) are additive to the existing `engine/walls.ts` raycaster — highest ROI per line of engine code.
- Improvements **6** (sheets), **7** (dice), and **9** (initiative) are self-contained within the existing architecture and can be shipped incrementally without touching multiplayer.
- Improvement **4** (scenes) requires a store schema change (`Campaign` containing `Scene[]`); design the migration path before starting.
