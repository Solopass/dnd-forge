import { useEffect, useRef, useState } from 'react';
import { ClassLevel, RawCharacterState } from '../types/character';
import { AbilityKey, Ruleset } from '../types/core';

interface CharacterBuilderDrawerProps {
  isOpen: boolean;
  character: RawCharacterState;
  onClose: () => void;
  onUpdateCharacter: (updater: (prev: RawCharacterState) => RawCharacterState) => void;
  onLog: (msg: string, tone?: 'info' | 'warn') => void;
}

const ABILITY_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const CLASS_PRESETS: Array<{
  className: string;
  hitDie: 6 | 8 | 10 | 12;
  casterProgression: ClassLevel['casterProgression'];
}> = [
  { className: 'Artificer', hitDie: 8, casterProgression: 'half_up' },
  { className: 'Barbarian', hitDie: 12, casterProgression: 'none' },
  { className: 'Bard', hitDie: 8, casterProgression: 'full' },
  { className: 'Blood Hunter', hitDie: 10, casterProgression: 'pact' },
  { className: 'Cleric', hitDie: 8, casterProgression: 'full' },
  { className: 'Fighter', hitDie: 10, casterProgression: 'none' },
  { className: 'Paladin', hitDie: 10, casterProgression: 'half' },
  { className: 'Rogue', hitDie: 8, casterProgression: 'none' },
  { className: 'Warlock', hitDie: 8, casterProgression: 'pact' },
  { className: 'Wizard', hitDie: 6, casterProgression: 'full' },
];

export function CharacterBuilderDrawer({
  isOpen,
  character,
  onClose,
  onUpdateCharacter,
  onLog,
}: CharacterBuilderDrawerProps) {
  const [selectedNewClass, setSelectedNewClass] = useState('Wizard');
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const setRuleset = (ruleset: Ruleset) => {
    onUpdateCharacter((prev) => ({ ...prev, ruleset }));
    onLog(`Switched character ruleset to ${ruleset}.`);
  };

  const updateBaseScore = (key: AbilityKey, value: number) => {
    const clamped = Math.max(1, Math.min(30, value));
    onUpdateCharacter((prev) => ({
      ...prev,
      baseAbilities: { ...prev.baseAbilities, [key]: clamped },
    }));
  };

  const adjustClassLevel = (className: string, delta: number) => {
    onUpdateCharacter((prev) => {
      const updated = prev.classes
        .map((cls) =>
          cls.className === className ? { ...cls, level: Math.max(0, cls.level + delta) } : cls
        )
        .filter((cls) => cls.level > 0);
      return { ...prev, classes: updated };
    });
    onLog(`Adjusted ${className} level by ${delta > 0 ? `+${delta}` : delta}.`);
  };

  const addMulticlass = () => {
    const preset = CLASS_PRESETS.find((p) => p.className === selectedNewClass);
    if (!preset) return;
    onUpdateCharacter((prev) => {
      const exists = prev.classes.some((c) => c.className === preset.className);
      if (exists) {
        return {
          ...prev,
          classes: prev.classes.map((c) =>
            c.className === preset.className ? { ...c, level: c.level + 1 } : c
          ),
        };
      }
      return {
        ...prev,
        classes: [
          ...prev.classes,
          {
            className: preset.className,
            level: 1,
            hitDie: preset.hitDie,
            casterProgression: preset.casterProgression,
          },
        ],
      };
    });
    onLog(`Added ${preset.className} level.`);
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div
        className="palette-modal card"
        style={{ width: 'min(720px, 94vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong>Character Builder &amp; Multiclass Level-Up</strong>
          <button type="button" className="btn" onClick={onClose}>
            Done (Esc)
          </button>
        </div>

        <div className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={character.name}
              onChange={(e) => onUpdateCharacter((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Character Name"
              style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '5px 8px' }}
            />
            <input
              type="text"
              value={character.species}
              onChange={(e) => onUpdateCharacter((prev) => ({ ...prev, species: e.target.value }))}
              placeholder="Species / Lineage"
              style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '5px 8px' }}
            />
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

        <div className="card" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
            CLASSES &amp; MULTICLASS PROGRESSION
          </div>
          {character.classes.map((cls) => (
            <div
              key={cls.className}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '5px 0',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span>
                <strong>{cls.className}</strong>{' '}
                {cls.subclassName ? `(${cls.subclassName})` : ''} — Level{' '}
                <span className="tabular">{cls.level}</span> (d{cls.hitDie})
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" className="btn" onClick={() => adjustClassLevel(cls.className, -1)}>
                  -1
                </button>
                <button type="button" className="btn btn-primary" onClick={() => adjustClassLevel(cls.className, 1)}>
                  +1 Level
                </button>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <select
              value={selectedNewClass}
              onChange={(e) => setSelectedNewClass(e.target.value)}
              style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '4px 8px' }}
            >
              {CLASS_PRESETS.map((p) => (
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

        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
            BASE ABILITY SCORES (PRE-ASI)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
            {ABILITY_ORDER.map((key) => (
              <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
                <span style={{ textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{key}</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={character.baseAbilities[key]}
                  onChange={(e) => updateBaseScore(key, Number.parseInt(e.target.value, 10) || 10)}
                  className="tabular"
                  style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '4px 6px' }}
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
