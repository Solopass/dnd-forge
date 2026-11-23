import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ClassLevel, RawCharacterState } from '../types/character';
import { AbilityKey, SkillKey } from '../types/core';
import { CompendiumEntity } from '../types/compendium';
import { createBlankCharacter, syncSpellSlotPools } from './rules-math';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfImportSummary {
  character: RawCharacterState;
  extractedFieldsCount: number;
  warnings: string[];
}

const PDF_SKILL_MAP: Array<{ pattern: RegExp; key: SkillKey }> = [
  { pattern: /^acrobatics$/i, key: 'acrobatics' },
  { pattern: /^animal\s*handling$/i, key: 'animal_handling' },
  { pattern: /^arcana$/i, key: 'arcana' },
  { pattern: /^athletics$/i, key: 'athletics' },
  { pattern: /^deception$/i, key: 'deception' },
  { pattern: /^history$/i, key: 'history' },
  { pattern: /^insight$/i, key: 'insight' },
  { pattern: /^intimidation$/i, key: 'intimidation' },
  { pattern: /^investigation$/i, key: 'investigation' },
  { pattern: /^medicine$/i, key: 'medicine' },
  { pattern: /^nature$/i, key: 'nature' },
  { pattern: /^perception$/i, key: 'perception' },
  { pattern: /^performance$/i, key: 'performance' },
  { pattern: /^persuasion$/i, key: 'persuasion' },
  { pattern: /^religion$/i, key: 'religion' },
  { pattern: /^sleight\s*of\s*hand$/i, key: 'sleight_of_hand' },
  { pattern: /^stealth$/i, key: 'stealth' },
  { pattern: /^survival$/i, key: 'survival' },
];

function parseClassString(rawClassLevel: string): ClassLevel[] {
  const parts = rawClassLevel.split('/').map((p) => p.trim()).filter(Boolean);
  const classes: ClassLevel[] = [];

  for (const part of parts) {
    const match = part.match(/^([A-Za-z\s]+?)\s+(\d+)$/);
    if (!match || !match[1] || !match[2]) continue;
    const className = match[1].trim();
    const level = Math.max(1, Number.parseInt(match[2], 10) || 1);
    const lower = className.toLowerCase();

    const casterProgression: ClassLevel['casterProgression'] =
      lower === 'artificer'
        ? 'half_up'
        : ['bard', 'cleric', 'druid', 'sorcerer', 'wizard'].includes(lower)
        ? 'full'
        : ['paladin', 'ranger'].includes(lower)
        ? 'half'
        : ['warlock', 'blood hunter'].includes(lower)
        ? 'pact'
        : 'none';

    const hitDie: 6 | 8 | 10 | 12 =
      lower === 'barbarian'
        ? 12
        : ['fighter', 'paladin', 'ranger', 'blood hunter'].includes(lower)
        ? 10
        : ['sorcerer', 'wizard'].includes(lower)
        ? 6
        : 8;

    classes.push({ className, level, hitDie, casterProgression });
  }

  return classes.length > 0
    ? classes
    : [{ className: 'Adventurer', level: 1, hitDie: 8, casterProgression: 'none' }];
}

/**
 * Pure map-based converter from extracted PDF AcroForm key/value pairs into RawCharacterState.
 * Testable in Node/Vitest without needing a browser Canvas/DOM.
 */
