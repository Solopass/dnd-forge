# Bulk D&D 5e Content Import Guide (Sidereroll)

This guide explains how to bring large packs of D&D 5e spells, items, monsters, feats, features, and pictures into **Sidereroll** so everything automatically connects to the **Compendium (`Ctrl+K`)**, **Right-Slot Inspector**, **Encounter Builder**, **Battlemap Tokens**, and **Ruleset Filters (`2014` / `2024`)**.

---

## 1. Folder Structure

Drop `.json` files (either a **single object** or an **array of objects**) into:

| Content Type | Drop `.json` files here |
| :--- | :--- |
| **Spells** | `src/custom-content/spells/*.json` |
| **Weapons, Armor, Shields, Magic Items, Gear** | `src/custom-content/items/*.json` |
| **Monsters / NPCs** | `src/custom-content/monsters/*.json` |
| **Feats, Class Features, Traits, Infusions** | `src/custom-content/features/*.json` |
| **Pre-built Characters** | `src/custom-content/characters/*.json` |
| **Pictures / Token Art** | `public/images/{monsters,items,spells,portraits}/...` |

> **Tip:** Split large datasets into medium-sized packs (e.g. `spells-2024-level-0-3.json`, `monsters-cr-0-4.json`) rather than one giant file. Vite automatically bundles all `.json` files in those folders.

---

## 2. Linking Pictures (`imageUrl`)

Any spell, item, feat, or monster can include an optional `imageUrl` field:

```json
{
  "id": "custom-mob-owlbear-alpha",
  "name": "Owlbear Alpha",
  "category": "monster",
  "imageUrl": "./images/monsters/owlbear-alpha.webp"
}
```

- **Recommended local path**: Put images in `public/images/...` and reference them as `./images/...`. Relative `./` paths work both on `localhost` and on GitHub Pages (`base: './'`).
- **External URLs**: `https://...` URLs and `data:image/...` URIs also work.
- **Where pictures appear automatically**:
  - **Right-Slot Inspector**: shown at the top of the Inspector panel when you click an item, spell, or feature.
  - **Monster Statblock Modal**: shown next to the monster's header.
  - **Battlemap Tokens**: monsters with `imageUrl` automatically spawn with their token art on the Battlemap.

---

## 3. Converting External Files (PDF, Markdown, TXT, CSV, JSON) with `content:convert`

`bun run content:convert` supports **`.pdf`**, **`.md` / `.txt`**, **`.csv` / `.tsv`**, and **`.json`**:

```powershell
# 1. Extract a D&D Beyond character sheet PDF -> src/custom-content/characters/
bun run content:convert path/to/hero-sheet.pdf

# 2. Extract monsters, spells, items, or feats from a rulebook/homebrew PDF
bun run content:convert path/to/monster-book.pdf --category monster --ruleset 2024 --source "Homebrew" --dump-text

# 3. Convert a multi-entry Markdown or TXT file (split by --- or # Headings)
bun run content:convert path/to/spells.md --category spell --ruleset 2024 --source "PHB 2024"

# 4. Convert a CSV/TSV spreadsheet of gear, weapons, or spells
bun run content:convert path/to/items.csv --category gear --out src/custom-content/items/gear-pack.json

# 5. Convert raw 5e JSON arrays or { spell / monster / item / feat } bundles
bun run content:convert path/to/raw-spells.json --category spell --ruleset 2024 --source "PHB 2024"
```

What `content:convert` does automatically:
- **PDFs**: reads AcroForm character fields (for character sheet PDFs) OR extracts formatted page text (`--dump-text` saves the raw `.extracted.md` alongside the JSON if you want to inspect/clean up multi-column layouts).
- **Markdown / TXT**: splits multi-entry files on `---` or `# ` / `## ` headings and parses statblocks, AC/HP/CR, spell levels, dice, and save DCs.
- **JSON / CSV / TSV**: generates deterministic unique `id`s (`custom-spl-...`, `custom-mob-...`, `custom-wpn-...`), flattens nested `{ type: "entries" }` / `{ type: "list" }` / `description` blocks into `entries: string[]`, preserves `{@damage}` / `{@dc}` / `{@scaledamage}` tags, and synthesizes rollable `activities[]`.

---

## 4. Validating Everything Before Committing (`content:validate`)

Run the validator after adding or editing any `.json` files:

```powershell
bun run content:validate
```

It checks:
- Valid JSON syntax in every `src/custom-content/**/*.json` file
- Zero duplicate `id`s across all built-in SRD packs and all custom files
- Required fields (`name`, `category`, `monsterMeta` on monsters)
- Missing local `./images/...` files in `public/`
- Missing `activities[]` on spells/weapons (warnings)

Then run the full test suite and production build before pushing:

```powershell
bun run test
bun run build
```

---

## 5. Adding Missing Classes & Subclasses

Classes, Hit Dice, Spellcasting Progression, and Subclass level-up auto-grants live in `src/engine/classes.ts` (`CLASS_DEFINITIONS`).
1. Put the individual subclass feature/spell JSONs in `src/custom-content/features/` and `src/custom-content/spells/`.
2. Add the subclass entry to `subclasses` in `src/engine/classes.ts` with its `grants` referencing those feature/spell IDs.
