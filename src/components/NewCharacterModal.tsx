import { FormEvent, useMemo, useRef, useState } from 'react';
import { BACKGROUND_PRESETS, SPECIES_PRESETS } from '../engine/backgrounds';
import { CLASS_DEFINITIONS, getSubclassPresets, NewCharacterPresetInput } from '../engine/classes';
import { evaluateDiceExpression } from '../engine/dice';
import {
  canAdjustPointBuy,
  computePointBuyTotal,
  DEFAULT_POINT_BUY_SCORES,
  POINT_BUY_BUDGET,
} from '../engine/point-buy';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
import { AbilityKey, Ruleset } from '../types/core';
import { CompendiumEntity } from '../types/compendium';
import { ModalDialog } from './ModalDialog';

interface NewCharacterModalProps {
  isOpen: boolean;
  onClose: () => void;
  compendiumEntities?: CompendiumEntity[];
  onCreate: (input: Omit<NewCharacterPresetInput, 'id'>) => Promise<void>;
}

const ABILITY_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export function NewCharacterModal({ isOpen, onClose, compendiumEntities = [], onCreate }: NewCharacterModalProps) {
  const [step, setStep] = useState<'origin' | 'abilities' | 'gear'>('origin');
  const [name, setName] = useState('');
  const [className, setClassName] = useState('Barbarian');
  const [subclassName, setSubclassName] = useState('');
  const [speciesName, setSpeciesName] = useState('Half-Orc');
  const [backgroundName, setBackgroundName] = useState('Outlander');
  const [ruleset, setRuleset] = useState<Ruleset>('2024');
  const [level, setLevel] = useState(1);
  const [alignment, setAlignment] = useState('Neutral Good');
  const [avatarUrl, setAvatarUrl] = useState('');
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

  const [extraEntityIds, setExtraEntityIds] = useState<string[]>([]);
  const [compFilterCat, setCompFilterCat] = useState<'spell' | 'weapon' | 'armor' | 'gear' | 'feat'>('spell');
  const [compSearch, setCompSearch] = useState('');
  const isSubmittingRef = useRef(false);

  const selectedClass = CLASS_DEFINITIONS.find((c) => c.className === className) ?? CLASS_DEFINITIONS[0]!;
  const selectedSpecies = SPECIES_PRESETS.find((s) => s.name === speciesName) ?? SPECIES_PRESETS[0]!;
  const selectedBackground = BACKGROUND_PRESETS.find((b) => b.name === backgroundName) ?? BACKGROUND_PRESETS[0]!;
  const subclasses = getSubclassPresets(className);

  const activeAbilities =
    abilityMode === 'standard'
      ? selectedClass.recommendedArray
      : abilityMode === 'point_buy'
      ? pointBuyScores
      : rolledScores;
  const pointBuyUsed = computePointBuyTotal(pointBuyScores);
  const pointBuyRemaining = POINT_BUY_BUDGET - pointBuyUsed;

  const allCompEntities = useMemo(() => {
    const map = new Map<string, CompendiumEntity>();
    for (const p of BUILTIN_CONTENT_PACKS) {
      for (const e of p.entities) map.set(e.id, e);
    }
    for (const e of compendiumEntities) {
      map.set(e.id, e);
    }
    return Array.from(map.values());
  }, [compendiumEntities]);

  const filteredCompOptions = useMemo(() => {
    const q = compSearch.trim().toLowerCase();
    return allCompEntities
      .filter(
        (e) =>
          e.category === compFilterCat &&
          (e.ruleset === ruleset || e.ruleset === 'homebrew') &&
          (!q || e.name.toLowerCase().includes(q))
      )
      .slice(0, 50);
  }, [allCompEntities, compFilterCat, ruleset, compSearch]);

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

  const toggleExtraEntity = (id: string) => {
    setExtraEntityIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const submitCharacter = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      await onCreate({
        name: name.trim() || `${speciesName} ${className}`,
        className,
        subclassName: subclassName || undefined,
        level,
        speciesName,
        backgroundName,
        ruleset,
        avatarUrl: avatarUrl.trim() || undefined,
        alignment: alignment.trim() || undefined,
        baseAbilities: activeAbilities,
        extraEntityIds,
      });
      setName('');
      setSubclassName('');
      setAvatarUrl('');
      setExtraEntityIds([]);
      setStep('origin');
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
        <div className="pill-row">
          <button
            type="button"
            className={`pill ${step === 'origin' ? 'active' : ''}`}
            onClick={() => setStep('origin')}
          >
            1. Origin &amp; Class
          </button>
          <button
            type="button"
            className={`pill ${step === 'abilities' ? 'active' : ''}`}
            onClick={() => setStep('abilities')}
          >
            2. Ability Scores
          </button>
          <button
            type="button"
            className={`pill ${step === 'gear' ? 'active' : ''}`}
            onClick={() => setStep('gear')}
          >
            3. Spells, Gear &amp; Feats ({extraEntityIds.length})
          </button>
        </div>

        {step === 'origin' && (
          <div className="forge-stack">
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
                  {(['2024', '2014'] as Ruleset[]).map((rs) => (
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
                  onChange={(e) => {
                    setClassName(e.target.value);
                    setSubclassName('');
                  }}
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

            <div className="card forge-grid-3">
              <label className="forge-field">
                <span className="forge-label">STARTING LEVEL</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={level}
                  onChange={(e) => setLevel(Math.max(1, Math.min(20, Number.parseInt(e.target.value, 10) || 1)))}
                  className="forge-input tabular"
                />
              </label>

              <label className="forge-field">
                <span className="forge-label">SUBCLASS (OPTIONAL)</span>
                <select
                  className="forge-input"
                  value={subclassName}
                  onChange={(e) => setSubclassName(e.target.value)}
                >
                  <option value="">None / Choose at Lvl 3</option>
                  {subclasses.map((sc) => (
                    <option key={sc.name} value={sc.name}>
                      {sc.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="forge-field">
                <span className="forge-label">ALIGNMENT</span>
                <input
                  type="text"
                  className="forge-input"
                  value={alignment}
                  onChange={(e) => setAlignment(e.target.value)}
                  placeholder="Neutral Good"
                />
              </label>
            </div>

            <div className="card forge-stack gap-2">
              <label className="forge-field">
                <span className="forge-label">AVATAR / TOKEN PORTRAIT URL (OPTIONAL)</span>
                <input
                  type="text"
                  className="forge-input"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="./images/portraits/hero.webp or https://..."
                />
              </label>
              <div className="forge-muted text-sm">
                <strong>Species:</strong> {selectedSpecies.traits.join(', ')} • <strong>Background Skills:</strong>{' '}
                {selectedBackground.skills.join(', ')}
              </div>
            </div>
          </div>
        )}

        {step === 'abilities' && (
          <div className="card forge-stack">
            <div className="forge-row-between wrap gap-2">
              <span className="forge-section-label">BASE ABILITY SCORES</span>
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
                <span
                  className="tabular"
                  style={{ fontSize: 12, color: pointBuyRemaining === 0 ? 'var(--accent-green)' : 'var(--accent-blue)' }}
                >
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
              {ABILITY_ORDER.map((key) => {
                const spBonus = selectedSpecies.abilityBonuses[key] ?? 0;
                const total = activeAbilities[key] + spBonus;
                const mod = Math.floor((total - 10) / 2);
                return abilityMode === 'point_buy' ? (
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
                    <span className="forge-muted tabular text-xs">
                      {spBonus > 0 ? `+${spBonus} → ` : ''}{total} ({mod >= 0 ? `+${mod}` : mod})
                    </span>
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
                    <span className="forge-muted tabular text-xs">
                      {spBonus > 0 ? `+${spBonus} → ` : ''}{total} ({mod >= 0 ? `+${mod}` : mod})
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="forge-muted text-sm">
              Auto-grants <strong>{selectedClass.saveProficiencies.map((s) => s.toUpperCase()).join(' / ')}</strong> saves,
              starting gear &amp; spells, class resource pools, and{' '}
              {selectedClass.unarmoredDefense ? selectedClass.unarmoredDefense.label : `d${selectedClass.hitDie} Hit Dice`}.
            </div>
          </div>
        )}

        {step === 'gear' && (
          <div className="card forge-stack">
            <div className="forge-row-between wrap gap-2">
              <span className="forge-section-label">ADD STARTING SPELLS, GEAR &amp; FEATS ({ruleset})</span>
              <span className="badge tabular">{extraEntityIds.length} added</span>
            </div>

            <div className="pill-row">
              {(['spell', 'weapon', 'armor', 'gear', 'feat'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`pill ${compFilterCat === cat ? 'active' : ''}`}
                  onClick={() => setCompFilterCat(cat)}
                >
                  {cat.toUpperCase()}
                </button>
              ))}
            </div>

            <input
              type="text"
              className="forge-input"
              placeholder={`Search ${ruleset} ${compFilterCat}s...`}
              value={compSearch}
              onChange={(e) => setCompSearch(e.target.value)}
            />

            <div className="forge-stack" style={{ maxHeight: 230, overflowY: 'auto' }}>
              {filteredCompOptions.map((item) => {
                const picked = extraEntityIds.includes(item.id);
                return (
                  <div key={item.id} className="forge-list-row">
                    <div>
                      <strong>{item.name}</strong>{' '}
                      <span className="forge-muted text-sm">
                        {item.category === 'spell' && item.spellLevel !== undefined
                          ? item.spellLevel === 0
                            ? 'Cantrip'
                            : `Lvl ${item.spellLevel}`
                          : item.source}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`pill ${picked ? 'active' : ''}`}
                      onClick={() => toggleExtraEntity(item.id)}
                    >
                      {picked ? 'Added ✓' : '+ Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="forge-row-between">
          <div className="forge-row">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            {step !== 'origin' && (
              <button
                type="button"
                className="btn"
                onClick={() => setStep(step === 'gear' ? 'abilities' : 'origin')}
              >
                ← Back
              </button>
            )}
          </div>
          <div className="forge-row">
            {step !== 'gear' && (
              <button
                type="button"
                className="btn"
                onClick={() => setStep(step === 'origin' ? 'abilities' : 'gear')}
              >
                Next →
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => void submitCharacter()}>
              Create {className} (Lvl {level})
            </button>
          </div>
        </div>
      </form>
    </ModalDialog>
  );
}
