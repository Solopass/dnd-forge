# Sidereroll — Local-First 5e Character Manager & VTT

Offline-first, zero-bloat D&D 5e (2014 SRD 5.1 & 2024 SRD 5.2) character sheet, rules engine, encounter manager, live table sync, and 2D tactical battlemap.

- **Live App (GitHub Pages):** https://solopass.github.io/dnd-forge/

## Quick Start

```bash
bun install
bun run content:validate
bun run test
bun run build
bun run dev
```

## Key Features
- **3 Workspace Modes:** Switch seamlessly between **Beyond Classic**, **Unified Command** (with interactive **Skill Wheel**), and **Modular Grid** (drag/resize widgets + **DM Master Screen**).
- **Full SRD 5.1 (2014) & SRD 5.2 (2024) Compendium (`3,154` custom-pack entities + built-in packs):** Pre-installed spells (`658`), monsters (`675`), equipment & magic items (`1,058`), and feats/features/traits (`763`), searchable via `Ctrl+K` or `+ Add Spell` / `+ Add Gear` with class + castable-level + CONC/RITUAL filters.
- **Right-Slot Inspector & Rich 5e Tags:** Click any spell, weapon, inventory item, or feature/feat to inspect full rules text, metadata, `imageUrl` art, clickable `{@damage}` / `{@dice}` / `{@dc}` roll chips, and rollable actions.
- **Character Manager & 3-Step Creator (`src/components/CharacterManagerModal.tsx`, `src/components/NewCharacterModal.tsx`):** Searchable roster with avatar/monogram cards, `.json` / `.md` export, D&D Beyond PDF import (auto-enriched against SRD packs), and a 3-step creator with Standard Array / Point Buy / `4d6kh3`, subclasses, senses, speeds, languages, and starting SRD spells/gear.
- **5-Pass Pure Rules Pipeline (`src/engine/rules-math.ts`):** Resolves ASI, proficiency, exclusive AC formulas, multiclass spell slots, Pact Magic (Short Rest) + upcasting + Ritual casting, Short Rest Hit Dice modal, 2014/2024 Exhaustion speed & d20 penalties, and optional house rules (Flanking Advantage/+2, Crunchy Crits, etc.).
- **Personal & Party Shared Inventory (`src/components/InventoryHub.tsx`):** Containers (`Carried`, `Backpack`, `Bag of Holding`, `Pouch`), quick coin `+`/`-` + `Simplify Coins`, and shared **Party Stash** with live table sync.
- **2D Tactical Battlemap & Live Table (`src/components/BattlemapModal.tsx`, `src/engine/live-sync.ts`):** 5ft-grid SVG battlemap with token quick-actions HUD (`HP +/-`, Conditions, Inspect), fog/terrain/AoE templates, token portrait art, and WebRTC / BroadcastChannel live sync (party vitals, token claims, target attacks/saves/heals/buffs, and party stash).

## Bulk Content Tool & Local GUI
- **CLI:** `bun run content:convert <file.(pdf|md|txt|csv|tsv|json)> --category <spell|monster|weapon|armor|gear|feat|feature|character> --ruleset <2014|2024>` and `bun run content:validate` (see `src/custom-content/BULK_CONTENT_IMPORT_GUIDE.md`).
- **Local GUI:** `bun run content:gui` (or launch `launch-content-gui.bat`) opens `http://127.0.0.1:4179` for drag-and-drop conversion, validation, and testing.
