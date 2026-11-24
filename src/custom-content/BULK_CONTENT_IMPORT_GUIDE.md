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

## 3. Converting External JSON with `content:convert`

If you have raw 5e JSON (arrays of spells, monsters, items, feats, or `{ spell: [...] }` / `{ monster: [...] }` bundles), use the built-in CLI converter:

```powershell
# Convert a raw spells pack into src/custom-content/spells/
bun run content:convert path/to/raw-spells.json --category spell --ruleset 2024 --source "PHB 2024"

# Convert a raw monsters pack into src/custom-content/monsters/
bun run content:convert path/to/raw-monsters.json --category monster --ruleset 2014 --source "MM"

# Convert weapons or gear into a custom output path
bun run content:convert path/to/raw-weapons.json --category weapon --out src/custom-content/items/weapons-pack.json
```

What `content:convert` does automatically:
- Generates deterministic unique `id`s (`custom-spl-...`, `custom-mob-...`, `custom-wpn-...`).
- Flattens nested `{ type: "entries" }`, `{ type: "list" }`, and `description` strings into clean `entries: string[]` while preserving `{@damage}`, `{@dice}`, `{@hit}`, `{@dc}`, `{@save}`, and `{@scaledamage}` tags so they render as clickable roll chips.
- Extracts spell metadata (`spellLevel`, `castingTime`, `range`, `components`, `duration`, `concentration`, `ritual`) and `monsterMeta` (`ac`, `hp`, `dexModifier`, `cr`, `size`, resistances/immunities/senses).
- Synthesizes rollable `activities[]` for spells and weapons so they immediately have **Attack / Cast / Save / Heal** buttons.

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
