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

---

## 6. Import preview, duplicates and source priority

- **Import preview.** Every in-app import (JSON / batch, Markdown paste, 5e.tools JSON, backup, D&D Beyond PDF, Free5e and repo sync) first shows "N new, M exact duplicates (will fold into X), K possible duplicates (review)". Nothing is written until you press Import. The Free5e auto-sync at startup skips the preview.
- **Batch JSON** is one object or an array mixing entities and characters. Each entry is accepted or rejected with a reason in the console log (unknown category, monster without `monsterMeta`, a character without abilities/classes/hp). Characters may be in the app's own shape or the simple shape (`abilities`, `classes[].name` + `hitDie: "d8"`, `equipment` / `features` / `spells` as entity ids from the same file or the compendium, `resourcePools`, `savingThrows`, `skills`).
- **Source priority** (Settings, default): Mine (homebrew / imported / custom) > SRD 2024 > SRD 2014 > Free5e.
- **Exact duplicates** share normalized name (lower-case, no diacritics, punctuation or spaces) + category + ruleset. The highest-priority copy is shown; the others are folded into it ("also in: ..."), and it takes any class list, description or image it lacks from them. Nothing is deleted.
- **Possible duplicates** (same category; same name without a possessive prefix like "Melf's" or a trailing "(note)", or name similarity >= 0.85; same spell level / CR when both have one) are imported as they are and flagged in the Duplicates tab of the Packs/Compendium dialog, where you choose Keep one, Keep both or Merge. Decisions are saved and can be undone.


---

## 7. Magic variants (+1 / +2 / +3)

- Weapons, armor and shields on a character sheet have a **Magic bonus** select (+0..+3) and a **Name** field in the item inspector. The bonus adds to attack and damage rolls (weapons) or to AC (armor, shields). The shown name is the custom name, else "+N <base name>". Both are optional fields on the sheet item (`magicBonus`, `customName`), so old saves load unchanged.
- Compendium entries named "+N X", "X +N" or "X, +N" (e.g. "+1 Longsword", "+1 Shield (+3 AC)") are **folded into their base item** when the base exists (same category and ruleset, name equal after dropping the bonus and a trailing "(note)"): they are hidden from search and Add Gear but not deleted. Entries with no base item, "X, +1, +2, or +3" umbrella entries and gear-type items (ammunition, wands) stay visible.
- The duplicate finder never flags "+N X" as a possible duplicate of "X" or of another "+M X".
- Old saves: a sheet item that is a folded variant is migrated when the character loads to the base item + `magicBonus` (same item id; equipped, attuned, quantity and container are kept). Variants without a base are left alone.
- For your own packs: ship the base item and let players set the bonus; add a separate "+N" entry only for items with extra effects (those are not folded unless a plain base of the same name exists).

---

## 8. Fixing entries you imported (or the built-in ones)

Imported and built-in entries can have mistakes. Instead of editing the source data, anyone can flag and fix an entry in the app; the fix is a separate, reviewable layer.

- **Report / fix** (button on compendium search rows and in the item inspector) opens an editor for the name, text, spell level, range, attack bonus, damage formula and type, save ability and DC, and CR / AC / HP for monsters. It is prefilled with the current values and a note ("what is wrong?") is required. Saving creates a **proposed** fix: only the changed fields are stored, next to a hash of the original entry.
- A proposed or rejected fix changes nothing. The **DM** approves, rejects, or edits-then-approves it in the **Fixes** tab of the Packs / Compendium dialog (before/after diff per field); players can propose but not approve. Approved fixes apply everywhere entries are read (search, Add to sheet, Level-Up picks, new character presets, Encounter Builder, monster picks) on top of duplicate folding, and the entry shows a "fixed" badge. Sheet items already added keep the values they had when added.
- **Revert to original** deletes the fix. Stored entries are never edited, so re-imports and Free5e resyncs do not remove fixes.
- If the original entry changes after a fix was made (a re-import with new text, a resync), the fix is shown as **Needs re-review** and is not applied until the DM looks at the diff and approves it again.
- **Export fixes / Import fixes** (Fixes tab) write and read a JSON file (`sidereroll-content-fixes`, each fix with the entry's name and source) so fixes can be shared, or later turned into a pull request on the source repo. Imported fixes always arrive as proposed and go through the same review. Backups include the fixes.
- At a Live Table, a player's proposed fix is also sent to the host's Fixes queue.
- Patch keys are `name`, `entries`, `range`, `spellLevel`, ..., `monsterMeta.<field>`, `activities.<activityId>.<field>`; `null` removes a field.

