# UI audit — 2026-11-25 (v1.09)

Click-through of the app at 1440×900 (laptop) and 375×812 (phone), in all three layouts (Beyond Classic, Unified Command, Modular Grid) as DM and as Player, plus a code scan. No JavaScript errors were thrown during any of it (the only console errors are the dev server's live-reload socket, see U8).

Labels: **broken** = does the wrong thing · **missing** = not there or not wired · **confusing** = works but hard to use or understand.
Each item says how it was checked. Fix order for phase 5: broken first, then missing, then confusing.

## Content & import (also roadmap items 3–4)

- [x] **C1 broken — the built-in SRD library never loads.** *Fixed 2026-11-25: now 731 monsters / 1,097 spells in the compendium; regression test `custom-content-loader.test.ts`.* `src/engine/custom-content-loader.ts:20` guards every `import.meta.glob` with `typeof import.meta.glob === 'function'`. Vite only rewrites `import.meta.glob(...)` *calls*, so at runtime that check is false and every loader is `{}`. Result: the 334 + 2024 SRD monsters, the SRD spells, magic items, equipment and features in `src/custom-content/` are never added to the compendium (and custom characters/themes/layouts there don't load either). Checked: in the running app `loadCustomRepoEntities()` returned 0 entities while the 2014 monster JSON holds 334 and `normalizeCustomEntity` accepts them; the compendium database holds 56 monsters and 462 spells in total. The README's "675 monsters / 658 spells / 3,154 entities" is not true in the app today. The guard was probably added for the Bun CLI tools, which have no `import.meta.glob`.
- [x] **C2 broken — Free5e sync creates 23 fake spells named "A", "B", "C" … "U".** The Free5e Markdown parser turns the alphabetical index headings into spells. They show up in the compendium search, the Add Spell dialog and the Level-Up wizard's spell picks, and can be added to a sheet. Checked in the database: 23 spells with one-letter names, source "Free5e (Solopass/free5e)". *Fixed 2026-11-25: sync skips `_X.md` index pages, the parser rejects link-only pages, and startup deletes the old junk; tests in `free5e-index-pages.test.ts`.*
- [ ] **C3 confusing — duplicate entries across sources.** Cure Wounds appears twice (Free5e and SRD 5.1); Eldritch Blast twice in the Level-Up picks. Since the C1 fix this is bigger: the 56 built-in pack monsters (Goblin, Orc…) now also exist in the SRD JSON under different ids, so the Encounter Builder lists them twice. Search results need source-aware de-duplication or clear grouping.
- [ ] **C4 broken — Level-Up spell choices aren't filtered by class.** The Artificer level-up offers Eldritch Blast (a warlock spell) next to the junk C2 entries. Likely Free5e spells lack class lists and pass the filter. Checked: Level-Up wizard button list.
- [ ] **C5 broken — importing a character JSON fails silently.** `CharacterManagerModal.tsx:120-128`: a malformed file, or valid JSON without `name`/`classes`, is ignored with no message. Should report to the status console why it was rejected. Checked: code.
- [ ] **C6 missing — `campaign-pack.json` 404 on every load** from `Solopass/free5e`. Harmless; Jake will add the file. Until then the app could skip the request when the repo has no pack.
- [ ] **C7 not checked yet** — D&D Beyond PDF import, Paste Markdown, 5e.tools/Backup JSON import, GitHub "Sync Repo" / "Push Pack". These need sample files and a test repo; they belong to the roadmap's import phase.

## Navigation & layout

- [x] **N1 confusing — the header has ~20 buttons in two rows, with duplicates.** Campaign picker twice (header + DM Studio panel), "Battlemap" three times (Tactical Battlemap tab, toolbar, combat drawer), "Open Sheet" twice. The campaign bar (+ New Campaign / Export .md / Print Session Packet) repeats at the top of every DM Studio tab. **fixed: one-row header (brand, campaign picker, Party, Encounter Forge | role + view switcher | Packs, Live Table, Undo, Redo, More); Themes, Rules, Shortcuts, Settings and the player Battlemap moved into an accessible More menu; DM Hub/Battlemap header buttons dropped for the DM; the DM Studio campaign bar shows only on the Campaign Binder tab and has no picker. Checked at 1280 px in the browser pane (DM and Player/Modular both one row).**
- [x] **N2 confusing — in DM view the layout switcher disappears.** Beyond Classic / Unified Command / Modular Grid only show in Player view, so a DM can't change layout without switching to Player first. **fixed (product decision): layouts are player sheet layouts, the DM always uses DM Studio; Settings' layout switch is disabled in DM role with the note "Layouts apply to the Player view." Revisit if the DM should get layouts.**
- [x] **N3 confusing — Player View still shows DM encounter controls.** The right-hand combat panel in Player view keeps "+ New", "Dup" and "Battlemap" encounter controls; only monster HP is hidden ("Status: Healthy"). **fixed: the combat panel hides the encounter select, + New, Dup, Del, Start, + Party, Roll All Init, Reset and Next Turn in Player view (add creature, builder, timers and remove were already hidden). Players see the encounter name.**
- [x] **N4 confusing — the condition picker on the sheet shows "Blinded" by default.** It reads as if the character is blinded; it should say "Add condition…". **fixed: both sheet condition pickers start on "Add condition..." and Toggle is disabled until one is chosen.**
- [x] **N5 minor — the DM Studio side-nav icons have no accessible names** (screen readers and the accessibility tree see unnamed buttons, though the text is visible). **fixed: DM Studio and Unified rail buttons have aria-label and aria-current="page".**

- [x] **N6 broken — a DM can't change layout at all.** The DM role always renders `DmLayout` and ignores `uiMode`, `modularMode` and `unifiedView`, so Settings' UI-mode switch and the "Edit Blocks" button do nothing visible for a DM (found during the App.tsx split, 2026-11-25). Related to N2. **fixed together with N2: Edit Blocks hidden in DM role, layout switch disabled with a note.**
- [x] **N7 minor — dead "DM Studio • campaign" badge** in `TopBar.tsx`: it needs `isInDmStudio`, which can't be true in the player branch it sits in. **fixed: badge removed.**
- [x] **N8 broken — the Modular Grid mini-battlemap shows DM detail in Player view.** Its `BattlemapModal` isn't passed `playerView={effectivePlayerView}` like the other embedded maps; `sharedBattlemapProps`, the statblock modal and the toast suppression also read the raw `playerView`. **fixed: sharedBattlemapProps and the statblock modal use effectivePlayerView (the toast suppression never read playerView).**
- [x] **N9 cleanup — `onTriggerActivity` is wired three times and `onRollCheck` twice** across the layouts; move each into `components/app/panels.tsx` once. **fixed: triggerActivity and rollCheck are defined once in panels.tsx.**
- [ ] **N10 left over from phase 3:** (a) the app-level DM Hub modal (`dmHubOpen`) has no opener now that the header button is gone; (b) Edit Blocks stays in the header for Player x Modular Grid; (c) the Unified layout's "DM Studio" rail view is unreachable (DM always uses DmLayout); (d) the per-monster condition picker in the combat drawer still defaults to a real condition; (e) phone layout not touched.

## DM tools

All ten DM Studio tabs render without errors (Party & Sync, Campaign Binder, World Clock, Loot & Shops, DM Screen, Party XP & Milestones, Improv, World Map, Soundboard, Tactical Battlemap). Checked working: NPC and tavern generators, +1 Hr clock, treasure roller, Give to PC, Distribute All GP, XP award, DM Screen dice, soundboard play/stop.

- [ ] **D1 confusing — two money pools, unlabeled.** The Loot tab shows 404 GP, but "Buy (2g)" says "have 0 GP": the shop spends the *active character's* purse, the 404 GP is the party's. Label both and show the character's GP next to the shop.
- [ ] **D2 confusing — "Award Total XP (Split)" ignores the encounter total shown right above it.** The tab says "Current Encounter Total: 0 XP" and the button awarded 450 XP from a separate number field. Pre-fill the field from the encounter, or label it.
- [ ] **D3 check — "Quick Demo: Spawn 2× Goblin" goblins count 0 XP.** After the quick demo the XP tab said 0 XP; goblins added through the Encounter Builder counted correctly (2 × 50 = 100 XP). Probably the demo goblins have no CR.
- [ ] **D4 confusing — Encounter Builder rows jump after staging.** Staging a monster inserts the staged list above the table, so the next "+ Stage" click lands on a different monster.
- [x] **D5 tied to C1 — Encounter Builder offers 56 monsters** ("All Rules (56)"), because of C1. *Now 731.*

## Player sheet

Checked working: action filters (ALL/ATTACK/SAVE/HEAL/SUMMON/CONC), adding a spell from the compendium, casting it (1st-level slot 4/4 → 3/4, healing logged), HP buttons, undo.

- [ ] **P1 minor — the compendium search keeps the previous query** when reopened through "+ Add Spell", so typing appends to old text.
- [ ] **P2 dead code — `castRitualSpell`** in the store is never called by the UI; rituals go through `triggerActivity`. Remove it during cleanup.

## Live Table

- [ ] **L1 confusing — the default tab only works on one computer.** "Local Browser Room" uses BroadcastChannel (same browser, same device). Laptops at a table need "Remote WebRTC (No Server)", which requires copy-pasting invite codes both ways. Make WebRTC the default for this group and explain the steps; a one-click join needs a small server (see roadmap discussion).

## Width & phone

- [ ] **U1 broken (phone) — the HP / rest strip runs off the right edge** at 375 px, and the header takes about a third of the screen (five rows of buttons).
- [ ] **U2 confusing — 55 of 118 buttons are smaller than 32 px** at phone width; many are also small at laptop width.
- [ ] **U3 not checked yet** — 1024 px and 1280 px laptop widths (phase 6).

## Code structure (drives phases 2–4)

- ~~`src/App.tsx` is 1,989 lines mixing 3 layouts × DM/Player × views.~~ Split 2026-11-25: App.tsx is 43 lines; see `src/components/app/`.
- 748 inline `style={{…}}` objects across `App.tsx` and components; buttons and spacing differ panel to panel.
- Silent `catch { /* ignore */ }` blocks in 15 places; the ones around user actions (C5, `SettingsModal`, `ModularCanvas`) should report to the status console.

## Dev environment

- [ ] **U8 — live-reload WebSocket errors in the Claude browser pane.** The dev server binds `127.0.0.1`, the pane opens `localhost`. Fix: add `"url": "http://127.0.0.1:5198"` to `.claude/launch.json`.

## Not covered by this audit

Battlemap tools in depth (token drag, fog painting, AoE templates, scenes), Modular Grid widget drag/resize, Theme Studio editing, settings persistence across reloads, the Character Builder drawer, Short Rest modal, multi-laptop Live Table (needs two machines), and every importer under C7.
