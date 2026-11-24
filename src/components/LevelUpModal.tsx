import { FormEvent, useMemo, useState } from 'react';
import { CLASS_DEFINITIONS, getClassDefinition, getSubclassPresets } from '../engine/classes';
import { evaluateDiceExpression } from '../engine/dice';
import { computeAbilityModifier, computeEffectiveCasterLevel } from '../engine/rules-math';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
import { LevelUpPlanInput } from '../state/useSheetStore';
import { RawCharacterState } from '../types/character';
import { AbilityKey } from '../types/core';
import { ModalDialog } from './ModalDialog';

interface LevelUpModalProps {
  isOpen: boolean;
  character: RawCharacterState;
  onClose: () => void;
  onApplyLevelUp: (input: LevelUpPlanInput) => void;
}

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function isAsiLevel(className: string, newLevel: number): boolean {
  const lower = className.toLowerCase();
  if ([4, 8, 12, 16, 19].includes(newLevel)) return true;
  if (lower === 'fighter' && (newLevel === 6 || newLevel === 14)) return true;
  if (lower === 'rogue' && newLevel === 10) return true;
  return false;
}

export function LevelUpModal({
  isOpen,
  character,
  onClose,
  onApplyLevelUp,
}: LevelUpModalProps) {
  const defaultClass = character.classes[0]?.className ?? 'Fighter';
  const [selectedClass, setSelectedClass] = useState(defaultClass);
  const [hpMode, setHpMode] = useState<'fixed' | 'rolled'>('fixed');
  const [rolledHpDie, setRolledHpDie] = useState<number | null>(null);
  const [subclassInput, setSubclassInput] = useState('');
  const [applyGrants, setApplyGrants] = useState(true);
  const [asiMode, setAsiMode] = useState<'none' | 'plus2' | 'plus1x2' | 'feat'>('plus2');
  const [asiPrimary, setAsiPrimary] = useState<AbilityKey>('str');
  const [asiSecondary, setAsiSecondary] = useState<AbilityKey>('con');
  const [selectedFeatId, setSelectedFeatId] = useState('');
  const [selectedSpellIds, setSelectedSpellIds] = useState<string[]>([]);
  const [spellFilter, setSpellFilter] = useState('');
  const [matchCharRulesetOnly, setMatchCharRulesetOnly] = useState(true);

  const classDef = getClassDefinition(selectedClass) ?? CLASS_DEFINITIONS[0]!;
  const existingEntry = character.classes.find(
    (c) => c.className.toLowerCase() === selectedClass.toLowerCase()
  );
  const newClassLevel = (existingEntry?.level ?? 0) + 1;
  const hitDie = existingEntry?.hitDie ?? classDef.hitDie;
  const casterProg = existingEntry?.casterProgression ?? classDef.casterProgression;

  const conScore = character.baseAbilities.con + character.bonusAbilities.con;
  const conMod = computeAbilityModifier(conScore);
  const effectiveSub = existingEntry?.subclassName || subclassInput;
  const isDraconic =
    selectedClass.toLowerCase() === 'sorcerer' &&
    effectiveSub.toLowerCase().includes('draconic');
  const hasTough = character.items.some((i) => i.name.toLowerCase().includes('tough'));
  const fixedHpGain = Math.max(1, hitDie / 2 + 1 + conMod + (isDraconic ? 1 : 0) + (hasTough ? 2 : 0));
  const computedRolledGain =
    rolledHpDie !== null
      ? Math.max(1, rolledHpDie + conMod + (isDraconic ? 1 : 0) + (hasTough ? 2 : 0))
      : fixedHpGain;
  const finalHpGain = hpMode === 'rolled' ? computedRolledGain : fixedHpGain;

  const subclasses = getSubclassPresets(selectedClass);
  const needsSubclassPrompt = !existingEntry?.subclassName && subclasses.length > 0 && newClassLevel >= 2;
  const showAsi = isAsiLevel(selectedClass, newClassLevel);

  const allPackEntities = useMemo(
    () => BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities),
    []
  );
  const ownedIds = useMemo(() => new Set(character.items.map((i) => i.id)), [character.items]);

  const featOptions = useMemo(
    () =>
      allPackEntities.filter(
        (e) =>
          e.category === 'feat' &&
          !ownedIds.has(e.id) &&
          (!matchCharRulesetOnly || e.ruleset === character.ruleset || e.ruleset === 'homebrew')
      ),
    [allPackEntities, ownedIds, matchCharRulesetOnly, character.ruleset]
  );

  const maxNewSpellLevel = useMemo(() => {
    if (casterProg === 'none') return 0;
    if (casterProg === 'pact') return Math.min(5, Math.ceil(newClassLevel / 2));
    const projectedClasses = existingEntry
      ? character.classes.map((c) =>
          c.className.toLowerCase() === selectedClass.toLowerCase()
            ? { ...c, level: c.level + 1 }
            : c
        )
      : [...character.classes, { className: selectedClass, level: 1, hitDie, casterProgression: casterProg }];
    const ecl = computeEffectiveCasterLevel(projectedClasses);
    return Math.min(9, Math.max(1, Math.ceil(ecl / 2)));
  }, [casterProg, newClassLevel, existingEntry, character.classes, selectedClass, hitDie]);

  const learnableSpells = useMemo(() => {
    if (maxNewSpellLevel <= 0) return [];
    const q = spellFilter.trim().toLowerCase();
    return allPackEntities
      .filter(
        (e) =>
          e.category === 'spell' &&
          !ownedIds.has(e.id) &&
          (e.spellLevel ?? 0) <= maxNewSpellLevel &&
          (!matchCharRulesetOnly || e.ruleset === character.ruleset || e.ruleset === 'homebrew')
      )
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [allPackEntities, ownedIds, maxNewSpellLevel, spellFilter, matchCharRulesetOnly, character.ruleset]);

  const toggleSpell = (id: string) => {
    setSelectedSpellIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const abilityIncreases: Partial<Record<AbilityKey, number>> = {};
    const bonusEntityIds = [...selectedSpellIds];
    if (showAsi) {
      if (asiMode === 'plus2') {
        abilityIncreases[asiPrimary] = 2;
      } else if (asiMode === 'plus1x2') {
        abilityIncreases[asiPrimary] = (abilityIncreases[asiPrimary] ?? 0) + 1;
        abilityIncreases[asiSecondary] = (abilityIncreases[asiSecondary] ?? 0) + 1;
      } else if (asiMode === 'feat' && selectedFeatId) {
        bonusEntityIds.push(selectedFeatId);
      }
    }

    onApplyLevelUp({
      className: classDef.className,
      hitDie,
      casterProgression: casterProg,
      hpGain: finalHpGain,
      subclassName: effectiveSub || undefined,
      applySubclassGrants: needsSubclassPrompt && Boolean(effectiveSub) && applyGrants,
      abilityIncreases,
      bonusEntityIds,
    });
    setSelectedSpellIds([]);
    setRolledHpDie(null);
    onClose();
  };

  return (
    <ModalDialog isOpen={isOpen} onClose={onClose} title={`Level-Up Wizard — ${character.name}`}>
      <form onSubmit={handleSubmit} className="forge-stack">
        <div className="forge-row-between" style={{ fontSize: 11 }}>
          <span className="badge">Ruleset: {character.ruleset.toUpperCase()}</span>
          <label className="forge-row" style={{ gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={matchCharRulesetOnly}
              onChange={(e) => setMatchCharRulesetOnly(e.target.checked)}
            />
            <span>Filter spells &amp; feats to {character.ruleset}</span>
          </label>
        </div>
        <div className="card forge-grid-2">
          <label className="forge-field">
            <span className="forge-label">CLASS TO ADVANCE (OR MULTICLASS)</span>
            <select
              className="forge-input"
              value={selectedClass}
              onChange={(e) => {
                setSelectedClass(e.target.value);
                setRolledHpDie(null);
                setSubclassInput('');
              }}
            >
              {CLASS_DEFINITIONS.map((def) => {
                const cur = character.classes.find((c) => c.className === def.className)?.level ?? 0;
                return (
                  <option key={def.className} value={def.className}>
                    {def.className} ({cur > 0 ? `Lvl ${cur} -> ${cur + 1}` : 'Multiclass Lvl 1'})
                  </option>
                );
              })}
            </select>
          </label>

          <div className="forge-field">
            <span className="forge-label">HIT POINTS GAIN (+d{hitDie}, CON {conMod >= 0 ? `+${conMod}` : conMod})</span>
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`pill ${hpMode === 'fixed' ? 'active' : ''}`}
                onClick={() => setHpMode('fixed')}
              >
                Fixed (+{fixedHpGain})
              </button>
              <button
                type="button"
                className={`pill ${hpMode === 'rolled' ? 'active' : ''}`}
                onClick={() => {
                  const rolled = evaluateDiceExpression(`1d${hitDie}`, 'normal').total;
                  setRolledHpDie(rolled);
                  setHpMode('rolled');
                }}
              >
                Roll 1d{hitDie} {rolledHpDie !== null ? `(${rolledHpDie} -> +${computedRolledGain})` : ''}
              </button>
            </div>
          </div>
        </div>

        {needsSubclassPrompt && (
          <div className="card forge-stack">
            <div className="forge-section-label">CHOOSE SUBCLASS (LEVEL {newClassLevel})</div>
            <div className="pill-row">
              {subclasses.map((sc) => (
                <button
                  key={sc.name}
                  type="button"
                  className={`pill ${subclassInput === sc.name ? 'active' : ''}`}
                  onClick={() => setSubclassInput(sc.name)}
                  title={sc.summary}
                >
                  {sc.name}
                </button>
              ))}
            </div>
            <label className="forge-row">
              <input
                type="checkbox"
                checked={applyGrants}
                onChange={(e) => setApplyGrants(e.target.checked)}
              />
              <span>Auto-add matching SRD subclass features &amp; domain/oath spells</span>
            </label>
          </div>
        )}

        {showAsi && (
          <div className="card forge-stack">
            <div className="forge-section-label">ABILITY SCORE IMPROVEMENT OR FEAT</div>
            <div className="pill-row">
              {(
                [
                  { key: 'plus2', label: '+2 Ability' },
                  { key: 'plus1x2', label: '+1 / +1 Abilities' },
                  { key: 'feat', label: 'Take Feat' },
                  { key: 'none', label: 'Skip' },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`pill ${asiMode === m.key ? 'active' : ''}`}
                  onClick={() => setAsiMode(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {asiMode === 'plus2' && (
              <label className="forge-field">
                <span className="forge-label">INCREASE +2</span>
                <select
                  className="forge-input"
                  value={asiPrimary}
                  onChange={(e) => setAsiPrimary(e.target.value as AbilityKey)}
                >
                  {ABILITIES.map((a) => (
                    <option key={a} value={a}>{a.toUpperCase()} (+2)</option>
                  ))}
                </select>
              </label>
            )}

            {asiMode === 'plus1x2' && (
              <div className="forge-grid-2">
                <label className="forge-field">
                  <span className="forge-label">FIRST +1</span>
                  <select
                    className="forge-input"
                    value={asiPrimary}
                    onChange={(e) => setAsiPrimary(e.target.value as AbilityKey)}
                  >
                    {ABILITIES.map((a) => (
                      <option key={a} value={a}>{a.toUpperCase()} (+1)</option>
                    ))}
                  </select>
                </label>
                <label className="forge-field">
                  <span className="forge-label">SECOND +1</span>
                  <select
                    className="forge-input"
                    value={asiSecondary}
                    onChange={(e) => setAsiSecondary(e.target.value as AbilityKey)}
                  >
                    {ABILITIES.map((a) => (
                      <option key={a} value={a}>{a.toUpperCase()} (+1)</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {asiMode === 'feat' && (
              <label className="forge-field">
                <span className="forge-label">FEAT OR FIGHTING STYLE</span>
                <select
                  className="forge-input"
                  value={selectedFeatId}
                  onChange={(e) => setSelectedFeatId(e.target.value)}
                >
                  <option value="">Select feat...</option>
                  {featOptions.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {maxNewSpellLevel > 0 && (
          <div className="card forge-stack">
            <div className="forge-row-between">
              <span className="forge-section-label" style={{ marginBottom: 0 }}>
                LEARN NEW SPELLS (UP TO LEVEL {maxNewSpellLevel})
              </span>
              <span className="forge-muted tabular">{selectedSpellIds.length} selected</span>
            </div>
            <input
              aria-label="Filter learnable spells"
              type="text"
              className="forge-input"
              placeholder="Search spells..."
              value={spellFilter}
              onChange={(e) => setSpellFilter(e.target.value)}
            />
            <div style={{ maxHeight: 160, overflowY: 'auto' }} className="pill-row">
              {learnableSpells.slice(0, 40).map((sp) => {
                const chosen = selectedSpellIds.includes(sp.id);
                return (
                  <button
                    key={sp.id}
                    type="button"
                    className={`pill ${chosen ? 'active' : ''}`}
                    onClick={() => toggleSpell(sp.id)}
                  >
                    {sp.name} (L{sp.spellLevel ?? 0}){sp.ritual ? ' [R]' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="forge-row-end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Apply {selectedClass} Level {newClassLevel} (+{finalHpGain} HP)
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
