# D&D Forge — Local-First 5e Character Manager & VTT

Offline-first, zero-bloat D&D 5e (2014 SRD 5.1 & 2024 SRD 5.2) character sheet, rules engine, homebrew/monster parser, and encounter/summon tracker.

## Quick Start

```bash
npm install
npm test
npm run build
npm run dev
```

## Key Features
- **5-Pass Pure Rules Pipeline (`src/engine/rules-math.ts`):** Resolves ASI, proficiency, exclusive AC formulas, multiclass spell slots, Pact Magic, and manual overrides (`OverridableStat<T>`).
- **Interactive 5e.tools Tag & Formula Resolution (`src/engine/tags.ts`):** Inline `{@damage 1d8+@int}` and `{@dice ...}` tags dynamically resolve character variables and render as 1-click roll buttons.
- **Persistent Dexie IndexedDB (`src/storage/db.ts`):** Saves characters, compendium entities, and active encounters automatically with `.json` full-bundle export/import.
- **Monster & Summon Combat Drawer (`src/components/SummonCombatDrawer.tsx`):** Auto-links summons to owner initiative, cleans up on concentration drop, tracks combatant conditions/temp HP/initiative edits, and exposes 1-click monster/summon attack buttons.
