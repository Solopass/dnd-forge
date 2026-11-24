# D&D Forge — Local-First 5e Character Manager & VTT

Offline-first, zero-bloat D&D 5e (2014 SRD 5.1 & 2024 SRD 5.2) character sheet, rules engine, encounter manager, and 2D tactical battlemap.

- **Live Demo (GitHub Pages):** https://solopass.github.io/dnd-forge/

## Quick Start

```bash
bun install
bun run test
bun run build
bun run dev
```

## Key Features
- **All 14 Classes & Starter Wizard (`src/engine/classes.ts`):** Pre-configured presets for Artificer, Barbarian, Bard, Blood Hunter, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, and Wizard with subclass presets, Unarmored Defense, hit dice, and scaled class resource pools.
- **5-Pass Pure Rules Pipeline (`src/engine/rules-math.ts`):** Resolves ASI, proficiency, exclusive AC formulas, multiclass spell slots, Pact Magic + upcast fallback, `@spell` / `@cantrip` / `@lvl` variables, 2024 exhaustion penalties, and manual overrides.
- **SRD 5.1 & 5.2 Base Content (`src/engine/srd-packs.ts`):** Cantrips through 9th-level spells, core weapons/armor/shields, class features/feats, 2024 Weapon Mastery gear, and encounter monsters—plus D&D Beyond PDF, Markdown, and 5e.tools JSON import.
- **Complete Player Sheet & Homebrew Creator (`src/components/EquipmentSpellDrawer.tsx`):** Item quantities & carrying weight, `CP/SP/EP/GP/PP` purse, persistent bio/campaign notes, and a form-based homebrew item/spell creator.
- **Multi-Encounter Manager & 2D Battlemap (`src/components/SummonCombatDrawer.tsx`, `src/components/BattlemapModal.tsx`):** Multiple saved encounters, `+ Party` roster import, 5e encounter XP difficulty calculator, linked summons & concentration checks, and an interactive 5ft-grid SVG battlemap with custom map upload, measurement ruler, and AoE templates.
- **Persistent Dexie IndexedDB & Theme/Print (`src/storage/db.ts`, `src/components/SettingsModal.tsx`):** Automatic offline persistence with `.json` backup export/import, System/Light/Dark + High-Contrast themes, and print-ready character sheet styles.
