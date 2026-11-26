import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CLASS_DEFINITIONS, extractSrdSpellcasterClasses, getClassDefinition, getSubclassPresets, spellOnClassList } from '../engine/classes';
import { dedupeCompendium, normalizeEntityName } from '../engine/compendium-dedupe';
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
  compendiumEntities?: import('../types/compendium').CompendiumEntity[];
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
  compendiumEntities = [],
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
  const [featFilter, setFeatFilter] = useState('');
  const [selectedSpellIds, setSelectedSpellIds] = useState<string[]>([]);
  const [spellFilter, setSpellFilter] = useState('');
  const [showAllClassSpells, setShowAllClassSpells] = useState(false);
  const [matchCharRulesetOnly, setMatchCharRulesetOnly] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedClass(character.classes[0]?.className ?? 'Fighter');
    setHpMode('fixed');
    setRolledHpDie(null);
    setSubclassInput('');
    setSelectedFeatId('');
    setFeatFilter('');
    setSelectedSpellIds([]);
    setSpellFilter('');
    setShowAllClassSpells(false);
    setMatchCharRulesetOnly(false);
  }, [isOpen, character.id]);

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

  const allPackEntities = useMemo(() => {
    const map = new Map(BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).map((e) => [e.id, e]));
    for (const e of compendiumEntities) map.set(e.id, e);
    return dedupeCompendium(Array.from(map.values()));
  }, [compendiumEntities]);
  const ownedIds = useMemo(() => new Set(character.items.map((i) => i.id)), [character.items]);
  // a spell owned under another source's id (SRD vs pack copy) must not be offered again
  const ownedSpellNames = useMemo(
    () => new Set(character.items.filter((i) => i.category === 'spell').map((i) => normalizeEntityName(i.name))),
    [character.items]
  );

  const featOptions = useMemo(() => {
    const q = featFilter.trim().toLowerCase();
    return allPackEntities
      .filter(
        (e) =>
          e.category === 'feat' &&
          !ownedIds.has(e.id) &&
          (!matchCharRulesetOnly || e.ruleset === character.ruleset || e.ruleset === 'homebrew')
      )
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.entries.join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allPackEntities, ownedIds, matchCharRulesetOnly, character.ruleset, featFilter]);

  const selectedFeat = useMemo(
    () => featOptions.find((f) => f.id === selectedFeatId) ?? allPackEntities.find((e) => e.id === selectedFeatId && e.category === 'feat') ?? null,
    [featOptions, allPackEntities, selectedFeatId]
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
    const classSet = extractSrdSpellcasterClasses([selectedClass, effectiveSub]);
    return allPackEntities
      .filter(
        (e) =>
          e.category === 'spell' &&
          !ownedIds.has(e.id) &&
          !ownedSpellNames.has(normalizeEntityName(e.name)) &&
          (e.spellLevel ?? 0) <= maxNewSpellLevel &&
          (!matchCharRulesetOnly || e.ruleset === character.ruleset || e.ruleset === 'homebrew') &&
          (showAllClassSpells || spellOnClassList(e, classSet))
      )
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => (a.spellLevel ?? 0) - (b.spellLevel ?? 0) || a.name.localeCompare(b.name));
  }, [allPackEntities, ownedIds, ownedSpellNames, maxNewSpellLevel, spellFilter, matchCharRulesetOnly, character.ruleset, showAllClassSpells, selectedClass, effectiveSub]);

  const matchingClassFeatures = useMemo(() => {
    const clsLower = selectedClass.toLowerCase();
    const subLower = effectiveSub.toLowerCase();
    return allPackEntities
      .filter(
        (e) =>
          e.category === 'feature' &&
          !ownedIds.has(e.id) &&
          (!matchCharRulesetOnly || e.ruleset === character.ruleset || e.ruleset === 'homebrew')
      )
      .filter((e) => {
        const text = `${e.name} ${e.entries.join(' ')}`.toLowerCase();
        return text.includes(clsLower) || (subLower && text.includes(subLower));
      })
      .slice(0, 24);
  }, [allPackEntities, ownedIds, selectedClass, effectiveSub, matchCharRulesetOnly, character.ruleset]);

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
      const capDelta = (key: AbilityKey, delta: number): number => {
        const cur = character.baseAbilities[key] + character.bonusAbilities[key];
        return Math.max(0, Math.min(20, cur + delta) - cur);
      };
      if (asiMode === 'plus2') {
        abilityIncreases[asiPrimary] = capDelta(asiPrimary, 2);
      } else if (asiMode === 'plus1x2') {
        if (asiPrimary === asiSecondary) {
          abilityIncreases[asiPrimary] = capDelta(asiPrimary, 2);
        } else {
          abilityIncreases[asiPrimary] = capDelta(asiPrimary, 1);
          abilityIncreases[asiSecondary] = capDelta(asiSecondary, 1);
        }
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
        <div className="forge-row-between text-sm">
          <span className="badge">Ruleset: {character.ruleset.toUpperCase()}</span>
          <label className="forge-row gap-2 clickable">
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
            <div className="forge-row wrap">
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
                  {ABILITIES.map((a) => {
                    const cur = character.baseAbilities[a] + character.bonusAbilities[a];
                    const next = Math.min(20, cur + 2);
                    return (
                      <option key={a} value={a}>
                        {a.toUpperCase()} ({cur} {'->'} {next}{cur >= 20 ? ' • max 20' : ''})
                      </option>
                    );
                  })}
                </select>
              </label>
            )}

            {asiMode === 'plus1x2' && (
              <div className="forge-stack">
                <div className="forge-grid-2">
                  <label className="forge-field">
                    <span className="forge-label">FIRST +1</span>
                    <select
                      className="forge-input"
                      value={asiPrimary}
                      onChange={(e) => setAsiPrimary(e.target.value as AbilityKey)}
                    >
                      {ABILITIES.map((a) => {
                        const cur = character.baseAbilities[a] + character.bonusAbilities[a];
                        return (
                          <option key={a} value={a}>
                            {a.toUpperCase()} ({cur} {'->'} {Math.min(20, cur + 1)})
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="forge-field">
                    <span className="forge-label">SECOND +1</span>
                    <select
                      className="forge-input"
                      value={asiSecondary}
                      onChange={(e) => setAsiSecondary(e.target.value as AbilityKey)}
                    >
                      {ABILITIES.map((a) => {
                        const cur = character.baseAbilities[a] + character.bonusAbilities[a];
                        const bonus = a === asiPrimary ? 2 : 1;
                        return (
                          <option key={a} value={a}>
                            {a.toUpperCase()} ({cur} {'->'} {Math.min(20, cur + bonus)})
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </div>
                {asiPrimary === asiSecondary && (
                  <span className="forge-muted text-sm">
                    Same ability selected twice — applies +2 to {asiPrimary.toUpperCase()}.
                  </span>
                )}
              </div>
            )}

            {asiMode === 'feat' && (
              <div className="forge-stack">
                <div className="forge-row gap-3">
                  <input
                    aria-label="Filter SRD feats"
                    type="text"
                    className="forge-input"
                    placeholder={`Search ${featOptions.length} feats...`}
                    value={featFilter}
                    onChange={(e) => setFeatFilter(e.target.value)}
                  />
                </div>
                <label className="forge-field">
                  <span className="forge-label">FEAT OR FIGHTING STYLE ({featOptions.length} MATCHING)</span>
                  <select
                    className="forge-input"
                    value={selectedFeatId}
                    onChange={(e) => setSelectedFeatId(e.target.value)}
                  >
                    <option value="">Select feat...</option>
                    {featOptions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.ruleset.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </label>
                {selectedFeat && (
                  <div className="subpanel forge-stack" style={{ padding: '8px 10px', gap: 4 }}>
                    <div className="forge-row-between">
                      <strong className="text-md">{selectedFeat.name}</strong>
                      <span className="badge">{selectedFeat.ruleset.toUpperCase()}</span>
                    </div>
                    <p className="forge-muted" style={{ fontSize: 11, margin: 0, lineHeight: 1.45 }}>
                      {selectedFeat.entries.slice(0, 2).join(' ')}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {matchingClassFeatures.length > 0 && (
          <div className="card forge-stack">
            <div className="forge-row-between">
              <span className="forge-section-label mb-0">
                SRD {selectedClass.toUpperCase()} FEATURES
              </span>
              <span className="forge-muted text-sm">
                Optional — click to add to sheet
              </span>
            </div>
            <div className="pill-row">
              {matchingClassFeatures.map((feat) => {
                const picked = selectedSpellIds.includes(feat.id);
                return (
                  <button
                    key={feat.id}
                    type="button"
                    className={`pill ${picked ? 'active' : ''}`}
                    title={feat.entries[0] ?? feat.name}
                    onClick={() => toggleSpell(feat.id)}
                  >
                    {picked ? '✓ ' : '+ '}{feat.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {maxNewSpellLevel > 0 && (
          <div className="card forge-stack">
            <div className="forge-row-between">
              <span className="forge-section-label mb-0">
                LEARN NEW SPELLS (UP TO LEVEL {maxNewSpellLevel})
              </span>
              <span className="forge-muted tabular">{selectedSpellIds.length} selected</span>
            </div>
            <div className="forge-row gap-3">
              <input
                aria-label="Filter learnable spells"
                type="text"
                className="forge-input"
                placeholder={`Search ${selectedClass} spells...`}
                value={spellFilter}
                onChange={(e) => setSpellFilter(e.target.value)}
              />
              <label className="forge-row" style={{ gap: 4, whiteSpace: 'nowrap', fontSize: 11, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showAllClassSpells}
                  onChange={(e) => setShowAllClassSpells(e.target.checked)}
                />
                <span>All classes</span>
              </label>
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto' }} className="pill-row">
              {learnableSpells.map((sp) => {
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
