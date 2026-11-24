import { FormEvent, useRef, useState } from 'react';
import { BACKGROUND_PRESETS, SPECIES_PRESETS } from '../engine/backgrounds';
import { CLASS_DEFINITIONS, NewCharacterPresetInput } from '../engine/classes';
import { evaluateDiceExpression } from '../engine/dice';
import {
  canAdjustPointBuy,
  computePointBuyTotal,
  DEFAULT_POINT_BUY_SCORES,
  POINT_BUY_BUDGET,
} from '../engine/point-buy';
import { AbilityKey, Ruleset } from '../types/core';
import { ModalDialog } from './ModalDialog';

interface NewCharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (input: Omit<NewCharacterPresetInput, 'id'>) => Promise<void>;
}

const ABILITY_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export function NewCharacterModal({ isOpen, onClose, onCreate }: NewCharacterModalProps) {
  const [name, setName] = useState('');
  const [className, setClassName] = useState('Barbarian');
  const [speciesName, setSpeciesName] = useState('Half-Orc');
  const [backgroundName, setBackgroundName] = useState('Outlander');
  const [ruleset, setRuleset] = useState<Ruleset>('2014');
  const [level, setLevel] = useState(1);
  const [abilityMode, setAbilityMode] = useState<'standard' | 'point_buy' | 'rolled'>('standard');
  const [pointBuyScores, setPointBuyScores] = useState<Record<AbilityKey, number>>({
    ...DEFAULT_POINT_BUY_SCORES,
  });
  const [rolledScores, setRolledScores] = useState<Record<AbilityKey, number>>({
    str: 15,
    dex: 14,
    con: 13,
    int: 12,
    wis: 10,
    cha: 8,
  });
  const isSubmittingRef = useRef(false);

  const selectedClass = CLASS_DEFINITIONS.find((c) => c.className === className) ?? CLASS_DEFINITIONS[0]!;
  const activeAbilities =
    abilityMode === 'standard'
      ? selectedClass.recommendedArray
      : abilityMode === 'point_buy'
      ? pointBuyScores
      : rolledScores;
  const pointBuyUsed = computePointBuyTotal(pointBuyScores);
  const pointBuyRemaining = POINT_BUY_BUDGET - pointBuyUsed;

  const rollAbilities = () => {
    const next: Record<AbilityKey, number> = {
      str: evaluateDiceExpression('4d6kh3', 'normal').total,
      dex: evaluateDiceExpression('4d6kh3', 'normal').total,
      con: evaluateDiceExpression('4d6kh3', 'normal').total,
      int: evaluateDiceExpression('4d6kh3', 'normal').total,
      wis: evaluateDiceExpression('4d6kh3', 'normal').total,
      cha: evaluateDiceExpression('4d6kh3', 'normal').total,
    };
    setRolledScores(next);
    setAbilityMode('rolled');
  };

  const submitCharacter = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      await onCreate({
        name: name.trim() || `${speciesName} ${className}`,
        className,
        level,
        speciesName,
        backgroundName,
        ruleset,
        baseAbilities: activeAbilities,
      });
      setName('');
      onClose();
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitCharacter();
  };

  return (
    <ModalDialog isOpen={isOpen} onClose={onClose} title="Create New Character">
      <form onSubmit={handleSubmit} className="forge-stack">
        <div className="card forge-grid-2">
          <label className="forge-field">
            <span className="forge-label">CHARACTER NAME</span>
            <input
              autoFocus
              type="text"
              className="forge-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${speciesName} ${className}`}
            />
          </label>
          <div className="forge-field">
            <span className="forge-label">RULESET</span>
            <div className="pill-row">
              {(['2014', '2024'] as Ruleset[]).map((rs) => (
                <button
                  key={rs}
                  type="button"
                  className={`pill ${ruleset === rs ? 'active' : ''}`}
                  onClick={() => setRuleset(rs)}
                >
                  5e ({rs})
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card forge-grid-3">
          <label className="forge-field">
            <span className="forge-label">CLASS</span>
            <select
              className="forge-input"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
            >
              {CLASS_DEFINITIONS.map((c) => (
                <option key={c.className} value={c.className}>
                  {c.className} (d{c.hitDie})
                </option>
              ))}
            </select>
          </label>

          <label className="forge-field">
            <span className="forge-label">SPECIES</span>
            <select
              className="forge-input"
              value={speciesName}
              onChange={(e) => setSpeciesName(e.target.value)}
            >
              {SPECIES_PRESETS.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.speed} ft)
                </option>
              ))}
            </select>
          </label>

          <label className="forge-field">
            <span className="forge-label">BACKGROUND</span>
            <select
              className="forge-input"
              value={backgroundName}
              onChange={(e) => setBackgroundName(e.target.value)}
            >
              {BACKGROUND_PRESETS.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="card forge-stack">
          <div className="forge-row-between">
            <label className="forge-row">
              <span className="forge-label">STARTING LEVEL</span>
              <input
                type="number"
                min={1}
                max={20}
                value={level}
                onChange={(e) => setLevel(Math.max(1, Math.min(20, Number.parseInt(e.target.value, 10) || 1)))}
                className="forge-input tabular"
                style={{ width: 64 }}
              />
            </label>
            <div className="pill-row">
              <button
                type="button"
                className={`pill ${abilityMode === 'standard' ? 'active' : ''}`}
                onClick={() => setAbilityMode('standard')}
              >
                Standard Array
              </button>
              <button
                type="button"
                className={`pill ${abilityMode === 'point_buy' ? 'active' : ''}`}
                onClick={() => setAbilityMode('point_buy')}
              >
                Point Buy (27 pts)
              </button>
              <button
                type="button"
                className={`pill ${abilityMode === 'rolled' ? 'active' : ''}`}
                onClick={rollAbilities}
              >
                Roll 4d6kh3
              </button>
            </div>
          </div>

          {abilityMode === 'point_buy' && (
            <div className="forge-row-between">
              <span className="tabular" style={{ fontSize: 12, color: pointBuyRemaining === 0 ? 'var(--accent-green)' : 'var(--accent-blue)' }}>
                Points Remaining: <strong>{pointBuyRemaining}</strong> / {POINT_BUY_BUDGET}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => setPointBuyScores({ ...DEFAULT_POINT_BUY_SCORES })}
              >
                Reset (8s)
              </button>
            </div>
          )}

          <div className="forge-ability-grid-6">
            {ABILITY_ORDER.map((key) =>
              abilityMode === 'point_buy' ? (
                <div key={key} className="forge-field card" style={{ padding: 6, alignItems: 'center' }}>
                  <span className="forge-label">{key.toUpperCase()}</span>
                  <div className="forge-row">
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Decrease ${key.toUpperCase()} point buy`}
                      disabled={!canAdjustPointBuy(pointBuyScores, key, -1)}
                      onClick={() =>
                        setPointBuyScores((prev) => ({ ...prev, [key]: prev[key] - 1 }))
                      }
                    >
                      -
                    </button>
                    <strong className="tabular" style={{ minWidth: 20, textAlign: 'center' }}>
                      {pointBuyScores[key]}
                    </strong>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Increase ${key.toUpperCase()} point buy`}
                      disabled={!canAdjustPointBuy(pointBuyScores, key, 1)}
                      onClick={() =>
                        setPointBuyScores((prev) => ({ ...prev, [key]: prev[key] + 1 }))
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
              ) : (
                <label key={key} className="forge-field">
                  <span className="forge-label">{key.toUpperCase()}</span>
                  <input
                    type="number"
                    min={3}
                    max={20}
                    value={activeAbilities[key]}
                    onChange={(e) => {
                      const val = Math.max(3, Math.min(20, Number.parseInt(e.target.value, 10) || 10));
                      setRolledScores({ ...activeAbilities, [key]: val });
                      setAbilityMode('rolled');
                    }}
                    className="forge-input tabular"
                  />
                </label>
              )
            )}
          </div>

          <div className="forge-muted">
            Auto-grants <strong>{selectedClass.saveProficiencies.map((s) => s.toUpperCase()).join(' / ')}</strong> saves,
            starting gear &amp; spells, class resource pools, and{' '}
            {selectedClass.unarmoredDefense ? selectedClass.unarmoredDefense.label : `d${selectedClass.hitDie} Hit Dice`}.
          </div>
        </div>

        <div className="forge-row-end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submitCharacter()}>
            Create {className} (Lvl {level})
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
