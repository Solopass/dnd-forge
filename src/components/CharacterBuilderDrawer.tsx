import { useState } from 'react';
import { CLASS_DEFINITIONS, computeFixedMaxHp, getSubclassPresets } from '../engine/classes';
import { SKILL_ABILITY_MAP } from '../engine/rules-math';
import { ClassLevel, RawCharacterState } from '../types/character';
import { AbilityKey, Ruleset, SkillKey } from '../types/core';
import { ModalDialog } from './ModalDialog';

interface CharacterBuilderDrawerProps {
  isOpen: boolean;
  character: RawCharacterState;
  canDelete: boolean;
  onClose: () => void;
  onUpdateCharacter: (updater: (prev: RawCharacterState) => RawCharacterState) => void;
  onApplySubclassGrants: (className: string, subclassName: string) => number;
  onDuplicateCharacter: () => Promise<void>;
  onDeleteCharacter: () => Promise<void>;
  onLog: (msg: string, tone?: 'info' | 'warn') => void;
}

const ABILITY_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILL_KEYS = Object.keys(SKILL_ABILITY_MAP) as SkillKey[];

export function CharacterBuilderDrawer({
  isOpen,
  character,
  canDelete,
  onClose,
  onUpdateCharacter,
  onApplySubclassGrants,
  onDuplicateCharacter,
  onDeleteCharacter,
  onLog,
}: CharacterBuilderDrawerProps) {
  const [selectedNewClass, setSelectedNewClass] = useState('Wizard');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setRuleset = (ruleset: Ruleset) => {
    onUpdateCharacter((prev) => ({ ...prev, ruleset }));
    onLog(`Switched character ruleset to ${ruleset}.`);
  };

  const updateAbility = (bucket: 'baseAbilities' | 'bonusAbilities', key: AbilityKey, value: number) => {
    const min = bucket === 'baseAbilities' ? 1 : -10;
    const max = bucket === 'baseAbilities' ? 30 : 20;
    const clamped = Math.max(min, Math.min(max, value));
    onUpdateCharacter((prev) => ({
      ...prev,
      [bucket]: { ...prev[bucket], [key]: clamped },
    }));
  };

  const adjustClassLevel = (className: string, delta: number) => {
    onUpdateCharacter((prev) => {
      const updated = prev.classes
        .map((cls) =>
          cls.className === className ? { ...cls, level: Math.max(0, cls.level + delta) } : cls
        )
        .filter((cls) => cls.level > 0);
      const nextClasses = updated.length > 0 ? updated : prev.classes;
      const conScore = prev.baseAbilities.con + prev.bonusAbilities.con;
      const newMaxHp = computeFixedMaxHp(nextClasses, conScore, prev.items);
      const hpDiff = newMaxHp - prev.hp.max;
      return {
        ...prev,
        classes: nextClasses,
        hp: {
          ...prev.hp,
          max: newMaxHp,
          current: Math.max(1, Math.min(newMaxHp, prev.hp.current + hpDiff)),
        },
      };
    });
    onLog(`Adjusted ${className} level by ${delta > 0 ? `+${delta}` : delta}.`);
  };

  const updateSubclass = (className: string, subclassName: string) => {
    onUpdateCharacter((prev) => ({
      ...prev,
      classes: prev.classes.map((cls) =>
        cls.className === className ? { ...cls, subclassName } : cls
      ),
    }));
  };

  const addMulticlass = () => {
    const preset = CLASS_DEFINITIONS.find((p) => p.className === selectedNewClass);
    if (!preset) return;
    onUpdateCharacter((prev) => {
      const exists = prev.classes.some((c) => c.className === preset.className);
      const nextClasses: ClassLevel[] = exists
        ? prev.classes.map((c) =>
            c.className === preset.className ? { ...c, level: c.level + 1 } : c
          )
        : [
            ...prev.classes,
            {
              className: preset.className,
              level: 1,
              hitDie: preset.hitDie,
              casterProgression: preset.casterProgression,
            },
          ];
      const conScore = prev.baseAbilities.con + prev.bonusAbilities.con;
      const newMaxHp = computeFixedMaxHp(nextClasses, conScore, prev.items);
      const hpDiff = newMaxHp - prev.hp.max;
      return {
        ...prev,
        classes: nextClasses,
        hp: {
          ...prev.hp,
          max: newMaxHp,
          current: Math.max(1, Math.min(newMaxHp, prev.hp.current + hpDiff)),
        },
      };
    });
    onLog(`Added ${preset.className} level.`);
  };

  const toggleSaveProf = (key: AbilityKey) => {
    onUpdateCharacter((prev) => {
      const has = prev.saveProficiencies.includes(key);
      return {
        ...prev,
        saveProficiencies: has
          ? prev.saveProficiencies.filter((s) => s !== key)
          : [...prev.saveProficiencies, key],
      };
    });
  };

  const cycleSkillProf = (skill: SkillKey) => {
    onUpdateCharacter((prev) => {
      const cur = prev.skillProficiencies[skill] ?? 0;
      const next: 0 | 0.5 | 1 | 2 = cur === 0 ? 0.5 : cur === 0.5 ? 1 : cur === 1 ? 2 : 0;
      return {
        ...prev,
        skillProficiencies: { ...prev.skillProficiencies, [skill]: next },
      };
    });
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={() => {
        setConfirmDelete(false);
        onClose();
      }}
      title="Character Builder & Multiclass Level-Up"
    >
      <div className="forge-stack">
        <div className="card forge-grid-3" style={{ alignItems: 'end' }}>
          <label className="forge-field">
            <span className="forge-label">CHARACTER NAME</span>
            <input
              type="text"
              className="forge-input"
              value={character.name}
              onChange={(e) => onUpdateCharacter((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Character Name"
            />
          </label>
          <label className="forge-field">
            <span className="forge-label">SPECIES / LINEAGE</span>
            <input
              type="text"
              className="forge-input"
              value={character.species}
              onChange={(e) => onUpdateCharacter((prev) => ({ ...prev, species: e.target.value }))}
              placeholder="Species / Lineage"
            />
          </label>
          <div className="forge-field">
            <span className="forge-label">RULESET</span>
            <div className="pill-row">
              {(['2014', '2024', 'homebrew'] as Ruleset[]).map((rs) => (
                <button
                  key={rs}
                  type="button"
                  className={`pill ${character.ruleset === rs ? 'active' : ''}`}
                  onClick={() => setRuleset(rs)}
                >
                  {rs.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="forge-section-label">CLASSES &amp; MULTICLASS PROGRESSION</div>
          {character.classes.map((cls) => {
            const subclasses = getSubclassPresets(cls.className);
            const activeSub = subclasses.find(
              (s) => s.name.toLowerCase() === (cls.subclassName ?? '').toLowerCase()
            );
            const listId = `subclass-list-${cls.className.toLowerCase().replace(/\s+/g, '-')}`;
            return (
              <div key={cls.className} className="forge-list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="forge-row-between">
                  <div className="forge-row" style={{ flexWrap: 'wrap' }}>
                    <strong>{cls.className}</strong>
                    <input
                      aria-label={`${cls.className} subclass`}
                      list={listId}
                      type="text"
                      className="forge-input"
                      value={cls.subclassName ?? ''}
                      onChange={(e) => updateSubclass(cls.className, e.target.value)}
                      placeholder="Subclass (optional)"
                      style={{ width: 170, padding: '3px 6px' }}
                    />
                    <datalist id={listId}>
                      {subclasses.map((sc) => (
                        <option key={sc.name} value={sc.name} />
                      ))}
                    </datalist>
                    <span className="forge-muted">
                      Lvl <span className="tabular">{cls.level}</span> (d{cls.hitDie})
                    </span>
                  </div>
                  <div className="forge-row">
                    <button type="button" className="btn" onClick={() => adjustClassLevel(cls.className, -1)}>
                      -1
                    </button>
                    <button type="button" className="btn btn-primary" onClick={() => adjustClassLevel(cls.className, 1)}>
                      +1 Level
                    </button>
                  </div>
                </div>
                {subclasses.length > 0 && (
                  <div className="pill-row" style={{ marginTop: 4 }}>
                    {subclasses.map((sc) => (
                      <button
                        key={sc.name}
                        type="button"
                        className={`pill ${cls.subclassName === sc.name ? 'active' : ''}`}
                        onClick={() => updateSubclass(cls.className, sc.name)}
                        title={sc.summary}
                      >
                        {sc.name}
                      </button>
                    ))}
                  </div>
                )}
                {activeSub && (
                  <div className="forge-row-between" style={{ marginTop: 4, gap: 8 }}>
                    <div className="forge-muted" style={{ fontSize: 11 }}>
                      {activeSub.summary}
                    </div>
                    {activeSub.bonusEntityIds && activeSub.bonusEntityIds.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-primary forge-nowrap"
                        onClick={() => onApplySubclassGrants(cls.className, cls.subclassName ?? '')}
                      >
                        Apply Subclass Grants
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="forge-row" style={{ marginTop: 8 }}>
            <select
              aria-label="Select class to add"
              className="forge-input"
              value={selectedNewClass}
              onChange={(e) => setSelectedNewClass(e.target.value)}
            >
              {CLASS_DEFINITIONS.map((p) => (
                <option key={p.className} value={p.className}>
                  {p.className} (d{p.hitDie})
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={addMulticlass}>
              Add / Level Class
            </button>
          </div>
        </div>

        <div className="card forge-stack">
          <div className="forge-section-label">ABILITY SCORES (BASE + ASI / BONUS) &amp; SAVE PROFICIENCIES</div>
          <div className="forge-ability-grid">
            {ABILITY_ORDER.map((key) => {
              const saveActive = character.saveProficiencies.includes(key);
              return (
                <div key={key} className="forge-ability-edit">
                  <div className="forge-row-between">
                    <span className="forge-label">{key.toUpperCase()}</span>
                    <button
                      type="button"
                      className={`pill forge-nowrap ${saveActive ? 'active' : ''}`}
                      onClick={() => toggleSaveProf(key)}
                      title="Toggle saving throw proficiency"
                    >
                      {saveActive ? 'Save ★' : 'Save'}
                    </button>
                  </div>
                  <input
                    aria-label={`${key.toUpperCase()} base score`}
                    type="number"
                    min={1}
                    max={30}
                    value={character.baseAbilities[key]}
                    onChange={(e) => updateAbility('baseAbilities', key, Number.parseInt(e.target.value, 10) || 10)}
                    className="forge-input tabular"
                  />
                  <input
                    aria-label={`${key.toUpperCase()} bonus ASI`}
                    type="number"
                    min={-10}
                    max={20}
                    value={character.bonusAbilities[key]}
                    onChange={(e) => updateAbility('bonusAbilities', key, Number.parseInt(e.target.value, 10) || 0)}
                    className="forge-input tabular"
                    title="Bonus / ASI"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="forge-section-label">SKILL PROFICIENCIES (CLICK TO CYCLE: NONE ○ → HALF ◐ → PROF ● → EXPERTISE ★★)</div>
          <div className="forge-skill-pill-grid">
            {SKILL_KEYS.map((sk) => {
              const rank = character.skillProficiencies[sk] ?? 0;
              const badge = rank === 2 ? '★★' : rank === 1 ? '●' : rank === 0.5 ? '◐' : '○';
              return (
                <button
                  key={sk}
                  type="button"
                  className={`pill ${rank > 0 ? 'active' : ''}`}
                  onClick={() => cycleSkillProf(sk)}
                  style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: 6 }}
                >
                  <span>{sk.replace(/_/g, ' ')}</span>
                  <span className="tabular">{badge}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="forge-row-between">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await onDuplicateCharacter();
              onClose();
            }}
          >
            Duplicate Character
          </button>

          {canDelete && (
            <div className="forge-row">
              {!confirmDelete ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete Character
                </button>
              ) : (
                <>
                  <span className="forge-muted">Confirm delete?</span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={async () => {
                      await onDeleteCharacter();
                      setConfirmDelete(false);
                      onClose();
                    }}
                  >
                    Yes, Delete
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </ModalDialog>
  );
}
