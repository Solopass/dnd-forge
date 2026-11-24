# Custom Content Drop-In & AI Formatting Guide

Drop any `.json` file into the matching subfolder below and **D&D Forge** will automatically load it on startup (no TypeScript or code edits needed):

| What you are adding | Drop `.json` file into |
| :--- | :--- |
| **Monsters / NPCs / Bosses** | `src/custom-content/monsters/<slug>.json` |
| **Weapons, Armor, Shields, Magic Items, Gear** | `src/custom-content/items/<slug>.json` |
| **Spells** | `src/custom-content/spells/<slug>.json` |
| **Feats, Class Features, Backgrounds, Species** | `src/custom-content/features/<slug>.json` |
| **Full Player Characters** | `src/custom-content/characters/<slug>.json` |

Reference templates live in `src/custom-content/_templates/` (they are **not** auto-loaded into the app).

---

## Copy-Paste AI Prompt

Paste this prompt along with any raw D&D 5e stat block, item, spell, feat, or character sheet into any AI:

```text
Convert the following D&D 5e content into a single valid JSON object matching D&D Forge's schema.
Rules:
1. Output ONLY raw JSON (no markdown fences, no commentary).
2. Include a unique kebab-case "id" (e.g. "custom-mob-shadow-drake").
3. Set "ruleset" to "2014" or "2024".
4. Choose the exact schema for the entity type:

- MONSTER (save to src/custom-content/monsters/<slug>.json):
  {
    "id": "custom-mob-<slug>",
    "name": "Monster Name",
    "category": "monster",
    "source": "Homebrew",
    "ruleset": "2014",
    "monsterMeta": {
      "ac": 15,
      "hp": 65,
      "dexModifier": 2,
      "cr": "3",
      "size": "large",
      "speeds": "40 ft, Fly 60 ft",
      "saves": "DEX +4, CON +5",
      "skills": "Perception +5, Stealth +4",
      "resistances": ["fire"],
      "immunities": ["poison"],
      "vulnerabilities": [],
      "senses": "Darkvision 60 ft, Passive Perception 15",
      "legendaryActionsMax": 0
    },
    "activities": [
      {
        "id": "act-bite",
        "name": "Bite",
        "type": "attack",
        "actionEconomy": "action",
        "attackBonusFormula": "6",
        "damageFormula": "2d8+4",
        "damageType": "piercing"
      },
      {
        "id": "act-breath",
        "name": "Flame Breath (Recharge 5-6)",
        "type": "save",
        "actionEconomy": "action",
        "saveAbility": "dex",
        "saveDcFormula": "14",
        "damageFormula": "6d6",
        "damageType": "fire"
      }
    ],
    "entries": ["Multiattack: Makes two Bite attacks."]
  }

- ITEM / WEAPON / ARMOR (save to src/custom-content/items/<slug>.json):
  category must be one of: "weapon" | "armor" | "shield" | "gear"
  For weapons include activities[0] with type "attack", attackBonusFormula "@mod+@prof", attackAbility "str"|"dex", damageFormula "1d8+@mod", damageType "...". Optional "weaponMastery": "Cleave"|"Graze"|"Nick"|"Push"|"Sap"|"Slow"|"Topple"|"Vex".
  For armor include "acFormula": { "base": 14, "dexCap": 2 } (dexCap: null for light, 2 for medium, 0 for heavy).
  For shields or +AC items include "acFlatBonus": 2.

- SPELL (save to src/custom-content/spells/<slug>.json):
  {
    "id": "custom-spl-<slug>",
    "name": "Spell Name",
    "category": "spell",
    "source": "Homebrew",
    "ruleset": "2014",
    "spellLevel": 3,
    "school": "Evocation",
    "castingTime": "1 action",
    "range": "120 feet",
    "components": "V, S, M",
    "duration": "Instantaneous",
    "concentration": false,
    "ritual": false,
    "prepared": true,
    "activities": [
      {
        "id": "act-cast",
        "name": "Cast Spell Name",
        "type": "save",
        "actionEconomy": "action",
        "saveAbility": "dex",
        "saveDcFormula": "8+@prof+@spell",
        "damageFormula": "8d6",
        "damageType": "fire",
        "upcastDicePerLevel": "1d6",
        "resourceCost": { "poolId": "spell_slot_3", "amount": 1 }
      }
    ],
    "entries": ["Spell description text."]
  }

- FEAT / FEATURE (save to src/custom-content/features/<slug>.json):
  category: "feat" or "feature" (or "background" / "species").

- CHARACTER (save to src/custom-content/characters/<slug>.json):
  Follow src/custom-content/_templates/character.json.

Here is the content to convert:
<PASTE RAW STAT BLOCK / ITEM / SPELL / CHARACTER HERE>
```