export function buildCharacterFromDdbFields(
  fields: Record<string, string>,
  fallbackName = 'Imported D&D Beyond Hero'
): PdfImportSummary {
  const warnings: string[] = [];
  const char = createBlankCharacter(`ddb-${Date.now().toString(36)}`, fallbackName);
  char.bonusAbilities = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  char.saveProficiencies = [];
  (Object.keys(char.skillProficiencies) as SkillKey[]).forEach((k) => {
    char.skillProficiencies[k] = 0;
  });

  const getField = (...candidates: string[]): string => {
    for (const c of candidates) {
      const exact = fields[c];
      if (exact && exact.trim()) return exact.trim();
      const foundKey = Object.keys(fields).find((k) => k.toLowerCase() === c.toLowerCase());
      if (foundKey && fields[foundKey]?.trim()) return fields[foundKey]!.trim();
    }
    return '';
  };

  const charName = getField('CharacterName', 'CharacterName 2', 'Name');
  if (charName) char.name = charName;

  const species = getField('Race ', 'Race', 'Species');
  if (species) char.species = species;

  const bg = getField('Background');
  if (bg) char.background = bg;

  const classLevelRaw = getField('ClassLevel', 'CLASS  LEVEL', 'Class & Level');
  if (classLevelRaw) {
    char.classes = parseClassString(classLevelRaw);
  } else {
    warnings.push('Could not locate Class & Level field in PDF; defaulted to Level 1.');
  }

  const abilityKeys: Array<{ key: AbilityKey; names: string[] }> = [
    { key: 'str', names: ['STR', 'STRscore', 'Strength'] },
    { key: 'dex', names: ['DEX', 'DEXscore', 'Dexterity'] },
    { key: 'con', names: ['CON', 'CONscore', 'Constitution'] },
    { key: 'int', names: ['INT', 'INTscore', 'Intelligence'] },
    { key: 'wis', names: ['WIS', 'WISscore', 'Wisdom'] },
    { key: 'cha', names: ['CHA', 'CHAscore', 'Charisma'] },
  ];

  for (const { key, names } of abilityKeys) {
    const rawVal = getField(...names);
    const parsed = Number.parseInt(rawVal, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 30) {
      char.baseAbilities[key] = parsed;
    }
  }

  const maxHp = Number.parseInt(getField('MaxHP', 'HPMax'), 10);
  const curHp = Number.parseInt(getField('CurrentHP', 'HPCurrent'), 10);
  const tempHp = Number.parseInt(getField('TempHP', 'HPTemp'), 10);
  if (!Number.isNaN(maxHp) && maxHp > 0) {
    char.hp.max = maxHp;
    char.hp.current = !Number.isNaN(curHp) ? Math.min(maxHp, Math.max(0, curHp)) : maxHp;
  }
  if (!Number.isNaN(tempHp) && tempHp > 0) {
    char.hp.temp = tempHp;
  }

  const acVal = Number.parseInt(getField('AC'), 10);
  if (!Number.isNaN(acVal) && acVal > 0) {
    char.overrides.ac = acVal;
  }

  // Extract Save & Skill Proficiencies from D&D Beyond checkbox fields
  for (const [k, v] of Object.entries(fields)) {
    const isChecked = v === 'Yes' || v === 'On' || v === 'true' || v === 'P' || v === 'E';
    if (!isChecked) continue;

    if (/save.*prof|st\s*prof/i.test(k)) {
      if (/str/i.test(k)) char.saveProficiencies.push('str');
      if (/dex/i.test(k)) char.saveProficiencies.push('dex');
      if (/con/i.test(k)) char.saveProficiencies.push('con');
      if (/int/i.test(k)) char.saveProficiencies.push('int');
      if (/wis/i.test(k)) char.saveProficiencies.push('wis');
      if (/cha/i.test(k)) char.saveProficiencies.push('cha');
    }

    const cleanedSkillName = k.replace(/prof|check|box|skill/gi, '').trim();
    for (const { pattern, key } of PDF_SKILL_MAP) {
      if (pattern.test(cleanedSkillName)) {
        char.skillProficiencies[key] = v === 'E' ? 2 : 1;
      }
    }
  }

  // Extract Weapons / Attacks (Wpn Name, Wpn1 AtkBonus, Wpn1 Damage)
  const importedItems: CompendiumEntity[] = [];
  for (let i = 1; i <= 5; i++) {
    const wpnName = getField(`Wpn Name ${i === 1 ? '' : i}`.trim(), `Wpn${i} Name`);
    if (!wpnName) continue;
    const atkBonus = getField(`Wpn${i} AtkBonus`, `Wpn${i} AtkBonus `);
    const dmgRaw = getField(`Wpn${i} Damage`, `Wpn${i} Damage `);
    const dmgParts = dmgRaw.split(/\s+/);

    importedItems.push({
      id: `ddb-wpn-${i}-${Date.now().toString(36)}`,
      name: wpnName,
      source: 'D&D Beyond PDF',
      ruleset: '2014',
      category: 'weapon',
      equipped: true,
      activities: [
        {
          id: `ddb-act-wpn-${i}`,
          name: wpnName,
          type: 'attack',
          actionEconomy: 'action',
          attackBonusFormula: atkBonus || '@str + @prof',
          damageFormula: dmgParts[0] || '1d8',
          damageType: dmgParts[1]?.toLowerCase() || 'slashing',
          description: `Imported from D&D Beyond PDF (${atkBonus || 'attack'}, ${dmgRaw || 'damage'}).`,
        },
      ],
      entries: [`Imported weapon: ${wpnName}`],
    });
  }

  // Extract Spells (Spells 1014..1099 in D&D Beyond PDF exports)
  for (const [k, v] of Object.entries(fields)) {
    if (/^Spells\s+\d+$/i.test(k) && v.trim().length > 1) {
      const spellName = v.trim();
      importedItems.push({
        id: `ddb-spell-${spellName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
        name: spellName,
        source: 'D&D Beyond PDF',
        ruleset: '2014',
        category: 'spell',
        equipped: true,
        prepared: true,
        spellLevel: 1,
        activities: [
          {
            id: `act-ddb-${spellName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: `Cast ${spellName}`,
            type: 'utility',
            actionEconomy: 'action',
            description: `Imported spell from D&D Beyond character sheet PDF.`,
          },
        ],
        entries: [`Imported spell: ${spellName}`],
      });
    }
  }

  char.items = importedItems;
  char.resources = syncSpellSlotPools(char.classes, char.resources);

  return {
    character: char,
    extractedFieldsCount: Object.keys(fields).length,
    warnings,
  };
}

/**
 * Reads a D&D Beyond exported character sheet PDF in the browser using pdfjs-dist,
 * extracts all AcroForm annotations + text items, and returns a populated RawCharacterState.
 */
export async function parseDndBeyondPdfBuffer(arrayBuffer: ArrayBuffer, fileName?: string): Promise<PdfImportSummary> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const fields: Record<string, string> = {};

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const annotations = await page.getAnnotations();
    for (const ann of annotations) {
      const fieldName = typeof ann.fieldName === 'string' ? ann.fieldName : '';
      if (!fieldName) continue;
      if (typeof ann.fieldValue === 'string' && ann.fieldValue.trim() !== '') {
        fields[fieldName] = ann.fieldValue.trim();
      } else if (typeof ann.buttonValue === 'string' && ann.checkBox && ann.fieldValue !== 'Off') {
        fields[fieldName] = 'Yes';
      }
    }
  }

  const baseTitle = fileName ? fileName.replace(/\.pdf$/i, '') : 'Imported D&D Beyond Hero';
  const summary = buildCharacterFromDdbFields(fields, baseTitle);

  if (summary.extractedFieldsCount === 0) {
    summary.warnings.push(
      'No fillable AcroForm fields detected (PDF may be flattened). Created baseline sheet—use Ctrl+K Markdown/JSON import or Build/Level Up to customize.'
    );
  }

  return summary;
}
